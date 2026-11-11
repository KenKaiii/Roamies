// Local AI through Ollama: finding it, offering only models that can use tools, saving the URL. Run: npm test
import assert from 'node:assert/strict';
import http from 'node:http';
import { getModel, getAuthStorageKeys, getModelsForProvider } from '@kenkaiiii/gg-core';
import { isOmni, omniModel, scanLocal, OLLAMA_KEY } from '../local.mjs';

assert.ok(isOmni('lfm3-omni:latest') && isOmni('hf.co/LiquidAI/LFM3-Omni-2B-GGUF:Q4_K_M') && isOmni('lfm2.5-omni'));
assert.ok(!isOmni('qwen3:8b') && !isOmni('lfm3-audio:2b') && !isOmni(null));

const caps = { 'lfm3-omni:latest': ['completion', 'tools', 'audio'], 'plain:1b': ['completion'], 'embed:1': ['embedding'], 'nomic-embed-text': ['embedding'] };
const running = [{ name: 'lfm3-omni:latest', context_length: 16384 }];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const send = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
    if (req.url === '/v1/models') return send({ data: Object.keys(caps).map((id) => ({ id })) });
    if (req.url === '/api/ps') return send({ models: running });
    if (req.url === '/api/show') return send({ capabilities: caps[JSON.parse(body).model] ?? [], parameters: '' });
    res.statusCode = 404; res.end();
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const endpoint = { id: 'ollama', label: 'Ollama', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, kind: 'ollama' };

const stored = new Map();
const auth = {
  setLocalEndpoint: async (id, url) => void stored.set(`local:${id}`, url),
  removeLocalEndpoint: async (id) => void stored.delete(`local:${id}`),
};

const r = await scanLocal(auth, { endpoint, force: true, served: async () => 16384 });
assert.equal(r.reachable, true);
assert.deepEqual(r.models.map((m) => m.name), ['lfm3-omni:latest'], 'only a model that can call tools is offered; embedding models never');
assert.equal(r.skipped, 1, 'plain:1b has no tools');
assert.equal(omniModel(r.models), 'lfm3-omni:latest');
assert.equal(r.models[0].ctx, 16384);
assert.equal(stored.get(OLLAMA_KEY), endpoint.baseUrl, 'the URL is saved where credsFor finds it');
const id = 'local/ollama/lfm3-omni:latest';
assert.equal(getModel(id)?.provider, 'local');
assert.deepEqual(getAuthStorageKeys('local', id), [OLLAMA_KEY]);
assert.deepEqual(getModelsForProvider('local').map((m) => m.id), [id]);

// An unloaded model has no known window: Connect loads it and reads the real one.
running.length = 0;
const r2 = await scanLocal(auth, { endpoint, force: true, served: async () => 32768 });
assert.equal(r2.models[0].ctx, 32768);
assert.equal(getModel(id).contextWindow, 32768);

// Not running: nothing offered, nothing left saved, and the old models are gone.
await new Promise((r) => server.close(r));
const gone = await scanLocal(auth, { endpoint, force: true });
assert.equal(gone.reachable, false);
assert.deepEqual(gone.models, []);
assert.equal(stored.size, 0);
assert.equal(getModel(id), undefined, 'models from a server that stopped are removed');
console.log('local ok');
