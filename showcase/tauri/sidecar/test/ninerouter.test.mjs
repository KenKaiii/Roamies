import assert from 'node:assert/strict';
import { connectNineRouter, NINEROUTER_URL } from '../ninerouter.mjs';
const credentials = new Map(), writes = [], probes = [];
const auth = {
  getCredentials: async (id) => credentials.get(id),
  setLocalEndpoint: async (id, url, key) => { writes.push({ id, url, key }); credentials.set(`local:${id}`, { accessToken: key }); },
};
const model = (endpoint, rawId, supportsImages = true) => ({ endpointId: endpoint.id, rawId, contextWindow: 64000, contextWindowKnown: true, supportsTools: true, supportsImages, supportsThinking: false });
const probe = async (endpoint, options) => { assert.equal(options.timeoutMs, 30000); probes.push(endpoint); return { endpoint, reachable: true, models: [model(endpoint, 'other'), model(endpoint, 'my-combo')] }; };
const first = await connectNineRouter(auth, [], { key: 'test-key', images: true, probe });
assert.equal(first.ok, true);
assert.equal(first.savedServers.length, 1);
assert.equal(first.server.label, '9router');
assert.equal(first.server.baseUrl, NINEROUTER_URL);
assert.equal(first.selectedModel.id, 'local/9router/my-combo');
assert.equal(probes.at(-1).apiKey, 'test-key');
assert.equal(probes.at(-1).supportsImages, true);
const retry = await connectNineRouter(auth, first.savedServers, { probe });
assert.equal(retry.savedServers.length, 1, 'repeat Connect updates the existing router');
assert.equal(probes.at(-1).apiKey, 'test-key', 'empty key retains the saved credential');
const change = await connectNineRouter(auth, retry.savedServers, { baseUrl: 'http://localhost:20129', key: 'replacement', probe });
assert.equal(change.server.id, '9router');
assert.equal(change.savedServers.length, 1);
assert.equal(writes.at(-1).key, 'replacement');
assert.equal(change.server.baseUrl, 'http://localhost:20129/v1');
const alias = await connectNineRouter(auth, [{ id: 'my-router', label: 'Old name', baseUrl: NINEROUTER_URL }], { probe });
assert.equal(alias.server.id, 'my-router', 'same address is reused even under another name');
assert.equal(alias.savedServers[0].label, '9router');
const before = writes.length;
const down = await connectNineRouter(auth, [], { probe: async (endpoint) => ({ endpoint, reachable: false, reason: 'Not running', models: [] }) });
assert.equal(down.ok, false);
assert.match(down.error, /did not answer/);
assert.equal(writes.length, before, 'failed connection saves nothing');
const rejected = await connectNineRouter(auth, [], { probe: async (endpoint) => ({ endpoint, reachable: false, reason: 'rejected the API key', models: [] }) });
assert.match(rejected.error, /rejected/);
assert.equal((await connectNineRouter(auth, [], { baseUrl: 'http://user:secret@host/v1', probe })).ok, false);
const textOnly = await connectNineRouter(auth, [], { probe: async (endpoint) => ({ endpoint, reachable: true, models: [model(endpoint, 'text-only', false)] }) });
assert.equal(textOnly.ok, true);
assert.equal(textOnly.selectedModel, undefined, 'never selects a model without required capabilities');
const firstAvailable = await connectNineRouter(auth, [], { probe: async (endpoint) => ({ endpoint, reachable: true, models: [model(endpoint, 'vision-model')] }) });
assert.equal(firstAvailable.selectedModel.id, 'local/9router/vision-model');
console.log('Dedicated 9router connection tests: passed');

const named = await connectNineRouter(auth, [], { modelId: 'another-combo', probe: async (endpoint) => ({ endpoint, reachable: true, models: [model(endpoint, 'other'), model(endpoint, 'another-combo')] }) });
assert.equal(named.selectedModel.id, 'local/9router/another-combo', 'selects the user-entered combo');
assert.equal(named.savedServers[0].modelId, 'another-combo');
