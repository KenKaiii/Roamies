// Call listening: chunk files go to the local transcriber (mocked here), the words are saved with a time, the audio is deleted unless kept,
// a summary is made once when the call ends and only when the text makes sense. Run: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCallListener } from '../calllisten.mjs';
import { createCallMemory } from '../callmemory.mjs';
import { makesSense, summarizeCall } from '../callsummary.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'roamies-call-'));
const audio = path.join(root, 'audio');
fs.mkdirSync(audio, { recursive: true });
const chunk = (at) => { const p = path.join(audio, `call-${at}.wav`); fs.writeFileSync(p, Buffer.alloc(2000, 1)); return { path: p, at, secs: 30 }; };

const TALK = [
  'We should move the launch to Friday because the design review is not finished yet.',
  'The launch checklist still needs the pricing page and the pricing page depends on the design review.',
  'Maya will finish the design review tomorrow and then the launch can go ahead on Friday.',
];

function setup({ ready = true, keep = false, answer = () => ({ text: TALK[0], lang: 'en' }) } = {}) {
  const memory = createCallMemory(path.join(root, `m${Math.random().toString(36).slice(2)}`));
  const calls = [], said = [];
  const transcribe = async (file) => { calls.push(file); const r = answer(calls.length); if (r instanceof Error) throw r; return r; };
  const listener = createCallListener({ dir: audio, memory, transcribe, ready: () => ready, keepAudio: () => keep, say: (t) => said.push(t) });
  return { memory, calls, said, listener };
}

// Each chunk: read by the local transcriber, saved with its time, the audio file deleted.
{
  let n = 0;
  const { memory, calls, listener } = setup({ answer: () => ({ text: TALK[n++], lang: 'en' }) });
  listener.begin();
  const files = [1790000000000, 1790000030000, 1790000060000].map(chunk);
  for (const c of files) listener.add(c);
  const r = await listener.end();
  assert.equal(calls.length, 3);
  assert.ok(calls.every((c) => /call-\d+\.wav$/.test(c)), 'the chunk files are what is transcribed');
  const rows = memory.transcripts();
  assert.deepEqual(rows.map((e) => e.at), [1790000000000, 1790000030000, 1790000060000], 'one entry per chunk, with its time');
  assert.equal(rows[1].text, TALK[1]);
  assert.ok(files.every((c) => !fs.existsSync(c.path)), 'the audio is deleted after transcribing');
  assert.equal(r.made, true);
  const sums = memory.summaries();
  assert.equal(sums.length, 1, 'one summary per call');
  assert.match(sums[0].subject, /^Call about .*(launch|design|review)/);
  assert.ok(sums[0].points.length >= 1 && sums[0].points.length <= 4);
  // The memory file is plain lines of JSON in the data folder.
  assert.equal(fs.readFileSync(path.join(memory.dir, 'transcripts.jsonl'), 'utf8').trim().split('\n').length, 3);
}

// The setting that keeps audio keeps the files.
{
  const { listener } = setup({ keep: true });
  listener.begin();
  const c = chunk(1790000100000);
  await listener.add(c);
  assert.ok(fs.existsSync(c.path), 'kept when the setting says so');
  await listener.end();
}

// Models not downloaded: nothing is read, it says so once, and the audio isn't left lying around.
{
  const { calls, said, listener } = setup({ ready: false });
  listener.begin();
  const a = chunk(1790000200000), b = chunk(1790000230000);
  await listener.add(a); await listener.add(b);
  assert.equal(calls.length, 0);
  assert.equal(said.length, 1);
  assert.match(said[0], /not downloaded/);
  assert.ok(!fs.existsSync(a.path) && !fs.existsSync(b.path));
  assert.equal((await listener.end()).made, false);
}

// A failing transcriber saves nothing and says so once; the next chunk still works.
{
  let first = true;
  const { memory, said, listener } = setup({ answer: () => { if (first) { first = false; return new Error('boom'); } return { text: TALK[0], lang: 'en' }; } });
  listener.begin();
  await listener.add(chunk(1790000300000)); await listener.add(chunk(1790000330000));
  assert.equal(said.length, 1);
  assert.match(said[0], /could not transcribe/);
  assert.equal(memory.transcripts().length, 1, 'the next chunk is still read');
  await listener.end();
}

// Files that aren't the helper's chunks are never read, sent or deleted. Chunks that arrive after recording stopped are deleted unread.
{
  const { calls, listener } = setup();
  listener.begin();
  const stranger = path.join(root, 'call-1790000500000.wav');
  fs.writeFileSync(stranger, Buffer.alloc(2000, 1));
  const odd = path.join(audio, 'diary.wav');
  fs.writeFileSync(odd, Buffer.alloc(2000, 1));
  await listener.add({ path: stranger, at: 1 }); await listener.add({ path: odd, at: 2 });
  assert.equal(calls.length, 0);
  assert.ok(fs.existsSync(stranger) && fs.existsSync(odd), 'left alone');
  await listener.end();
  const late = chunk(1790000600000);
  await listener.add(late);
  assert.equal(calls.length, 0, 'nothing is read once recording is off');
  assert.ok(!fs.existsSync(late.path));
}

// Summaries only when the text makes sense.
{
  assert.equal(makesSense('hello').ok, false);
  assert.equal(makesSense('uh '.repeat(60)).ok, false, 'one sound over and over');
  assert.equal(makesSense('Thank you for watching. Thank you for watching. Thank you for watching. Thank you for watching. Thank you for watching.').ok, false);
  assert.equal(makesSense('#### ???? 12 34 56 78 90 ---- ==== ++++ 11 22 33 44 55 66 77 88 99 00 11 22 33 44 55 66 77 88 99').ok, false, 'symbols and numbers');
  assert.equal(makesSense(TALK.join(' ')).ok, true);
  const none = summarizeCall([{ text: 'ok yeah right' }]);
  assert.equal(none.summary, null);
  assert.ok(none.reason);
  const { memory, listener } = setup({ answer: () => ({ text: 'yeah okay um yeah okay', lang: 'en' }) });
  listener.begin();
  await listener.add(chunk(1790000700000));
  const r = await listener.end();
  assert.equal(r.made, false, 'nonsense gets no summary');
  assert.equal(memory.summaries().length, 0);
  assert.equal(memory.transcripts().length, 1, 'but what was heard is still kept');
}

// View, search, delete.
{
  const memory = createCallMemory(path.join(root, 'view'));
  memory.addTranscript({ at: 1790001000000, secs: 30, text: 'We talked about the garden and tomatoes.', session: 'c1' });
  memory.addTranscript({ at: 1790001030000, secs: 30, text: 'Then the invoice for the printer.', session: 'c1' });
  memory.addSummary({ session: 'c1', at: 1790001000000, subject: 'Call about garden and printer', points: ['tomatoes'], chunks: 2 });
  assert.equal(memory.search('').length, 3);
  assert.deepEqual(memory.search('TOMATOES').map((r) => r.id).sort(), ['s-1790001000000', 't-1790001000000']);
  assert.equal(memory.search('invoice printer').length, 1, 'every word must match');
  assert.equal(memory.search('zebra').length, 0);
  assert.equal(memory.remove('../x'), false);
  assert.equal(memory.remove('t-1790001030000'), true);
  assert.equal(memory.search('invoice').length, 0);
  assert.equal(memory.remove('t-1790001030000'), false);
  assert.deepEqual(memory.unsummarized(), []);
  memory.clear();
  assert.equal(memory.search('').length, 0);
}

fs.rmSync(root, { recursive: true, force: true });
console.log('call listening tests: passed');
