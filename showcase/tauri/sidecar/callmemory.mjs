// What was said in calls, kept on this computer: DATA_DIR/calls/transcripts.jsonl (one entry per 30 s chunk: id, time, text,
// session, app) and summaries.jsonl (one per finished call). Nothing here touches the network. View, search, delete.
import fs from 'node:fs';
import path from 'node:path';
import { CALL_MEMORY, cleanTranscript, isCallEntryId } from './safety.mjs';

const readLines = (file) => {
  try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; }
};
const writeAll = (file, rows) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
  fs.renameSync(tmp, file);
};

export function createCallMemory(dir) {
  const tFile = path.join(dir, 'transcripts.jsonl'), sFile = path.join(dir, 'summaries.jsonl');
  return {
    dir,
    /** One entry per chunk: { id, at, secs, text, session }. Returns it, or null when there were no words. */
    addTranscript({ at, secs = 0, text, session, app = '', lang = '' }) {
      const clean = cleanTranscript(text);
      if (!clean || !Number.isFinite(at)) return null;
      const entry = { id: `t-${Math.floor(at)}`, at: Math.floor(at), secs: Math.round(secs), text: clean, session: String(session ?? ''), app: String(app ?? '').replace(/\s+/g, ' ').trim().slice(0, 60), lang: String(lang ?? '').replace(/[^a-z-]/gi, '').slice(0, 8) };
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(tFile, JSON.stringify(entry) + '\n');
      const all = readLines(tFile);
      if (all.length > CALL_MEMORY.maxEntries) writeAll(tFile, all.slice(-CALL_MEMORY.maxEntries));
      return entry;
    },
    addSummary({ session, at, subject, points, chunks }) {
      const row = { id: `s-${Math.floor(at)}`, session: String(session), at: Math.floor(at), subject: String(subject).slice(0, 200), points: points.map((p) => String(p).slice(0, 300)).slice(0, 8), chunks: chunks | 0 };
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(sFile, JSON.stringify(row) + '\n');
      return row;
    },
    transcripts: () => readLines(tFile),
    summaries: () => readLines(sFile),
    forSession: (session) => readLines(tFile).filter((e) => e.session === session),
    /** Sessions that have words but no summary yet (a crash or a quit before the end). */
    unsummarized() {
      const done = new Set(readLines(sFile).map((s) => s.session));
      return [...new Set(readLines(tFile).map((e) => e.session).filter((s) => s && !done.has(s)))];
    },
    /** Newest first. q matches the words of transcripts and the subject and points of summaries (every word must be in it). */
    search(q = '', limit = 50) {
      const terms = String(q ?? '').toLowerCase().slice(0, CALL_MEMORY.maxQuery).split(/\s+/).filter(Boolean);
      const hit = (s) => terms.every((t) => s.toLowerCase().includes(t));
      const rows = [
        ...readLines(sFile).map((s) => ({ kind: 'summary', ...s, _s: `${s.subject} ${s.points.join(' ')}` })),
        ...readLines(tFile).map((t) => ({ kind: 'transcript', ...t, _s: `${t.text} ${t.app ?? ''}` })),
      ].filter((r) => hit(r._s)).sort((a, b) => b.at - a.at).slice(0, limit);
      return rows.map(({ _s, ...r }) => r);
    },
    /** Deletes one entry by id (a transcript or a summary). */
    remove(id) {
      if (!isCallEntryId(id)) return false;
      const file = id.startsWith('t-') ? tFile : sFile, rows = readLines(file), left = rows.filter((r) => r.id !== id);
      if (left.length === rows.length) return false;
      writeAll(file, left);
      return true;
    },
    /** Deletes a whole call: its summary and its transcripts. */
    removeSession(session) {
      writeAll(tFile, readLines(tFile).filter((e) => e.session !== session));
      writeAll(sFile, readLines(sFile).filter((e) => e.session !== session));
    },
    clear() { writeAll(tFile, []); writeAll(sFile, []); },
  };
}
