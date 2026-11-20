// Local transcription for Record: only pinned addresses may be downloaded, a build is chosen by GPU, and each chunk is read by the
// stock model first and by the Darija model only when the stock one hears Arabic. whisper.cpp itself is mocked here.
// Run: npm test
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkSttUrl } from '../safety.mjs';
import { PARTS, createLocalTranscriber, detectBuild, downloadStt, isSttReady, partsFor, removeStt, sizeLabelFor, totalFor } from '../localstt.mjs';

// Addresses: exactly the pinned files, over https, nothing near them.
for (const k of ['bin-cuda', 'bin-cpu', 'stock', 'darija']) assert.equal(checkSttUrl(PARTS[k].base + PARTS[k].files[0].name).level, 'safe', k);
for (const bad of [
  'http://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip',
  'https://github.com/evil/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip',
  'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip?x=1',
  'https://huggingface.co/MedHachim/whisper-medium-darija-ggml/resolve/main/../../evil.bin',
  'https://huggingface.co/someone/else/resolve/main/ggml-medium-darija-q5_0.bin', '', 'nope',
]) assert.equal(checkSttUrl(bad).level, 'block', bad);

assert.deepEqual(partsFor('cuda'), ['bin-cuda', 'stock', 'darija']);
assert.deepEqual(partsFor('cpu'), ['bin-cpu', 'stock', 'darija']);
assert.ok(totalFor('cuda') > totalFor('cpu'));
assert.match(sizeLabelFor('cuda'), /^1\.\d GB$/);

// GPU choice.
assert.equal(await detectBuild((c, a, cb) => cb(null, 'GPU 0: NVIDIA GeForce RTX 3060 Laptop GPU (UUID: GPU-x)')), 'cuda');
assert.equal(await detectBuild((c, a, cb) => cb(new Error('not found'), '')), 'cpu');
assert.equal(await detectBuild(() => { throw new Error('x'); }), 'cpu');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'roamies-stt-'));
const wav = path.join(root, 'chunk.wav'); fs.writeFileSync(wav, Buffer.alloc(100));

// Routing. A fake whisper-cli writes the files the real one would (see -oj / -otxt, -of).
function fake(lang) {
  const runs = [];
  const run = async (bin, args) => {
    runs.push(args);
    const out = args[args.indexOf('-of') + 1], model = path.basename(args[args.indexOf('-m') + 1]);
    if (args.includes('-oj')) fs.writeFileSync(`${out}.json`, JSON.stringify({ result: { language: lang }, transcription: [{ text: ' Bonjour  tout' }, { text: ' le monde.' }] }));
    else fs.writeFileSync(`${out}.txt`, ` darija words from ${model}\n`);
    return '';
  };
  return { runs, tr: createLocalTranscriber({ root, build: 'cuda', run }) };
}
{
  const { runs, tr } = fake('fr');
  const r = await tr.transcribe(wav);
  assert.deepEqual(r, { text: 'Bonjour tout le monde.', lang: 'fr', model: 'stock' });
  assert.equal(runs.length, 1, 'French is read once, by the stock model');
  assert.ok(runs[0].includes('ggml-large-v3-turbo-q5_0.bin') || runs[0].some((a) => a.endsWith('ggml-large-v3-turbo-q5_0.bin')));
  assert.equal(runs[0][runs[0].indexOf('-l') + 1], 'auto');
}
{
  const { runs, tr } = fake('ar');
  const r = await tr.transcribe(wav);
  assert.equal(runs.length, 2, 'Arabic is read again by the Darija model');
  assert.equal(r.model, 'darija'); assert.equal(r.lang, 'ar');
  assert.match(r.text, /darija words from ggml-medium-darija-q5_0\.bin/);
  assert.equal(runs[1][runs[1].indexOf('-l') + 1], 'ar', 'the Darija model must be told ar');
  assert.ok(fs.readdirSync(path.join(root, 'tmp')).length === 0, 'temporary output is removed');
}

// Download: URLs are checked, files verified and unpacked; a bad checksum is refused; ready only when all is in place.
{
  const bodies = {};
  const fakeParts = {};
  for (const k of partsFor('cpu')) {
    const f = PARTS[k].files[0], body = Buffer.from(`data-${k}`);
    bodies[PARTS[k].base + f.name] = body;
    fakeParts[k] = { size: f.size, sha256: f.sha256 };
    f.size = body.length; f.sha256 = createHash('sha256').update(body).digest('hex');
  }
  const fetchImpl = async (url) => {
    const b = bodies[url];
    return b ? { ok: true, status: 200, body: (async function* () { yield b; })() } : { ok: false, status: 404 };
  };
  const r2 = path.join(root, 'dl');
  const unzipImpl = async (zip, dest) => { fs.mkdirSync(path.join(dest, 'Release'), { recursive: true }); fs.writeFileSync(path.join(dest, 'Release', 'whisper-cli.exe'), 'x'); };
  let last = null;
  assert.equal(isSttReady(r2, 'cpu'), false);
  await downloadStt(r2, { build: 'cpu', fetchImpl, unzipImpl, onProgress: (p) => { last = p; } });
  assert.deepEqual(last, { done: totalFor('cpu'), total: totalFor('cpu') });
  assert.equal(isSttReady(r2, 'cpu'), true);
  removeStt(r2);
  assert.equal(isSttReady(r2, 'cpu'), false);
  // A tampered file is refused.
  const bad = async (url) => ({ ok: true, status: 200, body: (async function* () { yield Buffer.from('tampered!!'); })() });
  await assert.rejects(downloadStt(path.join(root, 'dl2'), { build: 'cpu', fetchImpl: bad, unzipImpl, retries: 0 }), (e) => ['checksum', 'network'].includes(e.code));
  assert.equal(isSttReady(path.join(root, 'dl2'), 'cpu'), false);
  // Restore the real pins for anything run after this in the same process.
  for (const k of partsFor('cpu')) Object.assign(PARTS[k].files[0], fakeParts[k]);
}

fs.rmSync(root, { recursive: true, force: true });
console.log('local stt tests: passed');
