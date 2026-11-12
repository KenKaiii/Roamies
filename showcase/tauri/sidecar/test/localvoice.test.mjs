// Spoken replies from a speech model served by Ollama. Run: npm test
import assert from 'node:assert/strict';
import { LOCAL_RATE, LocalVoice, chunks, plain } from '../localvoice.mjs';
import { createSpeaker } from '../speaker.mjs';

assert.equal(plain('[warm] Hi there. [quietly, a little embarrassed] Sorry.'), 'Hi there. Sorry.', 'Fish cues are never read out');
assert.equal(chunks('a'.repeat(9000), 4000).every((c) => c.length <= 4000), true, 'Ollama takes 4096 characters at most');
assert.deepEqual(chunks('Short one.'), ['Short one.']);

// A fake Ollama: streams PCM in odd-sized pieces, records each request.
const calls = [];
const streamOf = (parts) => new ReadableStream({ start(c) { for (const p of parts) c.enqueue(new Uint8Array(p)); c.close(); } });
const fakeFetch = (status = 200, parts = [[1, 2, 3], [4, 5, 6, 7, 8]]) => async (url, init) => {
  calls.push({ url, body: JSON.parse(init.body) });
  return status === 200 ? { ok: true, status, body: streamOf(parts) } : { ok: false, status, text: async () => 'model "x" does not support speech', body: null };
};
const run = (impl, say = ['[warm] Hello.', 'Second one.']) => new Promise((resolve) => {
  const got = { audio: [], end: false, err: null };
  const v = new LocalVoice({ baseUrl: 'http://127.0.0.1:11434/v1', model: 'phonon', fetchImpl: impl, onAudio: (b) => got.audio.push(...b), onEnd: () => { got.end = true; resolve(got); }, onError: (e) => { got.err = e; resolve(got); } }).open();
  for (const s of say) v.say(s);
  v.end();
});

const ok = await run(fakeFetch());
assert.equal(ok.end, true);
assert.deepEqual(ok.audio, [1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 3, 4, 5, 6, 7, 8], 'both sentences, in order, none dropped');
assert.deepEqual(calls.map((c) => c.body.input), ['Hello.', 'Second one.']);
assert.deepEqual(calls[0].body, { model: 'phonon', input: 'Hello.', voice: 'default', response_format: 'pcm' });
assert.equal(calls[0].url, 'http://127.0.0.1:11434/v1/audio/speech');

const odd = [];
await new Promise((resolve) => {
  const v = new LocalVoice({ baseUrl: 'http://x/v1', model: 'm', fetchImpl: fakeFetch(200, [[1], [2, 3], [4]]), onAudio: (b) => { assert.equal(b.length % 2, 0, 'samples are whole'); odd.push(...b); }, onEnd: resolve, onError: resolve });
  v.say('Hi.'); v.end();
});
assert.deepEqual(odd, [1, 2, 3, 4], 'a byte split across chunks is joined, not lost');

const bad = await run(fakeFetch(400));
assert.equal(bad.end, false);
assert.match(bad.err.message, /400.*does not support speech/);
assert.equal(bad.err.heard, false);

// Through the speaker: audio goes to the overlay at 24 kHz, and Fish is never asked.
const out = [];
let fish = 0;
const sp = createSpeaker({
  emit: (m) => out.push(m), onProblem: (w) => out.push({ problem: w }),
  FishVoiceImpl: class { constructor() { fish++; } open() { return this; } say() {} end() {} abort() {} },
  LocalVoiceImpl: class extends LocalVoice { constructor(o) { super({ ...o, fetchImpl: fakeFetch() }); } },
});
assert.equal(sp.on, false);
assert.equal(sp.start(), null, 'no key and no local voice: no speech');
sp.setLocal({ baseUrl: 'http://127.0.0.1:11434/v1', model: 'phonon' });
assert.equal(sp.on, true);
assert.equal(sp.hasKey, false, 'a local voice is not a Fish key');
const r = sp.start();
r.say('[happy] Hi.'); r.end();
await new Promise((res) => setTimeout(res, 30));
const audio = out.filter((m) => m.pcm);
assert.ok(audio.length && audio.every((m) => m.rate === LOCAL_RATE && m.id === r.id));
assert.ok(out.some((m) => m.end && m.id === r.id), 'the reply ends');
assert.equal(fish, 0, 'Fish is not touched while the local voice is on');

// An error before any audio says so once, and the reply ends as text.
out.length = 0;
const sp2 = createSpeaker({ emit: (m) => out.push(m), onProblem: (w) => out.push({ problem: w }), LocalVoiceImpl: class extends LocalVoice { constructor(o) { super({ ...o, fetchImpl: fakeFetch(400) }); } } });
sp2.setLocal({ baseUrl: 'http://x/v1', model: 'nope' });
const r2 = sp2.start(); r2.say('Hi.'); r2.end();
await new Promise((res) => setTimeout(res, 30));
assert.ok(out.some((m) => m.problem && /400/.test(m.problem)));
assert.ok(out.some((m) => m.end && m.id === r2.id));
console.log('localvoice ok');
