// Storage: sessions, screenshots never on disk, context trimming, commitments, facts, reminders.
// Runs against a throwaway HOME so it never touches real data. Run: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'roamies-store-test-'));
process.env.HOME = TMP; process.env.USERPROFILE = TMP;
const STORE = new URL('../store.mjs', import.meta.url).href;
process.on('exit', () => fs.rmSync(TMP, { recursive: true, force: true }));
const S = await import(STORE);
const dir = S.DIR;
assert.ok(dir.startsWith(TMP), 'store must live under the test HOME: ' + dir);
assert.ok(dir.startsWith(process.env.HOME), 'store must live under the test HOME: ' + dir);

// staleness
const s = S.newSession('anthropic', 'claude-haiku-5-5');
assert.equal(S.isStale(s), false);
assert.equal(S.isStale({ ...s, lastActiveAt: Date.now() - 3 * 3600e3 }), true, '3h gap is stale');
const y = new Date(); y.setDate(y.getDate() - 1);
assert.equal(S.isStale({ ...s, lastActiveAt: y.getTime() }), true, 'yesterday is stale');
assert.equal(S.isStale(null), true);

// screenshots never reach disk
const msgs = [
  { role: 'system', content: 'sys' },
  { role: 'user', content: 'look' },
  { role: 'assistant', content: [{ type: 'tool_call', id: 't1', name: 'take_screenshot', args: {} }] },
  { role: 'tool', content: [{ type: 'tool_result', toolCallId: 't1', content: [{ type: 'text', text: 'Screenshot' }, { type: 'image', mediaType: 'image/jpeg', data: 'A'.repeat(50000) }] }] },
  { role: 'assistant', content: 'I see Brave.' },
];
const disk = S.forDisk(msgs);
assert.equal(disk.some((m) => m.role === 'system'), false, 'system not saved');
assert.equal(JSON.stringify(disk).includes('AAAA'), false, 'image bytes not saved');

// atomic save + resume
s.messages = disk;
await S.saveSession(s);
const f = path.join(dir, 'sessions', `${s.id}.json`);
assert.ok(fs.existsSync(f));
// Unix permission bits don't exist on Windows (NTFS reports 0666), so only check them elsewhere.
if (process.platform !== 'win32') assert.equal((fs.statSync(f).mode & 0o777).toString(8), '600', 'private file');
assert.equal(fs.readdirSync(path.join(dir, 'sessions')).some((n) => n.endsWith('.tmp')), false, 'no temp leftovers');
assert.equal((await S.loadLatestSession()).id, s.id);

// corrupt newest session → skipped, kept aside, older one still loads
const bad = path.join(dir, 'sessions', '29991231-235959-zzzzzz.json');
fs.writeFileSync(bad, '{"version":1,"messa');
assert.equal((await S.loadLatestSession()).id, s.id, 'falls back past a corrupt file');
assert.ok(fs.readdirSync(path.join(dir, 'sessions')).some((n) => n.startsWith('29991231-235959-zzzzzz.json.corrupt-')), 'corrupt file kept aside');

// context trimming keeps the newest screenshot only, and fits budget at a user boundary
const many = [{ role: 'system', content: 'sys' }];
for (let i = 0; i < 40; i++) {
  many.push({ role: 'user', content: `q${i} ` + 'x'.repeat(4000) });
  many.push({ role: 'assistant', content: [{ type: 'tool_call', id: `t${i}`, name: 'take_screenshot', args: {} }] });
  many.push({ role: 'tool', content: [{ type: 'tool_result', toolCallId: `t${i}`, content: [{ type: 'image', mediaType: 'image/jpeg', data: 'B' }] }] });
  many.push({ role: 'assistant', content: `a${i}` });
}
const fit = S.fitContext(many, { budgetTokens: 20000 });
const imgs = JSON.stringify(fit).split('"type":"image"').length - 1;
assert.equal(imgs, 1, 'only the newest screenshot stays');
assert.equal(fit[0].role, 'system');
assert.equal(fit[1].role, 'user', 'cut lands on a user message');
assert.ok(fit.length < many.length, 'trimmed');
assert.ok(fit[1].content.startsWith('[Older parts'), 'trim is noted');
const ids = new Set(fit.filter((m) => m.role === 'assistant' && Array.isArray(m.content)).flatMap((m) => m.content.map((p) => p.id)));
for (const m of fit.filter((m) => m.role === 'tool')) for (const r of m.content) assert.ok(ids.has(r.toolCallId), 'every tool result has its call');

// cross-provider: thinking stripped
const cp = S.forProvider([{ role: 'assistant', content: [{ type: 'thinking', text: 'hm', signature: 'sig' }, { type: 'text', text: 'hi' }] }], 'anthropic', 'openai');
assert.deepEqual(cp[0].content, [{ type: 'text', text: 'hi' }]);

// commitments + reminders
assert.equal(S.parseDue('2026-10-30'), new Date('2026-10-30T10:00').getTime());
assert.equal(S.parseDue('nonsense'), undefined);
assert.equal(S.parseDue(undefined), null);
const past = await S.addCommitment('Record the agent race video', Date.now() - 60e3);
const future = await S.addCommitment('Post the Skool announcement', Date.now() + 86400e3);
const nodate = await S.addCommitment('Cut three Shorts');
let due = await S.takeDueReminders();
assert.deepEqual(due.map((c) => c.id), [past.id], 'only the overdue one fires');
assert.equal((await S.takeDueReminders()).length, 0, 'not again right away');
await S.updateCommitment(past.id, { status: 'done' });
assert.deepEqual(S.openCommitments().map((c) => c.id).sort(), [future.id, nodate.id].sort());
const mem = JSON.parse(fs.readFileSync(path.join(dir, 'memory.json'), 'utf8'));
assert.equal(mem.commitments.find((c) => c.id === past.id).status, 'done', 'persisted');

// corrupt memory → .bak used
fs.writeFileSync(path.join(dir, 'memory.json'), 'garbage');
const fresh = await import(STORE + '?again');
assert.ok(fresh.openCommitments().length >= 1, 'recovered from .bak');

// pruning keeps 60 newest, never touches other files
fs.writeFileSync(path.join(dir, 'sessions', 'notes.txt'), 'mine');
for (let i = 0; i < 70; i++) fs.writeFileSync(path.join(dir, 'sessions', `2020${String(1 + (i % 12)).padStart(2, '0')}${String(1 + i % 28).padStart(2, '0')}-000000-${String(i).padStart(6, 'a')}.json`), '{}');
await S.pruneSessions();
const left = fs.readdirSync(path.join(dir, 'sessions'));
assert.equal(left.filter((n) => /^\d{8}-\d{6}-[a-z0-9]{6}\.json$/.test(n)).length, 60);
assert.ok(left.includes('notes.txt'), 'unrelated file untouched');
assert.ok(left.some((n) => n.includes('.corrupt-')), 'corrupt copy untouched');
assert.ok(left.includes(`${s.id}.json`), 'newest real session kept');
console.log('store tests: all passed');

// Area snaps (images in user messages) count too: only the newest image overall survives.
{
  const S2 = await import(STORE + '?snap');
  const mix = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: [{ type: 'text', text: 'what is this' }, { type: 'image', mediaType: 'image/png', data: 'S1' }] },
    { role: 'assistant', content: 'a button' },
    { role: 'user', content: 'look at my screen' },
    { role: 'assistant', content: [{ type: 'tool_call', id: 'tA', name: 'take_screenshot', args: {} }] },
    { role: 'tool', content: [{ type: 'tool_result', toolCallId: 'tA', content: [{ type: 'image', mediaType: 'image/jpeg', data: 'T1' }] }] },
    { role: 'assistant', content: 'ok' },
    { role: 'user', content: [{ type: 'text', text: 'and this?' }, { type: 'image', mediaType: 'image/png', data: 'S2' }] },
  ];
  const f = S2.fitContext(mix, { budgetTokens: 1e6 });
  const datas = JSON.stringify(f).match(/"data":"(\w+)"/g) ?? [];
  assert.deepEqual(datas, ['"data":"S2"'], 'only the newest image (the latest snap) is kept');
  assert.equal(S2.forDisk(mix).some((m) => JSON.stringify(m).includes('"S2"')), false, 'snaps never reach disk');
  console.log('snap image tests: passed');
}

// Facts + relative/second-precise due times.
{
  const S3 = await import(STORE + '?facts');
  const now = Date.parse('2026-10-29T15:00:00');
  assert.equal(S3.parseDue('in 90s', now), now + 90_000);
  assert.equal(S3.parseDue('in 1h30m', now), now + 5_400_000);
  assert.equal(S3.parseDue('2026-10-29T15:30:45', now), Date.parse('2026-10-29T15:30:45'));
  assert.equal(S3.parseDue('in banana', now), undefined);
  const a = await S3.addFact('Ken hates long intros');
  const b = await S3.addFact('ken hates long intros!');
  assert.equal(a.id, b.id, 'near-duplicate facts are merged');
  assert.ok(S3.listFacts().some((f) => f.id === a.id));
  assert.ok(await S3.forgetFact(a.id));
  assert.equal(S3.listFacts().some((f) => f.id === a.id), false, 'forgotten');
  const soon = await S3.addCommitment('ping', Date.now() + 5_000);
  assert.ok(Math.abs(S3.nextDue() - soon.due) < 5, 'nextDue points at the soonest open reminder');
  console.log('facts + timer tests: passed');
}

// Relevance pick: with more facts than the limit, matching ones and the newest are chosen.
{
  const S4 = await import(STORE + '?pick');
  await S4.clearFacts();
  for (let i = 0; i < 60; i++) await S4.addFact(`filler fact number ${i} about nothing much`);
  await S4.addFact('Ken edits videos in Final Cut Pro');
  const picked = S4.pickFacts('how do I trim a clip in Final Cut', 10);
  assert.equal(picked.length, 10, 'respects the limit');
  assert.ok(picked.some((f) => f.text.includes('Final Cut')), 'relevant fact chosen');
  assert.equal(S4.pickFacts('', 100).length, 61, 'under the limit: everything');
  // Regression: ids used to be 4 hex chars, so a few dozen facts could collide (~3% at 61).
  for (let i = 0; i < 400; i++) await S4.addFact(`unique fact ${i}`);
  const ids = S4.listFacts().map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length, 'fact ids are unique');
  console.log('fact relevance tests: passed');
}
