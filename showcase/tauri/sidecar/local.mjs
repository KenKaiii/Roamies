// Local AI: models served on this computer by Ollama, no account and no key. gg-core finds them (probeEndpoint /
// discoverLocalModels), names them `local/ollama/<model>` and keeps each endpoint's URL in auth.json under `local:ollama`,
// so the agent resolves a local model through the same credsFor as any other provider.
// Roamies hands its agent tools (reminders, memory, pointing, drawing), so only models the server says can call
// tools are offered; the rest would fail on the first request.
import {
  DEFAULT_LOCAL_ENDPOINTS, clearRuntimeModels, clearLocalDiscoveryCache, discoverLocalModels, localAuthStorageKey, ollamaServedContext, registerRuntimeModels, toModelInfo,
} from '@kenkaiiii/gg-core';

export const LOCAL_PROVIDER = 'local';
export const LOCAL_LABEL = 'Local (Ollama)';
export const OLLAMA = DEFAULT_LOCAL_ENDPOINTS.find((e) => e.id === 'ollama') ?? { id: 'ollama', label: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', kind: 'ollama' };
export const OLLAMA_KEY = localAuthStorageKey(OLLAMA.id);

/** The server root without /v1, where Ollama's own API lives. */
export const ollamaRoot = (baseUrl = OLLAMA.baseUrl) => baseUrl.replace(/\/v1\/?$/, '').replace(/\/+$/, '');

// Liquid AI's omni models: they take audio and text in and give text or speech out. Matches lfm3-omni, lfm2.5-omni, hf.co/LiquidAI/…-Omni-…
export const isOmni = (rawId) => /lfm[\w.-]*omni|omni[\w.-]*lfm/i.test(String(rawId ?? '')) || /liquidai\/[^/]*omni/i.test(String(rawId ?? ''));

/**
 * Look for Ollama, register what it serves as models, and save its URL as the credential.
 * Resolves { reachable, reason?, models: [{ id, name, tools, omni }], skipped }. Never throws.
 * `discover` is injectable for tests.
 */
export async function scanLocal(auth, { force = false, discover = discoverLocalModels, served = ollamaServedContext, speech = findSpeech, endpoint = OLLAMA } = {}) {
  let result;
  try {
    if (force) clearLocalDiscoveryCache();
    result = await discover([endpoint], { force });
  } catch (e) {
    result = { probes: [{ endpoint, reachable: false, reason: String(e?.message ?? e), models: [] }], models: [] };
  }
  const probe = result.probes.find((p) => p.endpoint.id === endpoint.id) ?? result.probes[0];
  clearRuntimeModels((m) => m.provider === LOCAL_PROVIDER);
  if (!probe?.reachable) {
    await auth.removeLocalEndpoint(endpoint.id).catch(() => {});
    return { reachable: false, reason: probe?.reason ?? 'Ollama is not running', models: [], skipped: 0, speech: [] };
  }
  const usable = probe.models.filter((m) => m.supportsTools).map((m) => ({ ...m }));
  // Ollama only decides a model's window when it loads it. On Connect, load the one we'd use and read the real
  // number; a guess of 4096 would cut Roamies' prompt down to nothing.
  if (force) {
    const pick = usable.find((m) => isOmni(m.rawId) && !m.contextWindowKnown) ?? usable.find((m) => !m.contextWindowKnown);
    if (pick) {
      const n = await served(endpoint, pick.rawId, { load: true }).catch(() => undefined);
      if (n) { pick.contextWindow = n; pick.contextWindowKnown = true; }
    }
  }
  registerRuntimeModels(usable.map((m) => toModelInfo(m, endpoint)));
  if (usable.length) await auth.setLocalEndpoint(endpoint.id, endpoint.baseUrl);
  else await auth.removeLocalEndpoint(endpoint.id).catch(() => {});
  const spoken = await speech(endpoint);
  return {
    reachable: true,
    speech: spoken,
    models: usable.map((m) => ({ id: `local/${endpoint.id}/${m.rawId}`, name: m.rawId, tools: true, omni: isOmni(m.rawId), ctx: m.contextWindowKnown ? m.contextWindow : null })),
    skipped: probe.models.filter((m) => !m.supportsTools && !spoken.some((x) => x.name === m.rawId)).length, // speech models aren't "no tools"
  };
}

// Roamies' instructions and tools take several thousand tokens before the first word is said.
export const MIN_CONTEXT = 8192;

/**
 * Models Ollama can speak with: the ones whose /api/show lists the "speech" capability (Ollama's own is `phonon`;
 * an omni model qualifies if it reports it). Resolves [{ name, omni }], an omni model first. Never throws.
 */
export async function findSpeech(endpoint = OLLAMA, { fetchImpl = globalThis.fetch, timeoutMs = 4000 } = {}) {
  const root = ollamaRoot(endpoint.baseUrl);
  const get = async (path, body) => {
    const res = await fetchImpl(`${root}${path}`, {
      method: body ? 'POST' : 'GET', ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`${path} ${res.status}`);
    return res.json();
  };
  try {
    const tags = await get('/api/tags');
    const names = (tags.models ?? []).map((m) => m.name ?? m.model).filter((n) => typeof n === 'string');
    const shown = await Promise.all(names.map((name) => get('/api/show', { model: name }).then((s) => ({ name, caps: s.capabilities ?? [] })).catch(() => null)));
    return shown.filter((m) => m?.caps.includes('speech')).map((m) => ({ name: m.name, omni: isOmni(m.name) })).sort((a, b) => b.omni - a.omni);
  } catch { return []; }
}

/** The first omni model among the scan's models, else null: what voice in and out run on. */
export const omniModel = (models) => models.find((m) => m.omni)?.name ?? null;
