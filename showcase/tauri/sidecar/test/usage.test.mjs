// Token use over time: replay usage.jsonl, bucket it by day, and keep today's counts live. Run: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createUsageLog, dayKey } from '../usage.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roamies-usage-test-'));
const file = path.join(dir, 'usage.jsonl');
const now = new Date('2026-11-23T12:00:00').getTime();
const DAY = 864e5;
const rec = (t, input, cacheRead, cacheWrite, out) => JSON.stringify({ t, model: 'test/model', in: input, cacheRead, cacheWrite, out, ms: 1 });
fs.writeFileSync(file, [
  rec(now - 1000, 100, 20, 10, 50),
  rec(now - 2000, 0, 0, 0, 5),
  rec(now - DAY, 10, 0, 0, 10),
  rec(now - 8 * DAY, 7, 0, 0, 3),
  '{ torn last line',
].join('\n') + '\n');

const usage = createUsageLog(file, { now: () => now });
const today = usage.today();
assert.equal(today.requests, 2);
assert.deepEqual({ input: today.input, cacheRead: today.cacheRead, cacheWrite: today.cacheWrite, out: today.out }, { input: 100, cacheRead: 20, cacheWrite: 10, out: 55 });
assert.equal(today.tokens, 165, 'input + cache writes + output, as before');

const history = usage.history(14);
assert.equal(history.length, 14);
assert.equal(history.at(-1).day, dayKey(now), 'today is last');
assert.equal(history.at(-1).requests, 2);
assert.equal(history.at(-2).requests, 1, 'yesterday is next to last');
assert.equal(history.find((d) => d.day === dayKey(now - 8 * DAY)).requests, 1, 'an older day is still there');

const week = usage.total(7);
assert.equal(week.requests, 3, 'the 8-day-old record is outside the week');
assert.equal(week.tokens, 185);
const month = usage.total(30);
assert.equal(month.requests, 4);
assert.equal(month.tokens, 195);

usage.record({ t: now, in: 1, cacheRead: 0, cacheWrite: 2, out: 3 });
assert.equal(usage.today().requests, 3);
assert.equal(usage.today().tokens, 171);
await new Promise((r) => setTimeout(r, 50));
const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
assert.equal(lines.length, 6, 'the new record was appended after the torn one');
assert.equal(JSON.parse(lines.at(-1)).out, 3);

fs.rmSync(dir, { recursive: true, force: true });
console.log('usage tests: passed');
