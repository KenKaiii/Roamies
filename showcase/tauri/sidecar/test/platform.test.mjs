// What the model is told about each system, and which features each one gets. Run: npm test
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { canCircle, canSnap, hasHands, platformLine } from '../platform.mjs';

const win = platformLine('win32', { arch: 'x64', release: '10.0.22631' });
assert.match(win, /^Platform: Windows 11 on x64\./);
assert.match(win, /Ctrl, not Cmd/, 'Windows keys, not Mac ones');
assert.match(win, /Ctrl\+End and Ctrl\+Home/);
assert.match(win, /cmd\.exe/, 'commands run in cmd, not a Unix shell');
assert.ok(!/Cmd\+Down|BSD/.test(win), 'none of the Mac advice');
assert.match(platformLine('win32', { release: '10.0.19045' }), /^Platform: Windows 10 /);
const mac = platformLine('darwin', { macVersion: '15.1', arch: 'arm64' });
assert.match(mac, /^Platform: macOS 15\.1 on Apple silicon\. Use Mac keys: Cmd, not Ctrl/);
assert.equal(platformLine('linux'), 'Platform: linux.');

// Ask About an Area needs the helper's area selection: macOS, and Windows with the helper there.
assert.ok(canSnap('darwin', '') && canSnap('win32', 'C:\\Roamies\\roamies-hands.exe'));
assert.ok(!canSnap('win32', '') && !canSnap('linux', '/x/roamies-hands'));
assert.ok(hasHands('darwin', '') && hasHands('win32', 'x') && !hasHands('win32', ''));
assert.ok(canCircle('darwin') && canCircle('win32') && !canCircle('linux'));

// With the helper there, its tools are offered on any system (Windows has one now).
const tools = new URL('../tools.mjs', import.meta.url).href;
const names = execFileSync(process.execPath, ['--input-type=module', '-e', `
  const { createTools } = await import(${JSON.stringify(tools)});
  const noop = async () => {};
  const { tools } = createTools({ allowActions: () => false, ui: () => {}, ask: noop, openUrl: noop, onCommitments: noop, showList: noop, fmtWhen: String, commitmentsText: () => '', userName: 'T' });
  console.log(tools.map((t) => t.name).join(','));`], { env: { ...process.env, ROAMIES_HANDS: 'fake-hands.mjs' }, encoding: 'utf8' }).trim().split(',');
for (const n of ['list_windows', 'read_window', 'act_in_app']) assert.ok(names.includes(n), `${n} is offered with the helper`);
console.log('platform tests: passed');
