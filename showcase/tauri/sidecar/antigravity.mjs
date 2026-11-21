// Antigravity as a local, OpenAI-compatible model server. It drives the official, already signed-in `agy` CLI:
// agy is the model, Roamies still runs every tool. A private workspace holds a relay agent with agy's own
// file/command/browser tools off, plus the images for this turn. `read_file` is allowed inside that workspace only,
// so the model can look at screenshots while it still cannot read anything else on the computer.
//
// agy's custom-agent `tools` allowlist cannot include its MCP dispatcher (and no MCP tool is visible when it is set),
// so the relay asks for Roamies tools in text with a fixed marker instead. The marker never reaches the screen: the
// streamer holds it back, and a complete call becomes an OpenAI tool_calls response for Roamies to execute.
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const AGENT = 'roamies-relay';
const MARK = '<<<ROAMIES_TOOL';
const DEFAULT_COMMAND = process.env.ROAMIES_AGY || 'agy';
const MODEL_TTL = 5 * 60_000;
const REQUEST_TIMEOUT = 240_000;
const IMAGE_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

// One `agy models` read at a time, kept for five minutes: the menu asks often and the CLI takes a moment.
let listing = null, listingAt = 0;

function runAgy(args, { command = DEFAULT_COMMAND, timeout = 20_000, cwd, env } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); }
    catch (e) { return reject(e); }
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`agy ${args[0] ?? ''} timed out`)); }, timeout);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ out, err });
      else reject(new Error(err.trim().split('\n').at(-1) || `agy exited ${code}`));
    });
  });
}

/** The models the signed-in account can use, as `agy models` lists them. Empty when agy isn't there or is signed out. */
export async function antigravityModels({ command = DEFAULT_COMMAND, timeout = 20_000 } = {}) {
  if (command === DEFAULT_COMMAND && listing && Date.now() - listingAt < MODEL_TTL) return listing;
  const read = runAgy(['models'], { command, timeout }).then(({ out }) => out.split('\n').map((line) => {
    const [id, ...rest] = line.trim().split(/\t| {2,}/);
    return id && /^[a-z0-9][\w.:-]*$/i.test(id) && rest.join(' ').trim() ? { id, name: rest.join(' ').trim() } : null;
  }).filter(Boolean));
  if (command !== DEFAULT_COMMAND) return read;
  const stale = listing;
  listing = read;
  read.then((list) => { if (list.length) listingAt = Date.now(); }, () => { if (listing === read) listing = null; });
  // A menu or a server check asks again after a while: give it the last list now and refresh behind it.
  if (stale && Date.now() - listingAt >= MODEL_TTL) { read.catch(() => {}); return stale; }
  return read;
}

/** A model's context window, for the local-server probe. agy doesn't publish them; these are conservative. */
export const contextFor = (id) => (/^gemini/i.test(id) ? 1_000_000 : /^claude/i.test(id) ? 200_000 : /^gpt-oss/i.test(id) ? 128_000 : 128_000);

const parseArgs = (value) => {
  if (typeof value !== 'string') return value && typeof value === 'object' ? value : {};
  try { return JSON.parse(value || '{}'); } catch { return {}; }
};

// ---------- staging ----------
const imageFromUrl = (url) => {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(String(url ?? ''));
  return m ? { mime: m[1], data: m[2] } : null;
};
const imageOfBlock = (b) => (b?.type === 'image_url' || b?.type === 'input_image'
  ? imageFromUrl(typeof b.image_url === 'string' ? b.image_url : b.image_url?.url)
  : b?.type === 'image'
    ? (b.source?.data ? { mime: b.source.media_type ?? 'image/png', data: b.source.data } : b.data ? { mime: b.mimeType ?? 'image/png', data: b.data } : null)
    : null);

async function saveImage(dir, image) {
  const bytes = Buffer.from(image.data, 'base64');
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 24);
  const file = path.join(dir, `${hash}.${IMAGE_EXT[image.mime] ?? 'png'}`);
  await writeFile(file, bytes);
  return file;
}

/** Message content → text, with each picture written into the workspace and named in a line the model can read. */
async function stage(content, dir) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  const parts = [];
  for (const b of Array.isArray(content) ? content : [content]) {
    if (!b || typeof b !== 'object') { parts.push(String(b)); continue; }
    if (['text', 'input_text', 'output_text'].includes(b.type)) { parts.push(b.text ?? ''); continue; }
    const image = imageOfBlock(b);
    if (image) {
      const file = await saveImage(dir, image);
      parts.push(`[Image saved at ${file}. Call read_file on that path to see it before answering.]`);
    } else parts.push(JSON.stringify(b));
  }
  return parts.filter(Boolean).join('\n');
}

const toolManifest = (tools) => (Array.isArray(tools) ? tools : []).map((t) => {
  const f = t?.type === 'function' ? t.function : t;
  if (!f || typeof f.name !== 'string' || !f.name) return null;
  const schema = f.parameters && typeof f.parameters === 'object' ? f.parameters : { type: 'object', properties: {} };
  return { name: f.name, description: String(f.description ?? ''), inputSchema: { ...schema, type: 'object', properties: schema.properties ?? {} } };
}).filter(Boolean);

/** The agent's system prompt: Roamies' own instructions, then the one way it may ask for a Roamies tool. */
function protocol(manifest) {
  if (!manifest.length) return '# Tool protocol\nNo tools are available in this conversation. Do not call any function; answer directly.';
  const catalog = manifest.map((t) => `### ${t.name}\n${t.description}\n\nParameters (JSON Schema):\n\`\`\`json\n${JSON.stringify(t.inputSchema)}\n\`\`\``).join('\n\n');
  return `# Tool protocol
You run as the model inside Roamies. Roamies, not you, executes tools. To use one, write exactly one line and then stop:

${MARK} {"name":"<tool name>","arguments":{...}}>>>

Do not put it in a code block. Do not write anything after it. Never write a tool call any other way.
- Make at most one tool call per response. After writing it, stop: the result arrives in the next turn.
- Images and screenshots are saved as files in this workspace. To see one, call the \`read_file\` function directly with \`{"Path": "<the path>"}\`. \`read_file\` is the only function you may call directly besides the three agy resource/task tools, and only on paths in this workspace.
- When no tool is needed, answer directly.

# Available tools

${catalog}`;
}

const conversation = (turns) => {
  if (!turns.length) return '';
  if (turns.length === 1 && turns[0].role === 'user') return turns[0].text;
  const lines = ['<conversation>'];
  for (const t of turns) {
    lines.push(`<message role="${t.role}">`);
    if (t.text) lines.push(t.text);
    for (const c of t.calls ?? []) lines.push(`<tool_call id="${c.id}" name="${c.name}">${JSON.stringify(c.args ?? {})}</tool_call>`);
    lines.push('</message>');
  }
  lines.push('</conversation>');
  lines.push('');
  lines.push('The conversation above is the complete history and you are the assistant in it. Continue from its end. To use a tool, write the marked line from the tool protocol; never write tool calls as markup.');
  return lines.join('\n');
};

async function prepare(messages, tools, dir) {
  const system = [], turns = [], names = new Map();
  for (const m of Array.isArray(messages) ? messages : []) {
    const text = await stage(m?.content, dir);
    if (m?.role === 'system' || m?.role === 'developer') { if (turns.length) turns.push({ role: 'system', text }); else system.push(text); continue; }
    if (m?.role === 'user') { turns.push({ role: 'user', text }); continue; }
    if (m?.role === 'assistant') {
      const calls = (Array.isArray(m.tool_calls) ? m.tool_calls : []).map((c) => {
        const call = { id: c?.id ?? `call_${randomUUID().slice(0, 8)}`, name: c?.function?.name ?? '', args: parseArgs(c?.function?.arguments) };
        names.set(call.id, call.name);
        return call;
      });
      turns.push({ role: 'assistant', text, calls });
      continue;
    }
    if (m?.role === 'tool') turns.push({ role: 'tool', text, id: m.tool_call_id, name: m.name ?? names.get(m.tool_call_id) ?? '' });
  }
  const manifest = toolManifest(tools);
  return { system: [...system, protocol(manifest)].filter(Boolean).join('\n\n'), prompt: conversation(turns), manifest };
}

const agentMarkdown = (system) => `---
name: ${AGENT}
description: "Roamies relay: model only, Roamies runs every tool"
excludeDefaultComponents: true
inheritMcp: false
subagent: false
mainAgent: true
tools: [view_file]
---
${system}
`;

const settingsFor = (dir) => JSON.stringify({
  permissions: {
    allow: [`read_file(${dir})`],
    deny: ['write_file(*)', 'command(*)', 'read_url(*)', 'execute_url(*)', 'mcp(*)'],
  },
});

const inside = (dir, file) => {
  const full = path.resolve(dir, String(file ?? ''));
  return full === path.resolve(dir) || full.startsWith(`${path.resolve(dir)}${path.sep}`);
};

const usageOf = (u) => {
  const input = Number(u?.input_tokens) + Number(u?.cache_read_tokens ?? 0);
  const output = Number(u?.output_tokens);
  return {
    prompt_tokens: Number.isFinite(input) ? input : 0, completion_tokens: Number.isFinite(output) ? output : 0,
    total_tokens: (Number.isFinite(input) ? input : 0) + (Number.isFinite(output) ? output : 0),
    prompt_tokens_details: { cached_tokens: Number(u?.cache_read_tokens ?? 0) || 0 },
    completion_tokens_details: { reasoning_tokens: Number(u?.thinking_tokens ?? 0) || 0 },
  };
};

// Hand text on as it arrives, but hold back a tool marker and everything after it so it never reaches the screen.
function streamText(onDelta) {
  let pending = '', stopped = false;
  return {
    push(delta) {
      if (stopped || !delta) return;
      pending += delta;
      const at = pending.indexOf(MARK);
      if (at >= 0) {
        if (at) onDelta(pending.slice(0, at));
        pending = pending.slice(at);
        stopped = true;
        return;
      }
      let hold = 0;
      for (let n = Math.min(MARK.length - 1, pending.length); n > 0; n--) if (MARK.startsWith(pending.slice(-n))) { hold = n; break; }
      if (pending.length > hold) { onDelta(pending.slice(0, pending.length - hold)); pending = pending.slice(pending.length - hold); }
    },
    flush() { if (!stopped && pending) { onDelta(pending); pending = ''; } },
  };
}

/** A complete tool request in the answer, or null. Throws when the marker is there but the call is unusable. */
function toolCallIn(text, manifest) {
  const at = text.indexOf(MARK);
  if (at < 0) return null;
  const end = text.indexOf('>>>', at + MARK.length);
  if (end < 0) throw new Error('agy wrote a tool call that was cut off');
  const raw = text.slice(at + MARK.length, end).trim();
  let request;
  try { request = JSON.parse(raw); } catch { throw new Error('agy wrote a tool call I couldn\'t read'); }
  const name = request?.name ?? request?.tool, args = parseArgs(request?.arguments ?? request?.args ?? {});
  if (typeof name !== 'string' || !manifest.some((t) => t.name === name)) throw new Error(`agy called “${name}”, a tool Roamies didn't offer`);
  return {
    call: { id: `call_${randomUUID().replace(/-/g, '').slice(0, 24)}`, type: 'function', function: { name, arguments: JSON.stringify(args) } },
    text: text.slice(0, at).replace(/\s+$/, ''),
  };
}

/**
 * One chat request: stage the pictures, run one agy turn with the relay agent, and return the answer or the first
 * tool call. `onDelta` gets text as it streams (without the tool marker). The workspace is removed when the turn ends.
 */
export async function runAntigravity({ model, messages, tools, signal, onDelta = () => {}, command = DEFAULT_COMMAND, timeout = REQUEST_TIMEOUT } = {}) {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'roamies-agy-')));
  let child = null, timer = null;
  const kill = () => {
    try {
      if (!child?.pid) return;
      if (process.platform === 'win32') child.kill();
      else process.kill(-child.pid, 'SIGKILL');
    } catch { /* already gone */ }
  };
  const abort = () => kill();
  try {
    const attachments = path.join(dir, 'attachments');
    await mkdir(attachments, { recursive: true });
    const { system, prompt, manifest } = await prepare(messages, tools, attachments);
    const agentDir = path.join(dir, '.agents', 'agents', AGENT);
    await mkdir(agentDir, { recursive: true });
    await writeFile(path.join(agentDir, 'agent.md'), agentMarkdown(system));
    const logFile = path.join(dir, 'agy.log');
    const args = ['--input-format', 'stream-json', '--output-format', 'stream-json', '--model', String(model), '--agent', AGENT,
      '--log-file', logFile, '--disable-slash-commands', '--settings', settingsFor(dir)];
    if (signal?.aborted) throw new Error('cancelled');
    signal?.addEventListener('abort', abort, { once: true });
    child = spawn(command, args, { cwd: dir, env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'], detached: true, windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    timer = setTimeout(() => { kill(); }, timeout);
    child.stdin.write(JSON.stringify({ event: 'user', message: { role: 'user', content: prompt } }) + '\n');
    child.stdin.end();

    const stream = streamText(onDelta);
    let text = '', usage = null, result = null, fallback = false, buffer = '';
    const done = new Promise((resolve, reject) => {
      const finish = () => resolve();
      const fail = (e) => reject(e);
      child.stdout.on('data', (chunk) => {
        buffer += chunk;
        let i;
        while ((i = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, i).trim();
          buffer = buffer.slice(i + 1);
          if (!line) continue;
          let event;
          try { event = JSON.parse(line); } catch { continue; }
          if (event.event === 'init') {
            fallback = event.init?.agent != null && event.init.agent !== AGENT;
            continue;
          }
          if (event.event === 'step_update') {
            const step = event.step_update ?? {};
            if (step.step_type === 'agent_response' && step.text_delta) {
              text += step.text_delta;
              stream.push(step.text_delta);
              continue;
            }
            if (step.step_type === 'agent_response' && step.state === 'DONE' && step.usage) usage = usageOf(step.usage);
            if (step.step_type !== 'tool') continue;
            const name = step.tool_name ?? step.tool_info?.name;
            const params = step.tool_info?.parameters ?? {};
            // Reading a staged picture is allowed; agy's three fundamental resource/task tools are harmless and can't
            // touch the host either, so they run inside agy. Everything else is an agy tool that must not run.
            if (name === 'read_file' || name === 'view_file') {
              const file = params.Path ?? params.path ?? params.file_path;
              if (!inside(dir, file)) {
                kill();
                fail(Object.assign(new Error('agy tried to read a file outside the turn\'s workspace'), { heard: !!text }));
              }
            } else if (name !== 'list_resources' && name !== 'read_resource' && name !== 'manage_task') {
              kill();
              fail(Object.assign(new Error(`agy tried its own tool “${name}”, which is off`), { heard: !!text }));
            }
            continue;
          }
          if (event.event === 'result') {
            result = event.result ?? {};
            finish();
            return;
          }
        }
      });
      child.on('error', (e) => fail(e));
      child.on('close', (code) => { if (!result) fail(new Error(stderr.trim().split('\n').at(-1) || `agy exited ${code}`)); });
    });
    await done;
    if (fallback) throw new Error('agy did not load the Roamies relay agent; refusing to use its own tools');
    const logged = await readFile(logFile, 'utf8').catch(() => '');
    if (/not found, falling back to default/i.test(logged)) throw new Error('agy did not load the Roamies relay agent; refusing to use its own tools');
    if (result && result.status !== 'SUCCESS') throw new Error(result.error || `agy ${result.status ?? 'failed'}`);
    if (result?.response && result.response !== text) {
      if (result.response.startsWith(text)) { const tail = result.response.slice(text.length); text = result.response; stream.push(tail); }
      else text = result.response;
    }
    usage = result?.usage ? usageOf(result.usage) : usage;
    const call = toolCallIn(text, manifest);
    if (!call) { stream.flush(); return { text: result?.response ?? text, calls: [], usage }; }
    return { text: call.text, calls: [call.call], usage };
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    kill();
    if (!process.env.ROAMIES_AGY_KEEP) await rm(dir, { recursive: true, force: true }).catch(() => {});
    else console.error('antigravity workspace kept:', dir);
  }
}

const chunk = (id, model, delta, finish = null, usage = undefined) => `data: ${JSON.stringify({
  id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model,
  choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}),
})}\n\n`;

async function chat(body, res, command = DEFAULT_COMMAND) {
  const model = String(body?.model ?? '').includes('/') ? String(body.model).split('/').pop() : String(body?.model ?? '');
  const id = `chatcmpl-agy-${randomUUID().slice(0, 16)}`;
  const stream = body?.stream === true;
  if (stream) {
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write(chunk(id, model, { role: 'assistant' }));
  }
  const stop = () => { try { res.end(); } catch { /* gone */ } };
  try {
    if (!model) throw new Error('No Antigravity model was picked.');
    const turn = await runAntigravity({
      model, messages: body?.messages, tools: body?.tools, command,
      onDelta: stream ? (t) => res.write(chunk(id, model, { content: t })) : () => {},
    });
    if (stream) {
      if (turn.calls.length) {
        res.write(chunk(id, model, { tool_calls: turn.calls.map((c, index) => ({ index, id: c.id, type: 'function', function: { name: c.function.name, arguments: '' } })) }));
        res.write(chunk(id, model, { tool_calls: turn.calls.map((c, index) => ({ index, function: { arguments: c.function.arguments } })) }));
        res.write(chunk(id, model, {}, 'tool_calls', turn.usage));
      } else res.write(chunk(id, model, {}, 'stop', turn.usage));
      res.write('data: [DONE]\n\n');
      return stop();
    }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      id, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model,
      choices: [{ index: 0, message: { role: 'assistant', content: turn.calls.length ? (turn.text || null) : turn.text, tool_calls: turn.calls.length ? turn.calls : undefined }, finish_reason: turn.calls.length ? 'tool_calls' : 'stop' }],
      usage: turn.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    }));
  } catch (e) {
    const message = `Antigravity: ${String(e?.message ?? e).slice(0, 400)}`;
    if (stream) {
      res.write(chunk(id, model, { content: message }));
      res.write(chunk(id, model, {}, 'stop'));
      res.write('data: [DONE]\n\n');
      return stop();
    }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ id, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, message: { role: 'assistant', content: message }, finish_reason: 'stop' }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }));
  }
}

/** Start the local model server. It answers on 127.0.0.1 and doesn't keep the sidecar alive on its own. */
export async function startAntigravityProxy({ command = DEFAULT_COMMAND, port = Number(process.env.ROAMIES_AGY_PORT) || 47654 } = {}) {
  // Warm the list before the first probe: the local-server check waits only a moment, while `agy models` takes longer.
  await antigravityModels({ command }).catch(() => []);
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method === 'GET' && (url.pathname === '/v1/models' || url.pathname === '/models')) {
      return antigravityModels({ command }).then((models) => {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        // GPT-OSS is text-only; Roamies' model list is for screen work, so it isn't offered.
        const usable = models.filter((m) => !/^gpt-oss/i.test(m.id));
        res.end(JSON.stringify({ object: 'list', data: usable.map((m) => ({ id: m.id, object: 'model', created: 0, owned_by: 'antigravity', context_length: contextFor(m.id) })) }));
      }).catch((e) => {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ object: 'list', data: [], error: { message: String(e?.message ?? e) } }));
      });
    }
    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      let raw = '';
      req.on('data', (d) => { raw += d; if (raw.length > 20_000_000) req.destroy(); });
      req.on('end', () => {
        let body;
        try { body = JSON.parse(raw); } catch { res.writeHead(400, { 'content-type': 'application/json' }); return res.end('{"error":{"message":"invalid JSON"}}'); }
        chat(body, res, command).catch(() => { try { res.end(); } catch { /* gone */ } });
      });
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end('{"error":{"message":"not found"}}');
  });
  const listen = (on) => new Promise((resolve, reject) => {
    const fail = (e) => { server.off('error', fail); reject(e); };
    server.once('error', fail);
    server.listen(on, '127.0.0.1', () => { server.off('error', fail); resolve(); });
  });
  try { await listen(port); } catch { await listen(0); }
  server.unref();
  const { port: actual } = server.address();
  const baseUrl = `http://127.0.0.1:${actual}/v1`;
  return {
    id: 'antigravity', label: 'Antigravity', baseUrl, kind: 'custom', supportsImages: true,
    close: () => { try { server.close(); } catch { /* already closed */ } },
  };
}
