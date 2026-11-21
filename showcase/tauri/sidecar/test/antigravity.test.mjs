import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { antigravityModels, contextFor, startAntigravityProxy } from '../antigravity.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';
const dir = mkdtempSync(path.join(os.tmpdir(), 'roamies-agy-test-'));
const command = path.join(dir, 'fake-agy');
writeFileSync(command, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(HERE, 'fake-agy.mjs'))} "$@"\n`);
chmodSync(command, 0o755);
const log = path.join(dir, 'fake.log');
process.env.FAKE_AGY_LOG = log;

const models = await antigravityModels({ command });
assert.deepEqual(models, [{ id: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (Low)' }, { id: 'claude-opus-5-5-low', name: 'Claude Opus 5.5 (Low)' }, { id: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B (Medium)' }]);
assert.equal(contextFor('gemini-3.8-flash-low'), 1_000_000);
assert.equal(contextFor('claude-opus-5-5-low'), 200_000);
assert.equal(contextFor('gpt-oss-120b-medium'), 128_000);

const proxy = await startAntigravityProxy({ command });
assert.match(proxy.baseUrl, /^http:\/\/127\.0\.0\.1:\d+\/v1$/);
assert.equal(proxy.supportsImages, true);

const post = (body) => fetch(`${proxy.baseUrl}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const last = () => JSON.parse(readFileSync(log, 'utf8').trim().split('\n').at(-1));

{ // The model list, with the context windows the local model picker needs. GPT-OSS is text-only and left out.
  const list = await fetch(`${proxy.baseUrl}/models`).then((r) => r.json());
  assert.deepEqual(list.data.map((m) => m.id), ['gemini-3.8-flash-low', 'claude-opus-5-5-low']);
  assert.equal(list.data[0].context_length, 1_000_000);
}

{ // A plain answer.
  const out = await post({ model: 'gemini-3.8-flash-low', messages: [{ role: 'system', content: 'Be brief.' }, { role: 'user', content: 'Hello.' }] });
  assert.equal(out.choices[0].finish_reason, 'stop');
  assert.equal(out.choices[0].message.content, 'Hello from Antigravity.');
  assert.equal(out.usage.prompt_tokens, 107, 'input plus cached tokens');
  const seen = last();
  assert.equal(seen.model, 'gemini-3.8-flash-low');
  assert.equal(seen.agent, 'roamies-relay');
  assert.match(seen.agentMd, /excludeDefaultComponents: true/);
  assert.match(seen.agentMd, /tools: \[view_file\]/);
  assert.match(seen.agentMd, /mainAgent: true/);
  assert.deepEqual(seen.settings.permissions.allow, [`read_file(${seen.cwd})`]);
  assert.ok(seen.settings.permissions.deny.includes('command(*)'));
  assert.match(seen.agentMd, /Be brief\./);
  assert.match(seen.prompt, /Hello\./);
}

{ // A Roamies tool call comes back to the client untouched; agy never runs it.
  const out = await post({
    model: 'gemini-3.8-flash-low', messages: [{ role: 'user', content: 'TOOLCALL' }],
    tools: [{ type: 'function', function: { name: 'take_screenshot', description: 'Take a screenshot.', parameters: { type: 'object', properties: {} } } }],
  });
  assert.equal(out.choices[0].finish_reason, 'tool_calls');
  assert.equal(out.choices[0].message.tool_calls[0].function.name, 'take_screenshot');
  assert.deepEqual(JSON.parse(out.choices[0].message.tool_calls[0].function.arguments), {});
  assert.match(out.choices[0].message.content, /Let me look\./);
}

{ // Streaming: text chunks, then the final stop, then [DONE].
  const r = await fetch(`${proxy.baseUrl}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'gemini-3.8-flash-low', stream: true, messages: [{ role: 'user', content: 'Hello.' }] }) });
  const text = await r.text();
  assert.match(text, /Hello /);
  assert.match(text, /from Antigravity\./);
  assert.match(text, /"finish_reason":"stop"/);
  assert.ok(text.trim().endsWith('data: [DONE]'));
}
{ // Streaming a tool call: the name first, then the arguments, then finish_reason tool_calls.
  const r = await fetch(`${proxy.baseUrl}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    model: 'gemini-3.8-flash-low', stream: true, messages: [{ role: 'user', content: 'TOOLCALL' }],
    tools: [{ type: 'function', function: { name: 'take_screenshot', description: 'Take a screenshot.', parameters: { type: 'object', properties: {} } } }],
  }) });
  const text = await r.text();
  assert.match(text, /"tool_calls"/);
  assert.match(text, /take_screenshot/);
  assert.match(text, /"finish_reason":"tool_calls"/);
  assert.ok(text.trim().endsWith('data: [DONE]'));
  assert.ok(!text.includes('ROAMIES_TOOL'), 'the marker is not streamed');
}

{ // A data-URL picture is written into the workspace, and the model can read it from there.
  const out = await post({
    model: 'gemini-3.8-flash-low',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'READIMAGE' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${PNG}` } }] }],
  });
  assert.equal(out.choices[0].message.content, 'The number is 7319.');
  const seen = last();
  assert.equal(seen.imageExists, true);
  assert.ok(seen.image.startsWith(seen.cwd));
  assert.match(seen.prompt, /\[Image saved at .*Call read_file on that path to see it/);
}

{ // agy's own tools are off; one that arrives anyway is refused.
  const out = await post({ model: 'gemini-3.8-flash-low', messages: [{ role: 'user', content: 'BUILTIN' }] });
  assert.match(out.choices[0].message.content, /own tool/);
  assert.match(out.choices[0].message.content, /run_command/);
}

{ // read_file may look at the staged pictures, but not at anything else on the computer.
  const out = await post({ model: 'gemini-3.8-flash-low', messages: [{ role: 'user', content: 'OUTSIDE' }] });
  assert.match(out.choices[0].message.content, /outside the turn's workspace/);
}

proxy.close();
rmSync(dir, { recursive: true, force: true });
console.log('antigravity tests passed');
