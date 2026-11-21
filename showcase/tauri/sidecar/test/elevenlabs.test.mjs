import assert from 'node:assert/strict';
import { ELEVEN_API, ELEVEN_DEFAULT_VOICE, ELEVEN_LOOK_VOICES, ELEVEN_MODEL, ELEVEN_MODELS, ELEVEN_RATE, ELEVEN_VOICES, ElevenVoice, elevenAccount, plain, speechRequest } from '../elevenlabs.mjs';

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const VOICE = '21m00Tcm4TlvDq8ikWAM';

// A streamed response body the test feeds by hand.
class Body {
  constructor() { this.parts = []; this.over = false; this.wake = null; this.boom = null; }
  push(bytes) { this.parts.push(Uint8Array.from(bytes)); this.wake?.(); }
  close() { this.over = true; this.wake?.(); }
  fail(e) { this.boom = e; this.wake?.(); }
  async *[Symbol.asyncIterator]() {
    for (;;) {
      while (this.parts.length) yield this.parts.shift();
      if (this.boom) throw this.boom;
      if (this.over) return;
      await new Promise((r) => { this.wake = r; });
    }
  }
}
// A fake fetch: every call gets its own Body (or the response `answer` gives), and is kept for the test to read.
const run = (opts = {}, answer = null) => {
  const got = { audio: [], ended: 0, errors: [] }, calls = [];
  const fetchImpl = async (url, init) => {
    const call = { url, init, sent: JSON.parse(init.body), body: new Body() };
    calls.push(call);
    return answer?.(call) ?? { ok: true, status: 200, body: call.body };
  };
  const v = new ElevenVoice({ key: 'xi-test', voice: VOICE, fetchImpl, onAudio: (a) => got.audio.push([...a]), onEnd: () => got.ended++, onError: (e) => got.errors.push(e), ...opts });
  return { v, got, calls };
};

// The voices: no doubles, the default among them, and a voice for every look.
assert.equal(ELEVEN_VOICES.length, 8);
assert.equal(new Set(ELEVEN_VOICES.map((x) => x.id)).size, 8);
assert.ok(ELEVEN_VOICES.some((x) => x.id === ELEVEN_DEFAULT_VOICE));
assert.ok(ELEVEN_VOICES.every((x) => x.id && x.name && x.style));
assert.deepEqual(Object.keys(ELEVEN_LOOK_VOICES), ['classic', 'jarvis', 'glayos', 'ultren', 'anime', 'sarah', 'adrian', 'rita'], 'the same looks as sidekick.mjs LOOKS');
for (const v of Object.values(ELEVEN_LOOK_VOICES)) assert.ok(ELEVEN_VOICES.some((x) => x.id === v), `${v} is an ElevenLabs voice`);
assert.equal(new Set(Object.values(ELEVEN_LOOK_VOICES)).size, 8);
assert.deepEqual(ELEVEN_MODELS, ['eleven_v3', 'eleven_flash_v2_5']);
assert.equal(ELEVEN_MODEL, 'eleven_flash_v2_5');
assert.equal(ELEVEN_RATE, 24000);

// Fish voice cues never reach ElevenLabs (it would read them out); a draft's brackets stay.
assert.equal(plain('[warm] Hello there.'), 'Hello there.');
assert.equal(plain('[quietly proud] Done.'), 'Done.');
assert.equal(plain('[chuckling] Ha, [emphasis] yes.'), 'Ha, yes.');
assert.equal(plain('[break] [excited] It worked!'), 'It worked!');
assert.equal(plain('Dear [Landlord Name], hello.'), 'Dear [Landlord Name], hello.');
assert.equal(plain('[warm]'), '');
assert.equal(plain('  two   spaces  '), 'two spaces');

// The request: the documented shape, with Flash's number normalisation turned on and v3's left off.
assert.deepEqual(speechRequest('Hi.', { model: 'eleven_flash_v2_5' }), {
  text: 'Hi.', model_id: 'eleven_flash_v2_5',
  voice_settings: { stability: 0.4, similarity_boost: 0.75, style: 0.25, use_speaker_boost: true },
  apply_text_normalization: 'on',
});
assert.equal('apply_text_normalization' in speechRequest('Hi.', { model: 'eleven_v3' }), false);

{ // Each sentence is its own request, started at once; audio comes out in the order said, whatever arrives first.
  const { v, got, calls } = run();
  assert.equal(v.open(), v);
  v.say('[warm] One.'); v.say('Two.');
  await tick();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, `${ELEVEN_API}/text-to-speech/${VOICE}/stream?output_format=pcm_24000`);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['xi-api-key'], 'xi-test');
  assert.equal(calls[0].sent.text, 'One.');
  assert.equal(calls[0].sent.model_id, ELEVEN_MODEL);
  assert.equal(calls[1].sent.text, 'Two.');
  calls[1].body.push([7, 8]); await tick();
  assert.deepEqual(got.audio, [], 'the second sentence waits for the first');
  calls[0].body.push([1, 2]); await tick();
  assert.deepEqual(got.audio, [[1, 2]], 'the first one plays as it streams');
  calls[0].body.push([3, 4]); calls[0].body.close(); await tick();
  assert.deepEqual(got.audio, [[1, 2], [3, 4], [7, 8]]);
  v.end(); await tick();
  assert.equal(got.ended, 0, 'not over until the last sentence is');
  calls[1].body.push([9, 10]); calls[1].body.close(); await tick();
  assert.deepEqual(got.audio, [[1, 2], [3, 4], [7, 8], [9, 10]]);
  assert.equal(got.ended, 1); assert.equal(got.errors.length, 0);
  v.say('Late.'); v.end(); await tick();
  assert.equal(calls.length, 2); assert.equal(got.ended, 1);
}
{ // A sample split across network chunks: the odd byte is carried into the next chunk.
  const { v, got, calls } = run();
  v.say('Hi.'); await tick();
  calls[0].body.push([1, 2, 3]); await tick();
  assert.deepEqual(got.audio, [[1, 2]], 'the half sample waits');
  calls[0].body.push([4, 5, 6]); calls[0].body.close(); v.end(); await tick();
  assert.deepEqual(got.audio, [[1, 2], [3, 4, 5, 6]]);
  assert.equal(got.ended, 1);
}
{ // Only a few at once: the rest start as the earlier ones finish.
  const { v, got, calls } = run({ maxInFlight: 2 });
  for (const s of ['A.', 'B.', 'C.']) v.say(s);
  v.end(); await tick();
  assert.equal(calls.length, 2);
  calls[1].body.push([3, 3]); calls[1].body.close(); await tick();
  assert.equal(calls.length, 3, 'a finished one frees a place, even out of turn');
  calls[0].body.push([1, 1]); calls[0].body.close();
  calls[2].body.push([5, 5]); calls[2].body.close(); await tick();
  assert.deepEqual(got.audio, [[1, 1], [3, 3], [5, 5]]);
  assert.equal(got.ended, 1);
}
{ // Nothing said (or only a cue, or only punctuation): end() reports done without asking ElevenLabs for anything.
  const { v, got, calls } = run();
  v.say(''); v.say('[warm]'); v.say('…'); v.say('[sighing] ...'); v.end(); await tick();
  assert.equal(calls.length, 0); assert.equal(got.ended, 1);
}
{ // abort(): silent, and the requests are cancelled.
  const { v, got, calls } = run();
  v.say('Hi.'); await tick();
  calls[0].body.push([1, 2]); await tick();
  v.abort();
  assert.equal(calls[0].init.signal.aborted, true);
  calls[0].body.push([3, 4]); calls[0].body.close(); await tick();
  assert.deepEqual(got.audio, [[1, 2]]); assert.equal(got.ended, 0); assert.equal(got.errors.length, 0);
}
{ // Refused (an unknown voice is a 400 too, so the voice doesn't call it a key problem): the reason and the status.
  const { v, got } = run({}, () => ({ ok: false, status: 400, text: async () => '{"detail":{"message":"No matching voice found","status":"invalid_request"}}' }));
  v.say('Hi.'); v.say('Again.'); await tick();
  assert.equal(got.errors.length, 1, 'one failure is reported once');
  assert.match(got.errors[0].message, /No matching voice found/);
  assert.equal(got.errors[0].status, 400); assert.equal(got.errors[0].heard, false); assert.equal(got.ended, 0);
}
{ // Too many requests.
  const { v, got } = run({}, () => ({ ok: false, status: 429, text: async () => '{}' }));
  v.say('Hi.'); await tick();
  assert.match(got.errors[0].message, /rate limiting/); assert.equal(got.errors[0].status, 429);
}
{ // The connection dropping mid-stream, after some audio: heard says so.
  const { v, got, calls } = run();
  v.say('Hi.'); await tick();
  calls[0].body.push([1, 2]); await tick();
  calls[0].body.fail(new Error('socket closed')); await tick();
  assert.equal(got.errors[0].message, 'socket closed'); assert.equal(got.errors[0].heard, true);
}
{ // A reply that ends without any audio is a failure, not a silent success.
  const { v, got, calls } = run();
  v.say('Hi.'); v.end(); await tick();
  calls[0].body.close(); await tick();
  assert.match(got.errors[0].message, /no audio/); assert.equal(got.ended, 0);
}
{ // Nothing arriving: gives up after the timeout.
  const { v, got } = run({ audioTimeout: 20 });
  v.say('Hi.'); await tick(60);
  assert.match(got.errors[0].message, /stopped sending audio/); assert.equal(got.errors[0].heard, false);
}
{ // The network failing.
  const { v, got } = run({}, () => { throw new Error('offline'); });
  v.say('Hi.'); await tick();
  assert.equal(got.errors[0].message, 'offline');
}

// The key check: a bad key is a 401 from ElevenLabs, anything else that fails is the network. Never throws.
const fake = (status) => async (url, init) => { fake.last = { url, init }; return { status, ok: status >= 200 && status < 300 }; };
assert.deepEqual(await elevenAccount('k', { fetchImpl: fake(200) }), { ok: true, credit: null });
assert.equal(fake.last.url, `${ELEVEN_API}/user/subscription`);
assert.equal(fake.last.init.headers['xi-api-key'], 'k');
for (const s of [401, 403]) assert.deepEqual(await elevenAccount('k', { fetchImpl: fake(s) }), { ok: false, reason: 'key' });
assert.deepEqual(await elevenAccount('k', { fetchImpl: fake(503) }), { ok: false, reason: 'network' });
assert.deepEqual(await elevenAccount('k', { fetchImpl: async () => { throw new Error('offline'); } }), { ok: false, reason: 'network' });

console.log('elevenlabs tests passed');
