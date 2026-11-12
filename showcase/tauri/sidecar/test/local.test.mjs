// Models served by Ollama on this computer. Run: npm test
import assert from 'node:assert/strict';
import { getAuthStorageKeys, getModel, getModelsForProvider } from '@kenkaiiii/gg-core';
import { MIN_CONTEXT, OLLAMA, OLLAMA_KEY, connectLocal, contextNote, localModels } from '../local.mjs';

const model = (rawId, o = {}) => ({ rawId, endpointId: 'ollama', contextWindow: 4096, contextWindowKnown: false, supportsTools: true, supportsImages: true, supportsThinking: true, ...o });
const probe = { endpoint: OLLAMA, reachable: true, models: [
  model('qwen3.5:4b'),
  model('llama3:8b', { supportsImages: false }), // can't see screenshots
  model('moondream:2b', { supportsTools: false }), // can't use tools
  model('gemma4:12b', { contextWindow: 32768, contextWindowKnown: true }),
] };

const found = localModels([probe, { endpoint: { ...OLLAMA, id: 'other' }, reachable: false, models: [model('x')] }]);
assert.deepEqual(found.map((m) => m.id), ['local/ollama/qwen3.5:4b', 'local/ollama/gemma4:12b'], 'only models that see images and use tools, from servers that answered');
for (const m of found) {
  assert.equal(m.provider, 'local');
  assert.deepEqual(m.authStorageKeys, ['local:ollama']);
  assert.equal(m.supportsImages, true);
}
assert.equal(OLLAMA_KEY, 'local:ollama');
assert.equal(OLLAMA.baseUrl, 'http://127.0.0.1:11434/v1');

// A measured window replaces gg-core's 4k guess, but not a window the server reported.
const measured = new Map([['local/ollama/qwen3.5:4b', 32768], ['local/ollama/gemma4:12b', 8192]]);
const fitted = Object.fromEntries(localModels([probe], measured).map((m) => [m.id, m]));
assert.equal(fitted['local/ollama/qwen3.5:4b'].contextWindow, 32768);
assert.equal(fitted['local/ollama/qwen3.5:4b'].maxOutputTokens, 4096);
assert.equal(fitted['local/ollama/gemma4:12b'].contextWindow, 32768);

// Connecting registers the models; the credential is saved only when Ollama answered.
const saved = [];
const auth = { setLocalEndpoint: async (id, baseUrl) => saved.push([id, baseUrl]) };
const down = await connectLocal(auth, { save: true, probe: async (e) => ({ endpoint: e, reachable: false, reason: 'Not running', models: [] }) });
assert.equal(down.ok, false);
assert.deepEqual(saved, [], "nothing saved when Ollama isn't running");
const up = await connectLocal(auth, { save: true, windows: measured, probe: async () => probe });
assert.equal(up.ok, true);
assert.equal(up.all, 4);
assert.deepEqual(saved, [['ollama', 'http://127.0.0.1:11434/v1']]);
assert.deepEqual(getModelsForProvider('local').map((m) => m.id), ['local/ollama/qwen3.5:4b', 'local/ollama/gemma4:12b']);
assert.equal(getModel('local/ollama/qwen3.5:4b').contextWindow, 32768);
assert.deepEqual(getAuthStorageKeys('local', 'local/ollama/qwen3.5:4b'), ['local:ollama'], 'the model runs on the saved Ollama credential');
await connectLocal(auth, { probe: async () => ({ ...probe, models: probe.models.slice(1) }) });
assert.deepEqual(getModelsForProvider('local').map((m) => m.id), ['local/ollama/gemma4:12b'], 'a removed model leaves the menu');
assert.equal(saved.length, 1, 'a rescan saves nothing');

// Too small a window gets a plain warning with the fix.
assert.match(contextNote(4096), /only 4k tokens.*Context length.*OLLAMA_CONTEXT_LENGTH/s);
assert.equal(contextNote(MIN_CONTEXT), '');
assert.match(contextNote(16384), /only 16k/, 'half of 16k is less than the system prompt and tools');
assert.equal(contextNote(65536), '');
assert.equal(contextNote(undefined), '');

console.log('local: ok');
