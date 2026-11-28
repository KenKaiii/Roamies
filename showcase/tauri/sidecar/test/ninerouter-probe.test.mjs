import assert from 'node:assert/strict';
import { probeNineRouter } from '../ninerouter-probe.mjs';
const endpoint = { id: '9router', label: '9router', baseUrl: 'http://127.0.0.1:20128/v1', modelId: 'my-combo', apiKey: 'test-key', supportsImages: true };
const calls = [];
const fetchImpl = async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ choices: [{ message: { content: 'OK' } }] }), body: { cancel: async () => {} } }; };
const connected = await probeNineRouter(endpoint, { verify: true, fetchImpl });
assert.equal(connected.reachable, true);
assert.equal(connected.models[0].rawId, 'my-combo');
assert.equal(connected.models[0].supportsImages, true);
assert.equal(calls[0].url, endpoint.baseUrl + '/chat/completions');
assert.equal(calls[0].options.headers.Authorization, 'Bearer test-key');
assert.deepEqual(JSON.parse(calls[0].options.body), { model: 'my-combo', messages: [{ role: 'user', content: 'Reply with OK.' }], max_tokens: 8, stream: false });
await probeNineRouter(endpoint, { fetchImpl });
assert.equal(calls.at(-1).url, 'http://127.0.0.1:20128/dashboard');
assert.equal(calls.at(-1).options.body, undefined, 'routine refreshes do not generate paid replies');
assert.equal(calls.at(-1).options.headers.Authorization, undefined, 'no key sent to the dashboard');
for (const status of [401, 403]) {
  const denied = await probeNineRouter(endpoint, { verify: true, fetchImpl: async () => ({ ok: false, status }) });
  assert.equal(denied.reachable, false); assert.match(denied.reason, /rejected/);
}
const invalid = await probeNineRouter(endpoint, { verify: true, fetchImpl: async () => ({ ok: true, json: async () => ({ error: 'bad reply' }) }) });
assert.equal(invalid.reachable, false);
const offline = await probeNineRouter(endpoint, { fetchImpl: async () => { throw new Error('network'); } });
assert.equal(offline.reachable, false);
assert.equal((await probeNineRouter({ ...endpoint, supportsImages: undefined }, { fetchImpl })).models[0].supportsImages, false, 'image support is never invented');
console.log('Direct my-combo connection tests: passed');
