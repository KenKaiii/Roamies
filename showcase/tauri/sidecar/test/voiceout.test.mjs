// Spoken replies' playback (showcase/clanky/voice-out.js): on Linux, chunks that come just late grow the cushion
// (#80); elsewhere scheduling is unchanged. Run: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const noop = () => {};
const src = fs.readFileSync(new URL('../../../clanky/voice-out.js', import.meta.url), 'utf8');
const chunk = Buffer.alloc(4410 * 2).toString('base64'); // 0.1 s at 44.1 kHz
// A player with its own clock; starts: when each chunk was scheduled to play.
function player(linux) {
  const clock = { t: 0 }, starts = [];
  class AudioContext {
    constructor() { this.state = 'running'; this.destination = {}; }
    get currentTime() { return clock.t; }
    resume() {}
    createGain() { return { gain: { value: 1, cancelScheduledValues: noop, setValueAtTime: noop, linearRampToValueAtTime: noop }, connect: noop }; }
    createAnalyser() { return { connect: noop, getFloatTimeDomainData: noop }; }
    createBuffer(_c, n, rate) { return { duration: n / rate, getChannelData: () => new Float32Array(n) }; }
    createBufferSource() { return { connect: noop, stop: noop, start(at) { starts.push({ at, d: this.buffer.duration }); } }; }
  }
  const window = { Clanky: {}, ...(linux ? { CLANKY_LINUX: 'x11' } : {}) };
  vm.runInNewContext(src, { window, AudioContext, Float32Array, Math, Set, atob: (s) => Buffer.from(s, 'base64').toString('latin1') });
  const out = window.Clanky.voiceOut;
  const at = (t, id) => { clock.t = t; out.handle({ id, rate: 44100, pcm: chunk }); return starts.at(-1).at - t; };
  // Silence between chunks, from the nth one on.
  const gaps = (from) => { let g = 0; for (let i = from + 1; i < starts.length; i++) g += Math.max(0, starts[i].at - (starts[i - 1].at + starts[i - 1].d)); return g; };
  return { out, at, gaps, starts };
}
const bursty = (p, id, t0) => { for (let i = 0; i < 40; i++) p.at(t0 + i * 0.1 + (i % 2 ? 0.25 : 0), id); };

{ // On time, back to back: no gaps, and the cushion stays small.
  const p = player(true);
  for (let i = 0; i < 10; i++) p.at(i * 0.1, 'a');
  assert.ok(p.gaps(0) < 1e-9); assert.equal(p.out.lead(), 0.12);
}
{ // Linux, in bursts (real time on average, every other chunk 0.25 s late): the cushion grows, so most of it joins up.
  const p = player(true);
  bursty(p, 'b', 0);
  assert.ok(p.gaps(0) < 0.8, `bursty stream: ${p.gaps(0).toFixed(2)} s of gaps in 4 s`); // a fixed 0.12 s cushion leaves ~7 s
  assert.ok(p.out.lead() > 0.12 && p.out.lead() <= 1);
  // A new reply's first chunk still starts on the usual cushion; a long pause (a tool running) doesn't grow it.
  const grown = p.out.lead();
  assert.ok(Math.abs(p.at(20, 'c') - 0.12) < 1e-9, 'first chunk on the usual cushion');
  assert.ok(Math.abs(p.at(23, 'c') - 0.12) < 1e-9, 'after a long pause too');
  assert.equal(p.out.lead(), grown);
  // Replies with nothing late ease it back down.
  for (const [i, id] of ['d', 'e', 'f'].entries()) p.at(30 + i * 5, id);
  assert.ok(p.out.lead() < grown);
}
{ // Elsewhere: the same bursts are scheduled exactly as before (a fixed 0.12 s cushion).
  const p = player(false);
  let end = 0;
  for (let i = 0; i < 40; i++) {
    const t = i * 0.1 + (i % 2 ? 0.25 : 0), want = Math.max(end, t + 0.12);
    assert.ok(Math.abs(p.at(t, 'b') + t - want) < 1e-9, `chunk ${i} as before`);
    end = want + 0.1;
  }
  assert.equal(p.out.lead(), 0.12);
}
console.log('voiceout tests: passed');
