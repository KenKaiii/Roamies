// search_files (tools.mjs searchText): an rg error comes back as an error, not "No matches." (#208).
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { searchText } from '../tools.mjs';

const fail = (code, stderr = '') => ({ err: Object.assign(new Error('Command failed'), { code }), stdout: '', stderr });
const fake = (...answers) => { const calls = []; return { calls, runner: async (cmd, args) => { calls.push(cmd); return answers.shift(); } }; };

{ const f = fake(fail(1)); assert.equal(await searchText('x', '/d', f.runner), 'No matches.', 'exit 1 is no matches'); assert.deepEqual(f.calls, ['rg']); }
{ const f = fake({ err: null, stdout: 'a.txt:1:x\n', stderr: '' }); assert.equal(await searchText('x', '/d', f.runner), 'a.txt:1:x\n'); }
{ const f = fake(fail(2, 'regex parse error: unclosed group'));
  await assert.rejects(searchText('(', '/d', f.runner), /unclosed group/, 'exit 2 is an error with rg\'s message'); }
{ const f = fake({ ...fail(2, 'Permission denied'), stdout: 'a.txt:1:x\n' });
  assert.equal(await searchText('x', '/d', f.runner), 'a.txt:1:x\n', 'matches found despite unreadable files are kept'); }
for (const code of ['ENOENT', 'EACCES']) {
  const f = fake(fail(code), fail(1));
  assert.equal(await searchText('x', '/d', f.runner), 'No matches.'); assert.deepEqual(f.calls, ['rg', 'grep'], `${code} falls back to grep`);
}
{ const f = fake(fail('ENOENT'), fail('ENOENT'));
  await assert.rejects(searchText('x', '/d', f.runner), /neither rg nor grep/, 'nothing to search with is said plainly'); }
{ const f = fake(fail('EACCES'), fail(2, 'grep: Unmatched ( or \\('));
  await assert.rejects(searchText('(', '/d', f.runner), /Unmatched/, 'a grep error is an error too'); }

// The real thing, with whichever of rg and grep is installed.
const dir = mkdtempSync(path.join(os.tmpdir(), 'roamies-search-'));
const tool = (await searchText('x', dir).then(() => true, (e) => !/neither rg nor grep/.test(e.message)));
try {
  if (!tool) throw Object.assign(new Error('skip'), { skip: true });
  writeFileSync(path.join(dir, 'a.txt'), 'hello world\n');
  assert.match(await searchText('hello', dir), /hello world/);
  assert.equal(await searchText('nothing-here-7f3a', dir), 'No matches.');
  if (process.platform !== 'win32') await assert.rejects(searchText('(', dir), /Search failed/);
} catch (e) { if (!e.skip) throw e; console.log('search tests: no rg or grep here, real search skipped'); } finally { rmSync(dir, { recursive: true, force: true }); }
console.log('search tests: passed');
