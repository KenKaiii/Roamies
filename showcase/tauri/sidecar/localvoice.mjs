// Speaks with a speech model served by Ollama (POST /v1/audio/speech), as an alternative to Fish Audio.
// Same shape as FishVoice: say(sentence) as they come, end(), abort(); onAudio gets 16-bit mono PCM, onEnd, onError.
// Ollama streams raw PCM at 24 kHz for response_format "pcm", one request per sentence (4096 characters at most),
// spoken in order. It reads numbers, URLs and markdown aloud sensibly itself, but not Fish's [cues], so those go.
export const LOCAL_RATE = 24000;
const MAX_INPUT = 4000; // Ollama refuses more than 4096 characters per request

// The model's replies carry Fish voice cues ("[warm] Hi"); a local voice would read them out.
export const plain = (text) => String(text ?? '').replace(/\[[^\]]*\]\s*/g, '').replace(/\s+/g, ' ').trim();

export function chunks(text, max = MAX_INPUT) {
  const out = [];
  let s = text;
  while (s.length > max) {
    const cut = Math.max(s.lastIndexOf('. ', max), s.lastIndexOf(', ', max), s.lastIndexOf(' ', max));
    const at = cut > max / 2 ? cut + 1 : max;
    out.push(s.slice(0, at).trim());
    s = s.slice(at).trim();
  }
  if (s) out.push(s);
  return out;
}

export class LocalVoice {
  // baseUrl ends in /v1. A cold model can take a while to load, so the first audio gets longer than the gaps after it.
  constructor({ baseUrl, model, voice = 'default', rate = LOCAL_RATE, fetchImpl = globalThis.fetch, onAudio, onEnd, onError, firstTimeout = 120_000, gapTimeout = 20_000 }) {
    Object.assign(this, { baseUrl, model, voice, rate, fetchImpl, onAudio, onEnd, onError, firstTimeout, gapTimeout });
    this.queue = [];
    this.state = 'new'; // new → open → ending → done
    this.heard = false;
    this.running = false;
    this.ctrl = new AbortController();
  }

  open() { if (this.state === 'new') this.state = 'open'; return this; }

  say(text) {
    if (this.state === 'done' || this.state === 'ending') return;
    const t = plain(text);
    if (!/[\p{L}\p{N}]/u.test(t)) return;
    this.open();
    this.queue.push(...chunks(t));
    this.pump();
  }

  end() {
    if (this.state === 'done' || this.state === 'ending') return;
    this.state = 'ending';
    if (!this.running && !this.queue.length) this.finish();
  }

  abort() { if (this.state === 'done') return; this.state = 'done'; this.queue = []; this.ctrl.abort(); }

  finish() { if (this.state === 'done') return; this.state = 'done'; this.onEnd?.(); }

  fail(e) {
    if (this.state === 'done') return;
    this.state = 'done'; this.queue = []; this.ctrl.abort();
    const err = e instanceof Error ? e : new Error(String(e));
    err.heard = this.heard;
    this.onError?.(err);
  }

  async pump() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length && this.state !== 'done') await this.speak(this.queue.shift());
    } catch (e) {
      if (this.state !== 'done') this.fail(e);
    } finally { this.running = false; }
    if (this.state === 'ending' && !this.queue.length) this.finish();
  }

  async speak(input) {
    let timer;
    const arm = (ms, why) => { clearTimeout(timer); timer = setTimeout(() => this.fail(new Error(why)), ms); };
    arm(this.firstTimeout, 'The local voice took too long to start');
    try {
      const res = await this.fetchImpl(`${this.baseUrl.replace(/\/+$/, '')}/audio/speech`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: this.ctrl.signal,
        body: JSON.stringify({ model: this.model, input, voice: this.voice, response_format: 'pcm' }),
      });
      if (!res.ok) {
        const body = (await res.text().catch(() => '')).slice(0, 160);
        throw new Error(`Ollama couldn't speak (${res.status})${body ? `: ${body}` : ''}`);
      }
      const reader = res.body.getReader();
      let odd = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (this.state === 'done') return;
        arm(this.gapTimeout, 'The local voice stopped sending audio');
        let b = value;
        if (odd !== null) { const j = new Uint8Array(b.length + 1); j[0] = odd; j.set(b, 1); b = j; odd = null; }
        if (b.length % 2) { odd = b[b.length - 1]; b = b.subarray(0, b.length - 1); }
        if (b.length) { this.heard = true; this.onAudio?.(b); }
      }
    } finally { clearTimeout(timer); }
  }
}
