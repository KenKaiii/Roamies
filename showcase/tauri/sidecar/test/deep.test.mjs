// Deep explain mode: a deep drawing is marked for the overlay (big cards, one at a time) and keeps one card up.
import assert from 'node:assert/strict';
import { createTools } from '../tools.mjs';
import { DrawArgs, readSecs } from '../draw.mjs';
import { readFileSync } from 'node:fs';

assert.equal(DrawArgs.safeParse({ beats: [{ say: 'Hi', marks: [] }], deep: true }).success, true, 'deep is an option');
const events = [];
const noop = async () => {};
const made = createTools({ allowActions: () => false, ui: (m) => { if (m.kind === 'agent' && m.e?.type === 'draw') { events.push(m.e); setTimeout(() => made.ink.started(m.e.id, m.e.seg), 5); } }, ask: async () => false, openUrl: noop, onCommitments: noop, showList: noop, fmtWhen: String, commitmentsText: () => '', userName: 'Test' });
const draw = made.tools.find((t) => t.name === 'draw');
assert.match(draw.description, /deep: true/, 'the model is told when to use it');
const card = (title, items) => ({ kind: 'list', title, items });
const beats = [
  { say: 'The big picture.', marks: [card('overview', ['DNA to mRNA'])] },
  { say: 'First, initiation.', marks: [card('initiation', ['RNA polymerase binds the promoter'])] },
  { say: 'Then elongation.', marks: [card('elongation', ['mRNA is built 5 to 3'])] },
];
const result = await draw.execute({ beats, deep: true }, { toolCallId: 'deep1' });
assert.ok(events.length >= 1 && events.every((e) => e.deep === true), 'every segment says deep');
// Regression (#143): each deep card closed about 2 s after it opened, before its words could be read. Every card but the
// last now says how long it takes to read; the overlay keeps it up that long.
const sent = events.flatMap((e) => e.beats);
assert.deepEqual(sent.map((b) => b.read), [3, 3, undefined], 'read time on all but the last card');
assert.equal(readSecs([{ kind: 'card', heading: 'Core collapse', items: Array(10).fill('iron core cannot fuse further so gravity wins and it implodes') }]), 30, 'a dense card gets the most');
assert.equal(readSecs([{ kind: 'card', text: Array(66).fill('word').join(' ') }]), 20, 'about 200 words a minute');
assert.equal(readSecs([{ kind: 'ring', at: { text: 'Save button here' } }]), 0, 'screen marks are not read');
assert.equal(readSecs([{ kind: 'photo', query: 'black hole accretion disk image', caption: 'A disk' }]), 3, 'names and searches are not read');
const ink = readFileSync(new URL('../../../roamies/ink.js', import.meta.url), 'utf8');
assert.match(ink, /if \(b\.read && !voiced\) \{\r?\n\s+await until_\(t0 \+ Math\.max\(dur, b\.read\), gen\);/, 'the overlay holds a written deep card for its read time');
assert.match(ink, /now\(\) - held < 60 && G\.ptr && mine\(\)\.some/, 'and while the pointer rests on it, up to a minute');
// The voice: drawings follow the audio actually played, and wait up to 8 s for a slow voice to start.
assert.match(ink, /if \(\(V\.played\(\) - clock\.P\) \* cps\(\) >= chars\) return;/);
assert.match(ink, /while \(now\(\) - t0 < 8\)/);
const vo = readFileSync(new URL('../../../roamies/voice-out.js', import.meta.url), 'utf8');
assert.match(vo, /played\(\) \{/); assert.match(vo, /speaking\(\) \{ return id != null/);
assert.match(String(result), /p3/, 'all three cards drawn');
assert.match(String(result), /one card at a time/, 'the model is told only the last is up');
assert.equal(made.ink.describe().split(',').filter((s) => /list/.test(s)).length, 1, 'one card kept up at a time');
events.length = 0;
await draw.execute({ beats: beats.slice(0, 2) }, { toolCallId: 'plain1' });
assert.ok(events.every((e) => !('deep' in e)), 'ordinary drawings are unchanged');
// Regression (#143): a reply bubble closed after at most 4.5 s however long it was; it now stays for its reading time.
const bubble = readFileSync(new URL('../../../roamies/agent.js', import.meta.url), 'utf8');
assert.match(bubble, /const linger = clamp\(1\.1 \+ bb\.text\.split\(\/\\s\+\/\)\.filter\(Boolean\)\.length \/ 3\.3, 1\.3, 30\);/, 'bubbles stay for their reading time');
console.log('deep explain tests: passed');
process.exit(0);
