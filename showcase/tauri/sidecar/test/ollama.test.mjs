// Ollama as the brain: which models are offered (tool calling only), why it can't answer, the context warning, the
// Cloud/Ollama switch keeping each pick, and never a cloud model in its place. Run: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getModel, registerRuntimeModels } from '@kenkaiiii/gg-core';
import { createOllama, normalBrain, switchBrain, MIN_CONTEXT, OLLAMA } from '../ollama.mjs';
import { summaryModelFor, sideThinking } from '../brain.mjs';
import { explain } from '../errors.mjs';

const lm = (rawId, o = {}) => ({ rawId, endpointId: 'ollama', contextWindow: 4096, contextWindowKnown: false, supportsTools: true, supportsImages: false, supportsThinking: false, ...o });
const fake = (probe) => {
  const calls = [];
  const registered = [];
  const o = createOllama({
    discover: async (eps, opts) => { calls.push(opts); return { probes: [{ endpoint: eps[0], ...probe() }], models: [] }; },
    served: async () => 32_768,
    register: (models) => registered.push(...models),
  });
  return { o, calls, registered };
};

// Not running: nothing offered, a plain reason, and no model to use.
{
  const { o } = fake(() => ({ reachable: false, reason: 'Not running at http://127.0.0.1:11434/v1', models: [] }));
  assert.match(o.problem(null), /Checking Ollama/, 'before the first check it says it is checking');
  const st = await o.check();
  assert.equal(st.ok, false); assert.equal(st.reason, 'offline');
  assert.equal(o.pick(null), null, 'no model when Ollama is off');
  assert.equal(o.pick('local/ollama/qwen3:8b'), null, 'the saved pick is not usable while Ollama is off');
  assert.match(o.problem('local/ollama/qwen3:8b'), /Ollama isn't running\. Open Ollama/, 'says to open Ollama');
}
// A discovery that throws is the same as not running (never an exception out of check).
{
  const o = createOllama({ discover: async () => { throw new Error('boom'); }, register: () => {} });
  assert.equal((await o.check()).reason, 'offline');
}
// Running: only models that call tools are offered; the rest are named so the user knows why they're missing.
{
  const { o, calls, registered } = fake(() => ({ reachable: true, models: [lm('qwen3:8b', { supportsThinking: true }), lm('gemma3:4b', { supportsTools: false }), lm('hf.co/user/repo:q4', { contextWindow: 65_536, contextWindowKnown: true })] }));
  const st = await o.check({ force: true });
  assert.deepEqual(calls.at(-1), { force: true }, 'Check again skips the discovery cache');
  assert.equal(st.ok, true);
  assert.deepEqual(st.models.map((m) => m.id), ['local/ollama/qwen3:8b', 'local/ollama/hf.co/user/repo:q4']);
  assert.deepEqual(st.noTools, ['gemma3:4b'], 'a model without tool calling is left out by name');
  assert.deepEqual(registered.map((m) => [m.id, m.provider, m.name]), [['local/ollama/qwen3:8b', 'local', 'qwen3:8b'], ['local/ollama/hf.co/user/repo:q4', 'local', 'repo:q4']], 'tool models are registered as gg-core local models');
  assert.equal(o.pick(null), 'local/ollama/qwen3:8b', 'nothing picked yet: the first one');
  assert.equal(o.pick('local/ollama/hf.co/user/repo:q4'), 'local/ollama/hf.co/user/repo:q4', 'the saved pick is kept');
  assert.equal(o.pick('local/ollama/llama3.1:8b'), null, 'a saved pick that is gone is not swapped for another model');
  assert.match(o.problem('local/ollama/llama3.1:8b'), /llama3\.1:8b isn't in Ollama anymore/, 'says the pick is gone');
  assert.equal(o.problem('local/ollama/qwen3:8b'), null, 'ready');
  assert.equal(o.problem(null), 'Pick an Ollama model on the Model page.');
  // Context: unknown until measured, then the real one; too small gets a warning that says what to change.
  assert.equal(o.contextNote('local/ollama/qwen3:8b'), null, 'no warning on a guess');
  assert.equal(await o.measure('local/ollama/qwen3:8b'), 32_768);
  assert.equal(o.find('local/ollama/qwen3:8b').contextKnown, true);
  assert.equal(registered.at(-1).contextWindow, 32_768, 'the measured context is what the history is fitted to');
  assert.equal(o.contextNote('local/ollama/qwen3:8b'), null, '32K is enough');
  assert.equal(await o.measure('local/ollama/nope'), null, 'nothing to measure for an unknown model');
  // A later check keeps the measured context when Ollama only guesses (the model unloaded).
  await o.check();
  assert.equal(o.find('local/ollama/qwen3:8b').context, 32_768, 'a measured context survives a re-check');
}
{
  const o = createOllama({
    discover: async (eps) => ({ probes: [{ endpoint: eps[0], reachable: true, models: [lm('qwen3:8b')] }] }),
    served: async () => 4096, register: () => {},
  });
  await o.check(); await o.measure('local/ollama/qwen3:8b');
  assert.ok(4096 < MIN_CONTEXT);
  assert.match(o.contextNote('local/ollama/qwen3:8b'), /4K context, too small[^\n]*32K or more/, 'a 4K context is warned about');
}
// No models at all, or none that call tools: each says what to pull.
{
  const empty = fake(() => ({ reachable: true, models: [] })).o;
  assert.equal((await empty.check()).reason, 'empty');
  assert.match(empty.problem(null), /no models yet[^\n]*ollama pull/);
  const none = fake(() => ({ reachable: true, models: [lm('gemma3:4b', { supportsTools: false })] })).o;
  assert.equal((await none.check()).reason, 'no_tools');
  assert.match(none.problem(null), /None of your Ollama models can use tools/);
  assert.equal(none.pick(null), null, 'a model that cannot call tools is never used');
}
// Credentials: no key, Ollama's own address on this computer.
{
  const c = createOllama().creds();
  assert.equal(c.accessToken, 'local'); assert.equal(c.baseUrl, OLLAMA.baseUrl);
  assert.match(OLLAMA.baseUrl, /^http:\/\/127\.0\.0\.1:11434\/v1$/);
}
// The switch: each side keeps its pick, and switching back restores it.
{
  const base = { brain: 'cloud', provider: 'openai', model: 'gpt-6-luna', cloud: null, ollamaModel: null };
  const toO = { ...base, ...switchBrain(base, 'ollama') };
  assert.deepEqual([toO.brain, toO.provider, toO.model, toO.cloud], ['ollama', 'local', null, { provider: 'openai', model: 'gpt-6-luna' }]);
  const picked = { ...toO, model: 'local/ollama/qwen3:8b', ollamaModel: 'local/ollama/qwen3:8b' };
  const back = { ...picked, ...switchBrain(picked, 'cloud') };
  assert.deepEqual([back.brain, back.provider, back.model, back.ollamaModel], ['cloud', 'openai', 'gpt-6-luna', 'local/ollama/qwen3:8b'], 'Cloud gets its pick back; the Ollama pick is kept');
  const again = { ...back, ...switchBrain(back, 'ollama') };
  assert.deepEqual([again.provider, again.model], ['local', 'local/ollama/qwen3:8b'], 'Ollama gets its pick back');
  assert.deepEqual(switchBrain(again, 'ollama'), {}, 'already there');
  assert.deepEqual(switchBrain(again, 'gpt'), {}, 'not a brain');
  // The voice provider is not part of the brain.
  assert.ok(!Object.keys({ ...switchBrain(base, 'ollama'), ...switchBrain(picked, 'cloud') }).some((k) => /voice|studio|fish/i.test(k)), 'the brain switch never touches the voice settings');
}
// A saved config made consistent at launch.
{
  assert.deepEqual(normalBrain({ provider: 'anthropic', model: 'x' }), { brain: 'cloud' }, 'older configs are Cloud');
  assert.deepEqual(normalBrain({ brain: 'ollama', provider: 'openai', model: 'x', ollamaModel: 'local/ollama/a' }), { brain: 'ollama', provider: 'local', model: 'local/ollama/a' });
  assert.deepEqual(normalBrain({ brain: 'cloud', provider: 'local', model: 'local/ollama/a', cloud: { provider: 'gemini', model: 'g' } }), { brain: 'cloud', provider: 'gemini', model: 'g' });
  assert.deepEqual(normalBrain({ brain: 'llama', provider: 'local', model: 'local/ollama/a' }), { brain: 'cloud', provider: null, model: null }, 'an unknown brain is Cloud, never local');
}
// Side calls (memory, folding old turns) stay on the Ollama model: no cheaper cloud model is swapped in.
{
  const id = 'local/ollama/sidetest:1b';
  registerRuntimeModels([{ id, name: 'sidetest:1b', provider: 'local', contextWindow: 32_768, maxOutputTokens: 4096, supportsThinking: false, supportsImages: false, supportsVideo: false, costTier: 'low', maxThinkingLevel: 'max', authStorageKeys: ['local:ollama'] }]);
  assert.equal(getModel(id)?.provider, 'local');
  assert.equal(summaryModelFor('local', id), id, 'the summary model is the Ollama model itself');
  assert.equal(sideThinking('local', id, 'low'), undefined, 'no thinking for a model without it');
}
// An Ollama that stopped answering is named, not "check your internet".
{
  assert.equal(explain('reply', new Error('fetch failed'), { who: 'Ollama', local: true }).code, 'E29');
  assert.match(explain('reply', new Error('connect ECONNREFUSED 127.0.0.1:11434'), { who: 'Ollama', local: true }).text, /Can't reach Ollama\. Is it open\?/);
  assert.equal(explain('reply', new Error('fetch failed'), { who: 'OpenAI' }).code, 'E28', 'cloud providers keep the internet line');
}
// The sidecar: with Ollama picked, ensureModel decides on Ollama alone and returns before any cloud provider is chosen;
// signing in to a cloud account doesn't move an Ollama user; credentials for 'local' never read a cloud key.
{
  const side = readFileSync(fileURLToPath(new URL('../sidekick.mjs', import.meta.url)), 'utf8');
  const ensure = side.slice(side.indexOf('function ensureModel()'), side.indexOf('\n}\n', side.indexOf('function ensureModel()')));
  const ollamaAt = ensure.indexOf('if (onOllama())'), cloudAt = ensure.indexOf("['anthropic', 'openai', 'gemini'");
  assert.ok(ollamaAt >= 0 && cloudAt > ollamaAt, 'the Ollama branch comes before the cloud provider search');
  assert.match(ensure.slice(ollamaAt, cloudAt), /return !!id && !ollama\.problem\(id\);\n  \}/, 'and returns from it, whatever Ollama says');
  assert.match(side, /if \(!onOllama\(\) && \(!config\.provider \|\| !signedIn\.get\(config\.provider\)\)\) \{ config\.provider = null; ensureModel\(\); \}/, 'a sign-in leaves an Ollama user on Ollama');
  assert.match(side, /provider === 'local' \? ollama\.creds\(\) : auth\.resolveCredentials/, "Ollama's credentials are its own");
  assert.match(side, /if \(\(p === 'local'\) !== onOllama\(\)/, 'a model pick for the other brain is ignored');
}
console.log('ollama tests passed');
