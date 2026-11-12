import assert from 'node:assert/strict';
import { createSpeaker, BEATS, bundledBeats, PROVIDERS, trimSilence } from '../speaker.mjs';
import { FISH_MODELS } from '../fish.mjs';
import { readFileSync } from 'node:fs';

// A FishVoice stand-in the test drives by hand.
const made = [];
class FakeVoice {
  constructor(o) { Object.assign(this, o); this.said = []; this.ended = false; this.aborted = false; made.push(this); }
  open() { return this; }
  say(s) { this.said.push(s); }
  end() { this.ended = true; }
  abort() { this.aborted = true; }
}
const setup = (acct = { ok: true, credit: 4.5 }, beatPhrases = [], bundled = () => null) => {
  made.length = 0;
  const out = [], problems = [];
  const sp = createSpeaker({ emit: (m) => out.push(m), onProblem: (p) => problems.push(p), FishVoiceImpl: FakeVoice, account: async () => acct, beatPhrases, bundled });
  return { sp, out, problems };
};
const tick = () => new Promise((r) => setTimeout(r, 0));

{ // No key: no voice.
  const { sp } = setup();
  assert.equal(sp.start(), null);
}
{ // Credit → Drama 3; audio goes out as base64 with the reply's id; end marks the end.
  const { sp, out } = setup();
  sp.setKey('k'); await tick();
  assert.equal(sp.model, 'drama-3');
  const r = sp.start();
  assert.deepEqual(out.at(-1), { kind: 'speech', stop: true }, 'a new reply stops whatever was playing');
  r.say('Hi.'); r.end();
  const v = made[0];
  assert.equal(v.model, 'drama-3'); assert.deepEqual(v.said, ['Hi.']); assert.ok(v.ended);
  v.onAudio(new Uint8Array([1, 0, 2, 0]));
  assert.deepEqual(out.at(-1), { kind: 'speech', id: r.id, rate: 44100, pcm: Buffer.from([1, 0, 2, 0]).toString('base64') });
  v.onEnd();
  assert.deepEqual(out.at(-1), { kind: 'speech', id: r.id, end: true, chars: 3 }, 'a whole reply says how much it said');
}
{ // No credit → the free model.
  const { sp } = setup({ ok: true, credit: 0 });
  sp.setKey('k'); await tick();
  assert.equal(sp.model, 's2.1-pro-free');
}
{ // Fails before any audio → retried once on the free model with everything said so far, and ended again.
  const { sp, out, problems } = setup({ ok: true, credit: 0 });
  sp.setKey('k');
  const r = sp.start(); // started before the account check finished: still on production
  r.say('One.'); r.say('Two.'); r.end();
  await made[0].onError(Object.assign(new Error('Could not reach Fish Audio'), { heard: false }));
  assert.equal(made.length, 2); assert.equal(made[1].model, 's2.1-pro-free');
  assert.deepEqual(made[1].said, ['One.', 'Two.']); assert.ok(made[1].ended);
  made[1].onAudio(new Uint8Array([0, 0])); made[1].onEnd();
  assert.deepEqual(out.at(-1), { kind: 'speech', id: r.id, end: true, chars: 9 }); assert.deepEqual(problems, []);
}
{ // A bad key: no retry, one problem report, the reply ends (text stays).
  const { sp, out, problems } = setup({ ok: false, reason: 'key' });
  sp.setKey('bad');
  const r = sp.start(); r.say('Hi.');
  await made[0].onError(Object.assign(new Error('Could not reach Fish Audio'), { heard: false }));
  assert.equal(made.length, 1); assert.deepEqual(problems, ['key']);
  assert.deepEqual(out.at(-1), { kind: 'speech', id: r.id, end: true });
}
{ // Fails after audio started: no retry (it would repeat itself), no problem shown, just ends.
  const { sp, problems, out } = setup();
  sp.setKey('k');
  const r = sp.start(); r.say('Hi.');
  made[0].onAudio(new Uint8Array([0, 0]));
  await made[0].onError(Object.assign(new Error('dropped'), { heard: true }));
  assert.equal(made.length, 1); assert.deepEqual(problems, []);
  assert.deepEqual(out.at(-1), { kind: 'speech', id: r.id, end: true });
}
{ // A new reply aborts the old one; the old one's late audio and end are ignored.
  const { sp, out } = setup();
  sp.setKey('k');
  const a = sp.start(); a.say('Old.');
  const b = sp.start();
  assert.ok(made[0].aborted);
  const n = out.length;
  made[0].onAudio(new Uint8Array([0, 0])); made[0].onEnd();
  assert.equal(out.length, n, 'nothing from the stopped reply');
  b.say('New.'); assert.deepEqual(made[1].said, ['New.']);
}
{ // stop() (Stop, barge-in): aborts and tells the overlay to go quiet.
  const { sp, out } = setup();
  sp.setKey('k');
  sp.start().say('Hi.');
  sp.stop();
  assert.ok(made[0].aborted); assert.deepEqual(out.at(-1), { kind: 'speech', stop: true });
}
{ // Beats are made once in the voice; a slow tool with nothing said plays one instantly, only once per reply.
  const { sp, out } = setup(undefined, BEATS);
  sp.setKey('k'); await tick();
  for (let i = 0; i < BEATS.length; i++) { const w = made.at(-1); assert.deepEqual(w.said, [BEATS[i]]); w.onAudio(new Uint8Array([i, 0])); w.onEnd(); await tick(); await tick(); }
  assert.equal(sp.ready, BEATS.length);
  const r = sp.start(), n = made.length;
  assert.equal(r.beat(), true);
  const played = out.at(-1);
  assert.deepEqual({ ...played, pcm: undefined }, { kind: 'speech', id: r.id, rate: 44100, pcm: undefined });
  assert.ok(BEATS.some((_, i) => played.pcm === Buffer.from([i, 0]).toString('base64')), 'one of the made beats');
  assert.equal(made.length, n, 'no extra socket for the beat');
  assert.deepEqual(made.at(-1).said, [], 'the beat came from the cache, not the live socket');
  assert.equal(r.beat(), false, 'once per reply');
  const r2 = sp.start(); r2.say('Already talking.');
  assert.equal(r2.beat(), false, 'not when it already said something');
}
{ // No beats made yet (or making them failed): the beat is spoken live instead.
  const { sp } = setup(undefined, BEATS);
  sp.setKey('k');
  const r = sp.start(); const live = made.at(-1);
  assert.equal(r.beat(), true);
  assert.ok(BEATS.includes(live.said[0]));
}
{ // Drama 3 fails before any audio with credit left → S2.1 Pro, and the one that worked is kept for the next reply.
  const { sp, problems } = setup();
  sp.setKey('k'); await tick();
  const r = sp.start(); r.say('Hi.'); r.end();
  const v = made.slice(made.length - 1); // this reply's sockets (an earlier test's beat warm-up can add to made)
  await v[0].onError(Object.assign(new Error('Fish Audio closed the connection'), { heard: false }));
  v.push(made.at(-1));
  assert.equal(v[0].model, 'drama-3'); assert.equal(v[1].model, 's2.1-pro'); assert.deepEqual(v[1].said, ['Hi.']);
  v[1].onAudio(new Uint8Array([0, 0])); v[1].onEnd();
  assert.equal(sp.model, 's2.1-pro'); assert.deepEqual(problems, []);
  sp.start(); assert.equal(made.at(-1).model, 's2.1-pro');
}
{ // Every model fails before audio → tried once on each, then one problem report.
  const { sp, problems } = setup();
  sp.setKey('k'); await tick();
  sp.start().say('Hi.');
  const v = [made.at(-1)];
  for (let i = 0; i < 3; i++) { await v[i].onError(Object.assign(new Error('Could not reach Fish Audio'), { heard: false })); if (i < 2) v.push(made.at(-1)); }
  assert.deepEqual(v.map((x) => x.model), ['drama-3', 's2.1-pro', 's2.1-pro-free']);
  assert.equal(made.at(-1), v[2], 'no fourth try');
  assert.deepEqual(problems, ['Could not reach Fish Audio']);
}
{ // Picking S2.1 Pro: replies use it, and a failure falls back to the free tier, never up to the pricier Drama 3.
  const { sp, problems } = setup();
  sp.setModel('s2.1-pro');
  sp.setKey('k'); await tick();
  assert.equal(sp.pick, 's2.1-pro');
  sp.start().say('Hi.');
  const v = [made.at(-1)];
  assert.equal(v[0].model, 's2.1-pro');
  for (let i = 0; i < 2; i++) { await v[i].onError(Object.assign(new Error('Could not reach Fish Audio'), { heard: false })); if (i < 1) v.push(made.at(-1)); }
  assert.deepEqual(v.map((x) => x.model), ['s2.1-pro', 's2.1-pro-free']);
  assert.equal(made.at(-1), v[1], 'no third try, and never Drama 3');
  assert.deepEqual(problems, ['Could not reach Fish Audio']);
}
{ // Switching the pick: the next reply uses it; no credit keeps it on the free tier; only real choices count.
  const { sp } = setup({ ok: true, credit: 0 });
  sp.setKey('k'); await tick();
  sp.setModel('s2.1-pro');
  assert.equal(sp.pick, 's2.1-pro');
  assert.equal(sp.model, 's2.1-pro-free', 'no credit stays free');
  sp.setModel('s2.1-pro-free'); sp.setModel('nope');
  assert.equal(sp.pick, 's2.1-pro', 'the free tier and unknown names are not picks');
  const { sp: sp2 } = setup();
  sp2.setKey('k'); await tick();
  sp2.setModel('s2.1-pro');
  sp2.start(); assert.equal(made.at(-1).model, 's2.1-pro');
  sp2.setModel('drama-3');
  sp2.start(); assert.equal(made.at(-1).model, 'drama-3');
}
{ // Gemini: its own voice class, 24 kHz audio, the cheaper model unless the other is picked, beats not made straight away.
  made.length = 0;
  const out = [], problems = [];
  let acct = { ok: true, credit: null };
  const sp = createSpeaker({ emit: (m) => out.push(m), onProblem: (p) => problems.push(p), FishVoiceImpl: FakeVoice, account: async () => ({ ok: true, credit: 4.5 }),
    providers: { gemini: { ...PROVIDERS.gemini, Voice: FakeVoice, account: async () => acct } }, beatPhrases: ['One sec.'], bundled: () => null });
  assert.equal(sp.provider, 'fish');
  sp.setKey('fish-key'); await tick(); await tick();
  made.length = 0; // the Fish beat made on its key
  sp.setProvider('gemini');
  assert.equal(sp.provider, 'gemini'); assert.equal(sp.on, false, "the other service's key isn't carried over");
  assert.equal(sp.start(), null);
  sp.setKey('g-key'); sp.setVoice('Puck'); await tick(); await tick();
  assert.equal(made.length, 0, 'beats wait a while, in case the voice is still being picked');
  assert.equal(sp.model, 'gemini-3.8-flash-lite-tts'); assert.equal(sp.pick, 'gemini-3.8-flash-lite-tts');
  const r = sp.start();
  assert.equal(r.beat(), true);
  const v = made[0];
  assert.deepEqual(v.said, ['One sec.'], 'the beat is said live');
  assert.equal(v.key, 'g-key'); assert.equal(v.voice, 'Puck'); assert.equal(v.model, 'gemini-3.8-flash-lite-tts');
  v.onAudio(new Uint8Array([1, 0]));
  assert.equal(out.at(-1).rate, 25440, 'played a semitone up');
  // A failure that isn't the key: said as it is, and not tried again (there's no cheaper model than this one).
  const r2 = sp.start(); r2.say('Hi.');
  made.at(-1).onError(Object.assign(new Error('Gemini: No matching speaker voice'), { heard: false, status: 400 })); await tick(); await tick();
  assert.deepEqual(problems, ['Gemini: No matching speaker voice']);
  assert.equal(made.length, 2);
  assert.deepEqual(out.at(-1), { kind: 'speech', id: r2.id, end: true });
  // The key stopped working: said as a key problem, though there was no model left to retry on.
  acct = { ok: false, reason: 'key' };
  const r3 = sp.start(); r3.say('Hi.');
  made.at(-1).onError(Object.assign(new Error('Gemini: API key not valid'), { heard: false, status: 400 })); await tick(); await tick();
  assert.deepEqual(problems.at(-1), 'key');
  // Flash picked: a reply that fails before any audio is tried again on Flash Lite, with what was said so far.
  acct = { ok: true, credit: null };
  sp.setModel('gemini-3.8-flash-tts'); sp.setModel('not-a-model');
  assert.equal(sp.pick, 'gemini-3.8-flash-tts');
  const r5 = sp.start(); r5.say('Hi.');
  assert.equal(made.at(-1).model, 'gemini-3.8-flash-tts');
  made.at(-1).onError(Object.assign(new Error('Gemini: overloaded'), { heard: false, status: 503 })); await tick(); await tick();
  assert.equal(made.at(-1).model, 'gemini-3.8-flash-lite-tts'); assert.deepEqual(made.at(-1).said, ['Hi.']);
  // Back to Fish: its own voice class and rate again.
  sp.setProvider('fish'); sp.setKey('fish-key'); await tick(); await tick();
  const r4 = sp.start(); r4.say('Hi.');
  assert.equal(made.at(-1).model, 'drama-3');
  made.at(-1).onAudio(new Uint8Array([1, 0]));
  assert.equal(out.at(-1).rate, 44100);
}
{ // A Fish account check still out when the service changes says nothing about Gemini's model.
  let answer;
  const sp = createSpeaker({ emit: () => {}, FishVoiceImpl: FakeVoice, account: () => new Promise((r) => { answer = r; }),
    providers: { gemini: { ...PROVIDERS.gemini, Voice: FakeVoice, account: async () => ({ ok: true, credit: null }) } }, beatPhrases: [], bundled: () => null });
  sp.setKey('fish-key');
  sp.setProvider('gemini'); sp.setKey('g-key'); await tick();
  answer({ ok: true, credit: 0 }); await tick(); await tick();
  assert.equal(sp.model, PROVIDERS.gemini.pick, 'not the Fish free tier');
  assert.deepEqual(await sp.check(), { ok: true, credit: null }, 'and the next check asks Gemini');
}
// Silence at both ends of a beat is cut (a little is kept), so it starts the moment it plays.
{
  const pcm = Buffer.from(new Int16Array([...Array(2000).fill(0), 9000, -9000, 9000, ...Array(3000).fill(3)]).buffer);
  const cut = trimSilence(pcm, 1000); // 40 samples kept each side
  assert.equal(cut.length / 2, 40 + 3 + 40);
  assert.equal(cut.readInt16LE(40 * 2), 9000);
  assert.equal(trimSilence(Buffer.from([1, 0, 2, 0]), 24000).length, 4, 'nothing loud: left alone');
  assert.equal(trimSilence(Buffer.from([1, 0, 2]), 24000).length, 2, 'a stray byte is dropped');
}
{ // Beats made here are kept (beatStore) and read back next time, so they're only ever made once per voice and model.
  const kept = new Map(), writes = [];
  const beatStore = { read: (name) => kept.get(name) ?? null, write: (name, data) => { writes.push(name); kept.set(name, data); } };
  const gem = { gemini: { ...PROVIDERS.gemini, Voice: FakeVoice, warmDelay: 0, account: async () => ({ ok: true, credit: null }) } };
  const mk = (out = []) => ({ out, sp: createSpeaker({ emit: (m) => out.push(m), FishVoiceImpl: FakeVoice, account: async () => ({ ok: true, credit: 1 }), providers: gem, beatPhrases: ['One sec.', 'On it.'], bundled: () => null, beatStore }) });
  const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
  made.length = 0;
  const { sp } = mk();
  sp.setProvider('gemini'); sp.setVoice('Puck'); sp.setKey('g-key'); await settle();
  assert.equal(made.length, 1, 'one at a time');
  assert.deepEqual(made[0].said, ['One sec.']); assert.equal(made[0].voice, 'Puck'); assert.equal(made[0].model, 'gemini-3.8-flash-lite-tts');
  made[0].onAudio(new Uint8Array([1, 0])); made[0].onAudio(new Uint8Array([2, 0])); made[0].onEnd(); await settle();
  made[1].onAudio(new Uint8Array([3, 0])); made[1].onEnd(); await settle();
  assert.equal(sp.ready, 2);
  assert.deepEqual(writes, ['gemini.Puck.gemini-3.8-flash-lite-tts']);
  assert.deepEqual(kept.get(writes[0]), { rate: 24000, beats: { 'One sec.': Buffer.from([1, 0, 2, 0]).toString('base64'), 'On it.': Buffer.from([3, 0]).toString('base64') } });
  // The next run: read back, nothing asked of Gemini, and played at once at its rate.
  made.length = 0;
  const { sp: sp2, out } = mk();
  sp2.setProvider('gemini'); sp2.setVoice('Puck'); sp2.setKey('g-key'); await settle();
  assert.equal(made.length, 0); assert.equal(sp2.ready, 2); assert.equal(writes.length, 1, 'nothing new to keep');
  const r = sp2.start(); assert.equal(r.beat(), true);
  assert.equal(out.at(-1).rate, 25440); assert.ok([...Object.values(kept.get(writes[0]).beats)].includes(out.at(-1).pcm));
  assert.deepEqual(made.at(-1).said, [], 'not said live');
  // Another voice: its own beats, made once the first lot is out of the way.
  made.length = 0;
  sp2.setVoice('Kore'); await settle();
  assert.equal(made.at(-1).voice, 'Kore'); assert.deepEqual(made.at(-1).said, ['One sec.']);
  // It gives up after three failures in a row (no allowance left), rather than asking for all of them.
  made.length = 0;
  const many = createSpeaker({ emit: () => {}, FishVoiceImpl: FakeVoice, account: async () => ({ ok: true, credit: 1 }), providers: gem, beatPhrases: ['a', 'b', 'c', 'd', 'e'], bundled: () => null, beatStore });
  many.setProvider('gemini'); many.setKey('g-key'); await settle();
  for (let i = 0; i < 3; i++) { made.at(-1).onError(new Error('Gemini is rate limiting')); await settle(); }
  assert.equal(made.length, 3, 'stopped after three'); assert.equal(many.ready, 0);
}
console.log('speaker tests: passed');
{ // Voice cues aren't counted as spoken text.
  const { sp, out } = setup();
  sp.setKey('k');
  const r = sp.start(); r.say('[warm] Hello there.'); r.end();
  made.at(-1).onAudio(new Uint8Array([0, 0])); made.at(-1).onEnd();
  assert.deepEqual(out.at(-1), { kind: 'speech', id: r.id, end: true, chars: 12 });
  console.log('speech pacing tests: passed');
}

{ // At least 30 short beats, one or two words each, picked at random with no repeat among the last few.
  assert.ok(BEATS.length >= 30, 'plenty of beats');
  assert.equal(new Set(BEATS).size, BEATS.length, 'no duplicates');
  for (const b of BEATS) assert.ok(b.replace(/[.,!]/g, '').trim().split(/\s+/).length <= 2, `${b} is one or two words`);
  const { sp, out } = setup(undefined, BEATS);
  sp.setKey('k'); await tick();
  for (let i = 0; i < BEATS.length; i++) { const w = made.at(-1); w.onAudio(new Uint8Array([i, 1])); w.onEnd(); await tick(); await tick(); }
  const seen = [];
  for (let i = 0; i < 40; i++) { const r = sp.start(); r.beat(); seen.push(out.at(-1).pcm); r.abort(); }
  for (let i = 0; i < seen.length; i++) assert.ok(!seen.slice(Math.max(0, i - 8), i).includes(seen[i]), 'no repeat within 8');
  assert.ok(new Set(seen).size > 12, 'they vary');
}
console.log('speaker beat variety: passed');

{ // Beats shipped with the app play at their own rate, and none are made over Fish for them.
  const clip = { rate: 24000, pcm: Buffer.from([7, 7]).toString('base64') };
  const { sp, out } = setup(undefined, BEATS, () => new Map(BEATS.map((b) => [b, clip])));
  sp.setKey('k'); await tick(); await tick();
  assert.equal(made.filter((v) => v.said.length).length, 0, 'no beat is recorded at run time');
  const r = sp.start();
  assert.equal(r.beat(), true);
  assert.deepEqual(out.at(-1), { kind: 'speech', id: r.id, rate: 24000, pcm: clip.pcm });
}
{ // Every look's voice has every beat recorded, in both paid models (re-run beats/make.mjs after changing BEATS).
  const side = readFileSync(new URL('../sidekick.mjs', import.meta.url), 'utf8');
  const { DEFAULT_VOICE } = await import('../fish.mjs');
  const voices = [DEFAULT_VOICE, ...[...side.matchAll(/\['\w+', '[^']+', '([0-9a-f]{32})'\]/g)].map((m) => m[1])];
  const get = bundledBeats();
  for (const v of voices) for (const m of FISH_MODELS) {
    const set = get(v, m);
    assert.ok(set, `beats for ${v} on ${m}`);
    for (const b of BEATS) assert.ok(set.get(b)?.pcm.length > 1000, `"${b}" in ${v} on ${m}`);
  }
}
console.log('bundled beats: passed');

{ // VoiceStudio (local) as the provider: no Fish key needed, its PCM goes out at its own rate, cues aren't counted.
  made.length = 0;
  const local = [], out = [], problems = [];
  class FakeLocal { constructor(o) { Object.assign(this, o); this.said = []; this.ended = false; this.aborted = false; local.push(this); } open() { this.opened = true; return this; } say(s) { this.said.push(s); } end() { this.ended = true; } abort() { this.aborted = true; } }
  const sp = createSpeaker({ emit: (m) => out.push(m), onProblem: (p) => problems.push(p), FishVoiceImpl: FakeVoice, account: async () => ({ ok: true, credit: 5 }), beatPhrases: [], bundled: () => null,
    LocalVoiceImpl: FakeLocal, localStatus: async () => ({ ok: true, engine: 'omnivoice', voices: [{ id: 'en-Alice_woman', name: 'Alice' }] }) });
  assert.equal(sp.provider, 'fish'); assert.equal(sp.on, false, 'Fish without a key is off');
  sp.setProvider('voicestudio'); await tick();
  assert.equal(sp.provider, 'voicestudio'); assert.equal(sp.on, true, 'VoiceStudio needs no key');
  assert.equal(sp.local.ok, true);
  sp.setLocalVoice('en-Alice_woman');
  const r = sp.start();
  assert.equal(local.at(-1).voice, 'en-Alice_woman'); assert.ok(local.at(-1).opened, 'its socket opens as the reply starts');
  assert.equal(r.beat(), false, 'no beats made in VoiceStudio');
  r.say('[warm] Hello there.'); r.end();
  assert.deepEqual(local.at(-1).said, ['[warm] Hello there.']); assert.ok(local.at(-1).ended);
  local.at(-1).onAudio(new Uint8Array([4, 0]), 24000);
  assert.deepEqual(out.at(-1), { kind: 'speech', id: r.id, rate: 24000, pcm: Buffer.from([4, 0]).toString('base64') });
  local.at(-1).onEnd();
  assert.deepEqual(out.at(-1), { kind: 'speech', id: r.id, end: true, chars: 12 });
  assert.equal(made.length, 0, 'Fish was never used');

  // Unavailable before any audio: reported with its reason and message, the reply ends as text, and Fish is NOT tried,
  // even when a Fish key is handed over meanwhile (it's ignored while VoiceStudio is the pick).
  sp.setKey('fish-key'); await tick();
  assert.equal(sp.provider, 'voicestudio');
  const n = made.length;
  const r2 = sp.start(); r2.say('Hi.'); r2.end();
  local.at(-1).onError(Object.assign(new Error("Run VoiceStudio first."), { reason: 'offline', heard: false }));
  assert.deepEqual(problems, [{ provider: 'voicestudio', reason: 'offline', message: "Run VoiceStudio first." }]);
  assert.deepEqual(out.at(-1), { kind: 'speech', id: r2.id, end: true });
  assert.equal(made.length, n, 'no Fish socket opened as a fallback');
  assert.equal(sp.local.reason, 'offline', 'the panel shows the latest reason');

  // Failing after audio started: no problem report (it was heard), just ends.
  const r3 = sp.start(); r3.say('Hi.');
  local.at(-1).onAudio(new Uint8Array([0, 0]), 24000);
  local.at(-1).onError(Object.assign(new Error('dropped'), { reason: 'error', heard: true }));
  assert.equal(problems.length, 1);

  // Stop (and barge-in) aborts the local voice and quiets the overlay; a new reply aborts the old one.
  const r4 = sp.start(); r4.say('Long one.');
  sp.stop();
  assert.ok(local.at(-1).aborted); assert.deepEqual(out.at(-1), { kind: 'speech', stop: true });
  const a = sp.start(); a.say('Old.'); const old = local.at(-1);
  sp.start(); assert.ok(old.aborted);
  const before = out.length; old.onAudio(new Uint8Array([1, 0]), 24000); old.onEnd();
  assert.equal(out.length, before, 'nothing from the stopped reply');

  // Switching providers stops what's playing; back on Fish, replies use Fish again with the same model pick.
  const r5 = sp.start(); r5.say('Local.'); const playing = local.at(-1);
  sp.setProvider('fish');
  assert.ok(playing.aborted, 'switching stops the old provider'); assert.deepEqual(out.at(-1), { kind: 'speech', stop: true });
  assert.equal(sp.on, false, 'back on Fish, it waits for its key'); sp.setKey('fish-key'); await tick();
  const f = sp.start(); f.say('Fish again.');
  assert.equal(made.at(-1).model, 'drama-3'); assert.deepEqual(made.at(-1).said, ['Fish again.']);
  sp.setProvider('nope'); assert.equal(sp.provider, 'fish', 'unknown providers are ignored');
  console.log('speaker provider tests: passed');
}
