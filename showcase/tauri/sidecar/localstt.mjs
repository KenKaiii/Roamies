// Local speech-to-text for call audio, free and offline once downloaded (nothing is sent anywhere):
//   - whisper.cpp (MIT), the Windows build: CUDA when an NVIDIA GPU is there, otherwise CPU
//   - a stock multilingual Whisper (large-v3-turbo, q5_0) for French, English and other Arabic
//   - a Moroccan Darija fine-tune of Whisper medium (q5_0, Apache-2.0)
// Every chunk goes through the stock model first with language detection; when it hears Arabic, the chunk is read again by
// the Darija model, which is much better at Darija but unusable for French or English (it has no Darija language token, so
// it must be told "ar"). Files are pinned by size and SHA-256 and may only come from the addresses in checkSttUrl.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import tls from 'node:tls';
import { checkSttUrl } from './safety.mjs';
import { downloadModel, isReady } from './voicemodel.mjs';
import { dataPaths } from './datadir.mjs';

const GH = 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/';

export const PARTS = {
  'bin-cuda': { id: 'whisper-cpp-b5454-cuda12', base: GH, files: [{ name: 'whisper-bin-win-cuda-12.4.0-x64.zip', size: 684913404, sha256: 'afef0b881c500958921c3f5523b50e59ee2ec9b6f5cbd25b324c51ed308a957a' }] },
  'bin-cpu': { id: 'whisper-cpp-b5454-cpu', base: GH, files: [{ name: 'whisper-bin-x64.zip', size: 8928640, sha256: '6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb' }] },
  stock: { id: 'whisper-large-v3-turbo-q5_0', base: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/', files: [{ name: 'ggml-large-v3-turbo-q5_0.bin', size: 574041195, sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2' }] },
  darija: { id: 'whisper-medium-darija-q5_0', base: 'https://huggingface.co/MedHachim/whisper-medium-darija-ggml/resolve/main/', files: [{ name: 'ggml-medium-darija-q5_0.bin', size: 539212484, sha256: '1271472614bae20fdf0d7f99be18ce2b881036f6a26df501fbfc3bdde48888ce' }] },
};

/** The parts to fetch for this PC. */
export const partsFor = (build) => [build === 'cuda' ? 'bin-cuda' : 'bin-cpu', 'stock', 'darija'];
export const totalFor = (build) => partsFor(build).reduce((n, k) => n + PARTS[k].files.reduce((m, f) => m + f.size, 0), 0);
export const sizeLabelFor = (build) => `${(totalFor(build) / 1e9).toFixed(1)} GB`;

export function sttRoot() {
  const root = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Roamies') : dataPaths().dir;
  return path.join(root, 'models', 'call-stt');
}
const partDir = (root, key) => path.join(root, key);
const binPath = (root, build) => path.join(partDir(root, build === 'cuda' ? 'bin-cuda' : 'bin-cpu'), 'Release', 'whisper-cli.exe');
const modelPath = (root, key) => path.join(partDir(root, key), PARTS[key].files[0].name);

/** 'cuda' when `nvidia-smi` answers (an NVIDIA driver is installed), else 'cpu'. */
export function detectBuild(run = (cmd, args, cb) => execFile(cmd, args, { timeout: 5000, windowsHide: true }, cb)) {
  return new Promise((resolve) => { try { run('nvidia-smi', ['-L'], (err, out) => resolve(!err && /GPU \d/.test(String(out)) ? 'cuda' : 'cpu')); } catch { resolve('cpu'); } });
}

export function isSttReady(root, build) {
  try { return partsFor(build).every((k) => isReady(partDir(root, k), PARTS[k])) && fs.existsSync(binPath(root, build)); } catch { return false; }
}

/** Antivirus and company proxies re-sign HTTPS traffic with a certificate that Windows trusts but Node's built-in list does not,
 *  which makes downloads fail with "self-signed certificate in certificate chain". Trusting the system store too fixes that and
 *  still verifies every certificate. Needs Node 24.5+; on older versions it does nothing. */
let systemCaDone = false;
export function trustSystemCerts() {
  if (systemCaDone) return;
  systemCaDone = true;
  try { if (typeof tls.setDefaultCACertificates === 'function') tls.setDefaultCACertificates([...tls.getCACertificates('default'), ...tls.getCACertificates('system')]); } catch { /* keep the built-in list */ }
}

const fail = (code, message) => Object.assign(new Error(message), { code });

function unzip(zip, dest) {
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'); // bsdtar reads zip files and refuses paths that escape dest
  return new Promise((resolve, reject) => execFile(tar, ['-xf', zip, '-C', dest], { timeout: 120_000, windowsHide: true }, (e) => (e ? reject(fail('unzip', 'Could not unpack whisper.cpp')) : resolve())));
}

/**
 * Downloads and verifies everything for `build`, one part after the other, and unpacks whisper.cpp.
 * onProgress({ done, total }) covers all parts together. Errors carry a code: 'blocked', 'disk', 'checksum', 'network', 'unzip', 'aborted'.
 */
export async function downloadStt(root, { build, onProgress = () => {}, signal, fetchImpl = fetch, retries = 4, retryDelay = 2000, unzipImpl = unzip } = {}) {
  const keys = partsFor(build), total = totalFor(build);
  trustSystemCerts();
  for (const k of keys) for (const f of PARTS[k].files) {
    const ok = checkSttUrl(PARTS[k].base + f.name);
    if (ok.level !== 'safe') throw fail('blocked', ok.reason);
  }
  let before = 0;
  for (const k of keys) {
    const part = PARTS[k], size = part.files.reduce((n, f) => n + f.size, 0), dir = partDir(root, k);
    await downloadModel(dir, { model: part, signal, fetchImpl, retries, retryDelay, onProgress: ({ done }) => onProgress({ done: before + done, total }) });
    if (k.startsWith('bin-') && !fs.existsSync(binPath(root, build))) await unzipImpl(path.join(dir, part.files[0].name), dir);
    before += size;
  }
  if (!isSttReady(root, build)) throw fail('unzip', 'whisper.cpp is not where it should be');
  onProgress({ done: total, total });
}

/** Deletes what downloadStt fetched (models and program). */
export function removeStt(root) { fs.rmSync(root, { recursive: true, force: true }); }

const defaultRun = (bin, args) => new Promise((resolve, reject) => {
  execFile(bin, args, { timeout: 180_000, windowsHide: true, maxBuffer: 8 << 20, cwd: path.dirname(bin) }, (e, out, err) => (e ? reject(Object.assign(new Error(String(err || e.message).slice(0, 300)), { code: 'stt' })) : resolve(String(out))));
});

const words = (segments) => (Array.isArray(segments) ? segments : []).map((s) => String(s?.text ?? '')).join(' ').replace(/\s+/g, ' ').trim();

/**
 * transcribe(wavPath) -> { text, lang, model } where model is 'stock' or 'darija'.
 * `run(bin, args)` is injected for tests.
 */
export function createLocalTranscriber({ root, build, run = defaultRun, fsImpl = fs, tmp = () => path.join(root, 'tmp') }) {
  const bin = binPath(root, build);
  const base = `read-${process.pid}`;
  async function transcribe(wav) {
    fsImpl.mkdirSync(tmp(), { recursive: true });
    const out = path.join(tmp(), base);
    const common = ['-f', wav, '-nt', '-np', '-t', '8'];
    const json = `${out}.json`, txt = `${out}.txt`;
    const drop = () => { for (const f of [json, txt]) try { fsImpl.unlinkSync(f); } catch { /* not there */ } };
    try {
      await run(bin, ['-m', modelPath(root, 'stock'), '-l', 'auto', '-oj', '-of', out, ...common]);
      const j = JSON.parse(fsImpl.readFileSync(json, 'utf8'));
      const lang = String(j?.result?.language ?? '');
      if (lang !== 'ar') return { text: words(j?.transcription), lang, model: 'stock' };
      // Arabic: the stock model is weak on Darija, so the Darija model reads the same chunk.
      await run(bin, ['-m', modelPath(root, 'darija'), '-l', 'ar', '-otxt', '-of', out, ...common]);
      return { text: String(fsImpl.readFileSync(txt, 'utf8')).replace(/\s+/g, ' ').trim(), lang: 'ar', model: 'darija' };
    } finally { drop(); }
  }
  return { transcribe };
}
