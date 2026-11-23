// Token use over time. usage.jsonl holds one line per request with token counts and timings only, never what was
// said; the sidecar appends to it and the panel shows today's cards and the last two weeks.
import fs from 'node:fs';

const pad = (n) => String(n).padStart(2, '0');
export const dayKey = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const empty = () => ({ requests: 0, tokens: 0, input: 0, cacheRead: 0, cacheWrite: 0, out: 0 });

export function createUsageLog(file, { now = Date.now } = {}) {
  const byDay = new Map();
  const get = (key) => byDay.get(key) ?? empty();

  function add(rec) {
    const key = dayKey(rec.t ?? now());
    const u = byDay.get(key) ?? empty();
    byDay.set(key, u);
    u.requests++;
    u.input += rec.in ?? 0;
    u.cacheRead += rec.cacheRead ?? 0;
    u.cacheWrite += rec.cacheWrite ?? 0;
    u.out += rec.out ?? 0;
    // The same total the app has always shown: what was sent, written to cache and answered.
    u.tokens = u.input + u.cacheWrite + u.out;
    return u;
  }

  function load() {
    try {
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try { add(JSON.parse(line)); } catch {} // a torn last line is not worth failing the start over
      }
    } catch {}
  }

  function today() { return { ...get(dayKey(now())) }; }

  function record(rec) {
    const u = add(rec);
    fs.promises.appendFile(file, JSON.stringify(rec) + '\n', { mode: 0o600 }).catch(() => {});
    return u;
  }

  // One entry per day for the last `days`, including empty days, oldest first.
  function history(days = 14) {
    const out = [];
    const start = new Date(now());
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));
    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      out.push({ day: dayKey(d.getTime()), ...get(dayKey(d.getTime())) });
    }
    return out;
  }

  function total(days) {
    const out = empty();
    for (const x of history(days)) for (const k of Object.keys(out)) out[k] += x[k];
    return out;
  }

  load();
  return { add, record, today, history, total };
}
