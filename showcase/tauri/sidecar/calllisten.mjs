// Record: takes each finished 30 s WAV chunk from the voice helper, turns it into text with the local models
// (localstt.mjs: nothing leaves this computer), saves the words (callmemory.mjs) and deletes the audio unless the user chose to
// keep it. When a call session ends it makes one summary on this computer.
import fs from 'node:fs';
import { checkCallChunk, cleanTranscript } from './safety.mjs';
import { summarizeCall } from './callsummary.mjs';

export function createCallListener({
  dir, memory, transcribe, ready = () => true, getApp = async () => '', keepAudio = () => false, say = () => {}, onChange = () => {}, onText = () => {},
  now = Date.now, fsImpl = fs,
}) {
  let session = null;      // the call being recorded: 'c<ms>'
  let startedAt = 0;
  let queue = Promise.resolve();
  let told = { nomodel: false, bad: false };
  const stats = { chunks: 0, failed: 0, last: null };

  const drop = (file) => { try { fsImpl.unlinkSync(file); } catch { /* already gone */ } };
  const finishFile = (file) => { if (!keepAudio()) drop(file); };

  async function handle(chunk) {
    const file = chunk?.path;
    const dirOk = checkCallChunk(file, dir);
    if (dirOk.level !== 'safe') return; // not ours: never touched
    if (!session) return finishFile(file); // recording was switched off meanwhile
    if (!ready()) {
      drop(file);
      if (!told.nomodel) { told.nomodel = true; say('Call audio is on but the local transcription models are not downloaded, so nothing was transcribed. Download them on the Listening page.', 'concerned'); }
      return;
    }
    try {
      const heard = await transcribe(file);
      const text = cleanTranscript(heard?.text);
      const secs = Number(chunk.secs) || 30;
      if (text && text.split(/\s+/).length >= 2) {
        const app = await Promise.resolve(getApp()).catch(() => '');
        const entry = memory.addTranscript({ at: Number(chunk.at) || now(), secs, text, session, app, lang: heard?.lang });
        if (entry) { stats.chunks++; stats.last = entry.at; onText(entry); }
      }
      told.bad = false;
    } catch (e) {
      stats.failed++;
      if (!told.bad) { told.bad = true; say('I could not transcribe a piece of call audio on this computer. I will keep trying with the next one.', 'concerned'); }
    } finally {
      finishFile(file);
      onChange();
    }
  }

  function summarize(id) {
    const rows = memory.forSession(id);
    if (!rows.length) return { made: false, reason: 'nothing was said' };
    const { summary, reason } = summarizeCall(rows);
    if (!summary) return { made: false, reason };
    memory.addSummary({ session: id, at: rows[0].at, subject: summary.subject, points: summary.points, chunks: rows.length });
    return { made: true, reason: '' };
  }

  return {
    get recording() { return !!session; },
    stats,
    /** Recording started (the switch went on and the helper confirmed). */
    begin() { if (!session) { startedAt = now(); session = `c${startedAt}`; told = { nomodel: false, bad: false }; stats.chunks = 0; stats.failed = 0; } return session; },
    /** A finished chunk: read in order, one at a time. */
    add(chunk) { queue = queue.then(() => handle(chunk)).catch(() => {}); return queue; },
    /** The call session ended: waits for the chunks in flight, then makes the one summary. Returns { made, reason }. */
    async end() {
      if (!session) return { made: false, reason: 'no call' };
      const id = session;
      await queue; // the chunks in flight are read while the call is still the current session
      session = null;
      const r = summarize(id);
      onChange();
      return r;
    },
    /** Sessions left without a summary (the app was closed mid-call). */
    recover() { return memory.unsummarized().map((id) => ({ id, ...summarize(id) })); },
    /** Chunk files left in the folder from an earlier run are deleted (unless kept). */
    sweep() {
      if (keepAudio()) return 0;
      let n = 0;
      try { for (const f of fsImpl.readdirSync(dir)) if (/^call-\d+\.wav$/.test(f)) { drop(`${dir}/${f}`); n++; } } catch { /* no folder yet */ }
      return n;
    },
  };
}
