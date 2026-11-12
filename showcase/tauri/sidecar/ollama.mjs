// Ollama on this computer as the brain, in place of a cloud AI. gg-core finds its models and gg-ai talks to its
// OpenAI-compatible API (tool calls included); this keeps track of which models can run Roamies and why not.
// Only models that call tools are offered: without tools Roamies can't point, draw, remember or use apps.
// Nothing here ever reaches for a cloud provider: when Ollama can't answer, `problem()` says why in plain words.
import {
  discoverLocalModels, formatLocalModelId, localModelShortName, ollamaServedContext, parseLocalModelId, registerRuntimeModels, toModelInfo,
} from '@kenkaiiii/gg-core';

export const OLLAMA = Object.freeze({ id: 'ollama', label: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', kind: 'ollama' });
// Roamies' instructions and tool definitions take about 12K tokens before the conversation starts. Below this the
// server cuts the start of the prompt (Ollama drops it silently), so the model loses its instructions and tools.
export const MIN_CONTEXT = 16_384;
export const GOOD_CONTEXT = 32_768;
// What to pull when there's nothing that calls tools (both are in Ollama's library with the "tools" tag).
const SUGGEST = 'qwen3 or gpt-oss';

const k = (n) => `${Math.round(n / 1024)}K`;

/**
 * The Ollama brain. `discover`, `served` and `register` are gg-core's, swappable in tests.
 * State: { checked, ok, reason, models: [{ id, raw, name, context, contextKnown, images, thinking }], noTools: [names] }.
 */
export function createOllama({ endpoint = OLLAMA, discover = discoverLocalModels, served = ollamaServedContext, register = registerRuntimeModels } = {}) {
  let state = { checked: false, ok: false, reason: null, models: [], noTools: [] };

  const publish = (m, local) => {
    register([{ ...toModelInfo(local, endpoint), name: localModelShortName(m.raw) }]);
  };

  return {
    endpoint,
    get state() { return state; },
    /** Asks Ollama what it serves (cached 30 s by gg-core; `force` for Check again). Never throws. */
    async check({ force = false } = {}) {
      let probe;
      try { probe = (await discover([endpoint], { force })).probes.find((p) => p.endpoint.id === endpoint.id); } catch (e) { probe = { reachable: false, reason: String(e?.message ?? e), models: [] }; }
      if (!probe?.reachable) {
        state = { checked: true, ok: false, reason: 'offline', detail: probe?.reason ?? null, models: [], noTools: [] };
        return state;
      }
      const models = [], noTools = [];
      for (const lm of probe.models) {
        const id = formatLocalModelId(endpoint.id, lm.rawId);
        if (!lm.supportsTools) { noTools.push(localModelShortName(lm.rawId)); continue; }
        // A context measured earlier (the model loaded) beats what the list guesses for an unloaded one.
        const before = state.models.find((x) => x.id === id);
        const keep = before?.contextKnown && !lm.contextWindowKnown;
        const m = {
          id, raw: lm.rawId, name: localModelShortName(lm.rawId),
          context: keep ? before.context : lm.contextWindow, contextKnown: keep || lm.contextWindowKnown,
          images: lm.supportsImages, thinking: lm.supportsThinking,
        };
        publish(m, { ...lm, contextWindow: m.context });
        models.push(m);
      }
      state = { checked: true, ok: models.length > 0, reason: models.length ? null : probe.models.length ? 'no_tools' : 'empty', models, noTools };
      return state;
    },
    has: (id) => state.models.some((m) => m.id === id),
    find: (id) => state.models.find((m) => m.id === id) ?? null,
    /** The model to use: `want` if Ollama still has it, else (only when nothing was picked) the first one. */
    pick(want) {
      if (want && this.has(want)) return want;
      return want ? null : state.models[0]?.id ?? null;
    },
    /** Loads the model the way a reply would and reads the context Ollama really gives it. */
    async measure(id, { signal } = {}) {
      const m = this.find(id), parsed = parseLocalModelId(id ?? '');
      if (!m || !parsed) return null;
      const ctx = await served(endpoint, parsed.rawId, { load: true, signal }).catch(() => undefined);
      if (!ctx) return null;
      m.context = ctx; m.contextKnown = true;
      publish(m, { rawId: m.raw, endpointId: endpoint.id, contextWindow: ctx, contextWindowKnown: true, supportsTools: true, supportsImages: m.images, supportsThinking: m.thinking });
      return ctx;
    },
    /** What the agent signs in with: no key (Ollama takes none), and where Ollama is. */
    creds: () => ({ accessToken: 'local', refreshToken: '', expiresAt: Number.MAX_SAFE_INTEGER, baseUrl: endpoint.baseUrl }),
    /** Why Ollama can't answer with `id` right now (a sentence for the user), or null when it can. */
    problem(id) {
      if (!state.checked) return 'Checking Ollama… ask me again in a moment.';
      if (state.reason === 'offline') return "Ollama isn't running. Open Ollama, then press Check again on the Model page.";
      if (state.reason === 'empty') return `Ollama has no models yet. Pull one that can use tools, like ${SUGGEST} (ollama pull qwen3), then press Check again.`;
      if (state.reason === 'no_tools') return `None of your Ollama models can use tools, and I need tools to do things for you. Pull one that can, like ${SUGGEST}, then press Check again.`;
      if (!id) return 'Pick an Ollama model on the Model page.';
      if (!this.has(id)) return `${localModelShortName(parseLocalModelId(id)?.rawId ?? id)} isn't in Ollama anymore. Pick another model on the Model page.`;
      return null;
    },
    /** A warning when Ollama gives the model too small a context for Roamies' instructions and tools, else null. */
    contextNote(id) {
      const m = this.find(id);
      if (!m?.contextKnown || m.context >= MIN_CONTEXT) return null;
      return `Ollama runs ${m.name} with a ${k(m.context)} context, too small for my instructions and tools, so it will forget them. Set the context length in Ollama's settings to ${k(GOOD_CONTEXT)} or more, then press Check again.`;
    },
  };
}

/**
 * The config fields that change when the brain switches to `to` ('cloud' or 'ollama'): each side's pick is kept while the
 * other answers, so switching back restores it. Ollama's provider is gg-core's 'local'. {} when there's nothing to do.
 */
export function switchBrain(config, to) {
  if (!['cloud', 'ollama'].includes(to) || (config.brain ?? 'cloud') === to) return {};
  if (to === 'ollama') {
    const cloud = config.provider && config.provider !== 'local' ? { provider: config.provider, model: config.model } : config.cloud ?? null;
    return { brain: 'ollama', cloud, provider: 'local', model: config.ollamaModel ?? null };
  }
  const ollamaModel = config.provider === 'local' ? config.model ?? config.ollamaModel ?? null : config.ollamaModel ?? null;
  return { brain: 'cloud', ollamaModel, provider: config.cloud?.provider ?? null, model: config.cloud?.model ?? null };
}

/** A saved config made consistent: an unknown brain is Cloud, Ollama always runs on 'local', Cloud never does. */
export function normalBrain(config) {
  const brain = config.brain === 'ollama' ? 'ollama' : 'cloud';
  if (brain === 'ollama') return config.provider === 'local' ? { brain } : { brain, provider: 'local', model: config.ollamaModel ?? null };
  return config.provider === 'local' ? { brain, provider: config.cloud?.provider ?? null, model: config.cloud?.model ?? null } : { brain };
}
