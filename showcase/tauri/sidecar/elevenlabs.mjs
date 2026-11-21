// Spoken replies through ElevenLabs' text-to-speech API (the user's own key).
// There's no live socket: each sentence is its own streaming request, started the moment it's said, a few at a
// time. Audio is handed on strictly in the order the sentences were said: the first one plays as it streams, the
// ones behind it are held until it's their turn. Raw 16-bit mono PCM at 24 kHz comes back as the response body
// (output_format=pcm_24000). Same shape as GeminiVoice, so the speaker can use either.
import { CUE } from './speech.mjs';

export const ELEVEN_API = 'https://api.elevenlabs.io/v1';
// Priciest/most expressive first, like Fish's: a reply that fails on v3 before any audio is tried again on Flash.
export const ELEVEN_MODELS = ['eleven_v3', 'eleven_flash_v2_5'];
// The one used unless the user picks the other: the fast, cheaper one.
export const ELEVEN_MODEL = 'eleven_flash_v2_5';
// The two the user picks between (Settings > Voice in the panel). ElevenLabs bills in credits, so the panel shows
// the account note instead of a per-second price.
export const ELEVEN_CHOICES = [
  { id: 'eleven_flash_v2_5', name: 'Flash v2.5' },
  { id: 'eleven_v3', name: 'v3' },
];
export const ELEVEN_RATE = 24000;
export const ELEVEN_OUTPUT = 'pcm_24000';
// Rachel, the warm default.
export const ELEVEN_DEFAULT_VOICE = '21m00Tcm4TlvDq8ikWAM';
// Each look's own ElevenLabs voice until the user picks another for it (as each has its own Fish Audio voice).
export const ELEVEN_LOOK_VOICES = {
  classic: '21m00Tcm4TlvDq8ikWAM', // Rachel
  jarvis: 'JBFqnCBsd6RMkjVDRZzb', // George
  glayos: 'EXAVITQu4vr4xnSDxMaL', // Bella
  ultren: 'pNInz6obpgDQGcFmaJgB', // Adam
  anime: 'MF3mGyEYCl7XYWbV9V6O', // Elli
  sarah: 'AZnzlk1XvdvUeBnXmlld', // Domi
  adrian: 'TxGEqnHWrfWFTfGW9XjX', // Josh
  rita: 'yoZ06aMxZJJ28mfd3POQ', // Sam
};
// ElevenLabs' premade voices, the ones every account can use without cloning or adding one from the library.
export const ELEVEN_VOICES = [
  ['21m00Tcm4TlvDq8ikWAM', 'Rachel', 'Warm, calm'],
  ['JBFqnCBsd6RMkjVDRZzb', 'George', 'Warm, British'],
  ['EXAVITQu4vr4xnSDxMaL', 'Bella', 'Soft, young'],
  ['pNInz6obpgDQGcFmaJgB', 'Adam', 'Deep, steady'],
  ['MF3mGyEYCl7XYWbV9V6O', 'Elli', 'Young, bright'],
  ['AZnzlk1XvdvUeBnXmlld', 'Domi', 'Friendly, upbeat'],
  ['TxGEqnHWrfWFTfGW9XjX', 'Josh', 'Young, clear'],
  ['yoZ06aMxZJJ28mfd3POQ', 'Sam', 'Raspy, casual'],
].map(([id, name, style]) => ({ id, name, style }));
// Sentences being made at once. Three is what Gemini's account allowed; ElevenLabs' concurrency depends on the plan.
const MAX_IN_FLIGHT = 3;

// ElevenLabs reads its text word for word, so the Fish voice cues ("[warm] Hello") must not be in it. They're taken
// out, along with a free description at the start ("[quietly proud]"), since ElevenLabs has no mood parameter here.
const LEAD = /^\s*\[([a-z]+(?:[ ,-]+[a-z]+){0,3})\]\s*/;
export function plain(text) {
  return String(text ?? '').replace(LEAD, '').replace(CUE, '').replace(/\s{2,}/g, ' ').trim();
}

export const speechRequest = (text, { model = ELEVEN_MODEL } = {}) => ({
  text,
  model_id: model,
  voice_settings: { stability: 0.4, similarity_boost: 0.75, style: 0.25, use_speaker_boost: true },
  // Flash leaves numbers alone by default; a reply should say "24" the way it's written.
  ...(model === 'eleven_flash_v2_5' ? { apply_text_normalization: 'on' } : {}),
});

/** Is the key good? Never throws. Same answer shape as fishAccount; the credit is in characters, not money. */
export async function elevenAccount(key, { fetchImpl = fetch, timeout = 6000 } = {}) {
  try {
    const r = await fetchImpl(`${ELEVEN_API}/user/subscription`, { headers: { 'xi-api-key': key }, signal: AbortSignal.timeout(timeout) });
    if (r.status === 401 || r.status === 403) return { ok: false, reason: 'key' };
    if (!r.ok) return { ok: false, reason: 'network' };
    return { ok: true, credit: null };
  } catch {
    return { ok: false, reason: 'network' };
  }
}

// Useful error detail from the API's JSON ("detail.message" or "detail[0].msg"); the status when it says nothing.
async function why(r) {
  const text = await r.text().catch(() => '');
  try {
    const j = JSON.parse(text), d = j.detail;
    return (typeof d === 'string' ? d : d?.message ?? d?.[0]?.msg) ?? j.message ?? `error ${r.status}`;
  } catch {
    return text.slice(0, 200) || `error ${r.status}`;
  }
}

/**
 * One reply's voice. say() as many times as needed, then end(). abort() stops at once, silently.
 * onAudio(Uint8Array) gets PCM (whole 16-bit samples); onEnd() once after the last audio; onError(err) instead
 * of onEnd when it fails (heard = whether any audio had arrived; status = the HTTP status, if there was one).
 * It never says a failure is the key's fault: a 400 is also what an unknown voice gets. The speaker checks.
 */
export class ElevenVoice {
  constructor({ key, voice = ELEVEN_DEFAULT_VOICE, model = ELEVEN_MODEL, fetchImpl = fetch, onAudio, onEnd, onError, audioTimeout = 8000, maxInFlight = MAX_IN_FLIGHT }) {
    Object.assign(this, { key, voice, model, fetchImpl, onAudio, onEnd, onError, audioTimeout, maxInFlight });
    this.jobs = []; // one per sentence, in the order said: { text, chunks, state: waiting → running → done }
    this.head = 0; // the sentence whose audio is being handed on now
    this.state = 'open'; // open → ending → done
    this.heard = false;
    this.stopper = new AbortController();
  }

  open() { return this; } // nothing to connect ahead of time

  say(text) {
    if (this.state !== 'open') return;
    const t = plain(text);
    if (!/[\p{L}\p{N}]/u.test(t)) return; // nothing to say ("…", a lone cue): asking would get no audio and fail the reply
    this.jobs.push({ text: t, chunks: [], state: 'waiting', odd: null, timer: null });
    this.pump();
  }

  end() {
    if (this.state !== 'open') return;
    this.state = 'ending';
    this.drain();
  }

  abort() { this.close(); }

  // Start the sentences that are waiting, up to the limit.
  pump() {
    let running = this.jobs.filter((j) => j.state === 'running').length;
    for (const j of this.jobs) {
      if (running >= this.maxInFlight) break;
      if (j.state === 'waiting') { running++; this.run(j); }
    }
  }

  async run(job) {
    job.state = 'running';
    const arm = () => { clearTimeout(job.timer); job.timer = setTimeout(() => this.fail(new Error('ElevenLabs stopped sending audio')), this.audioTimeout); };
    arm();
    try {
      const r = await this.fetchImpl(`${ELEVEN_API}/text-to-speech/${encodeURIComponent(this.voice)}/stream?output_format=${ELEVEN_OUTPUT}`, {
        method: 'POST', headers: { 'xi-api-key': this.key, 'content-type': 'application/json', accept: 'audio/pcm' },
        body: JSON.stringify(speechRequest(job.text, { model: this.model })), signal: this.stopper.signal,
      });
      if (!r.ok) {
        const said = await why(r);
        throw Object.assign(new Error(r.status === 429 ? 'ElevenLabs is rate limiting (the monthly allowance may be used up for now)' : `ElevenLabs: ${said}`), { status: r.status });
      }
      let got = false;
      for await (const part of r.body) {
        if (this.state === 'done') return;
        const pcm = this.whole(job, part);
        if (!pcm.length) continue;
        got = true; arm();
        job.chunks.push(pcm);
        this.drain();
      }
      if (!got) throw new Error('ElevenLabs sent no audio');
    } catch (e) {
      return this.fail(e);
    }
    if (this.state === 'done') return;
    clearTimeout(job.timer);
    job.state = 'done';
    this.pump();
    this.drain();
  }

  // Hand on what's ready, in the order said; a sentence still streaming holds back the ones after it.
  drain() {
    while (this.state !== 'done' && this.head < this.jobs.length) {
      const j = this.jobs[this.head];
      for (const pcm of j.chunks.splice(0)) { this.heard = true; this.onAudio?.(pcm); }
      if (j.state !== 'done') return;
      this.head++;
    }
    if (this.state === 'ending') { this.close(); this.onEnd?.(); }
  }

  // PCM samples are 2 bytes; a chunk can end mid-sample, so carry the odd byte into the sentence's next one.
  whole(job, bytes) {
    let b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (job.odd != null) { const c = new Uint8Array(b.length + 1); c[0] = job.odd; c.set(b, 1); b = c; job.odd = null; }
    if (b.length % 2) { job.odd = b[b.length - 1]; b = b.subarray(0, b.length - 1); }
    return b;
  }

  close() {
    if (this.state === 'done') return;
    this.state = 'done';
    for (const j of this.jobs) clearTimeout(j.timer);
    this.stopper.abort();
  }

  fail(err) {
    if (this.state === 'done') return;
    this.close();
    err.heard = this.heard;
    this.onError?.(err);
  }
}
