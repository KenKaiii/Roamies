import { parseLocalModelId } from '@kenkaiiii/gg-core';
import { connectLocal, newServer, serverList, serverUrl } from './local.mjs';
import { probeNineRouter } from './ninerouter-probe.mjs';

export const NINEROUTER_URL = 'http://127.0.0.1:20128/v1';
export const isNineRouter = (server) => server?.label?.toLowerCase() === '9router';

// Use the same authentication as other custom servers, probing only the named model. Retry/update a saved
// router in place, so a changed key or repeated Connect never adds duplicate server entries.
export async function connectNineRouter(auth, saved, { baseUrl = NINEROUTER_URL, key, images = false, modelId = 'my-combo', windows, probe } = {}) {
  const url = serverUrl(baseUrl);
  if (!url) return { ok: false, error: 'Enter a valid 9router address starting with http:// or https://.' };
  const list = Array.isArray(saved) ? saved : [];
  const existing = list.find((s) => s?.baseUrl === url) ?? list.find(isNineRouter);
  const made = existing
    ? { server: { ...existing, label: '9router', baseUrl: url, images: images === true } }
    : newServer(list, { label: '9router', baseUrl: url, images });
  if (made.error) return { ok: false, error: made.error };
  made.server = { ...made.server, modelId: String(modelId).trim().slice(0, 200) || 'my-combo' };
  const server = serverList([made.server]).find((s) => s.id === made.server.id);
  if (!server) return { ok: false, error: 'The saved 9router settings are invalid. Remove that server and try again.' };
  const connection = await connectLocal(auth, server, { save: true, apiKey: key?.trim() || undefined, windows, probe: probe ?? ((endpoint, options) => probeNineRouter(endpoint, { ...options, verify: true })) });
  if (!connection.ok) return { ok: false, error: /rejected/.test(connection.reason ?? '')
    ? '9router rejected the API key. Check the key in your 9router dashboard.'
    : `9router did not answer at ${url}. Open its dashboard and check that the server is ready, then try again.` };
  const selectedModel = connection.models.find((m) => parseLocalModelId(m.id)?.rawId?.toLowerCase() === server.modelId.toLowerCase()) ?? connection.models[0];
  return { ok: true, server, connection, selectedModel,
    savedServers: existing ? list.map((s) => s?.id === existing.id ? made.server : s) : [...list, made.server] };
}
