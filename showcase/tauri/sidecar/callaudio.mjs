// What the voice helper heard other people say in a call (Record): a short in-memory log, handed to the
// assistant once as a block labelled call audio (safety.mjs frameCallAudio). It never starts a turn, and nothing is saved.
import { CALL_AUDIO, cleanCallLine, frameCallAudio } from './safety.mjs';

export function createCallLog({ now = Date.now } = {}) {
  let lines = [];
  const prune = () => { const t = now(); lines = lines.filter((l) => t - l.at <= CALL_AUDIO.maxAgeMs).slice(-CALL_AUDIO.maxLines); };
  return {
    /** A heard phrase. False when there was nothing in it. */
    add(text) {
      const clean = cleanCallLine(text);
      if (!clean) return false;
      lines.push({ at: now(), text: clean, sent: false });
      prune();
      return true;
    },
    /** What came in since the last time, framed for the next message ('' when nothing is new). */
    take(userName) {
      prune();
      const fresh = lines.filter((l) => !l.sent);
      if (!fresh.length) return '';
      for (const l of fresh) l.sent = true;
      return frameCallAudio(fresh, { userName, now: now() });
    },
    clear() { lines = []; },
    get size() { return lines.length; },
  };
}
