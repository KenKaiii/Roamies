// What the model is told about each system, and which features each one gets. Run: npm test
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { canCircle, canSnap, hasHands, hasHotkeys, hasVoice, linuxSession, needsVoiceModel, platformLine, seesPointer } from '../platform.mjs';

const win = platformLine('win32', { arch: 'x64', release: '10.0.22631' });
assert.match(win, /^Platform: Windows 11 on x64\./);
assert.match(win, /Ctrl, not Cmd/, 'Windows keys, not Mac ones');
assert.match(win, /Ctrl\+End and Ctrl\+Home/);
assert.match(win, /cmd\.exe/, 'commands run in cmd, not a Unix shell');
assert.ok(!/Cmd\+Down|BSD/.test(win), 'none of the Mac advice');
assert.match(platformLine('win32', { release: '10.0.19045' }), /^Platform: Windows 10 /);
const mac = platformLine('darwin', { macVersion: '15.1', arch: 'arm64' });
assert.match(mac, /^Platform: macOS 15\.1 on Apple silicon\. Use Mac keys: Cmd, not Ctrl/);
assert.equal(platformLine('freebsd'), 'Platform: freebsd.');

// Linux: PC keys and GNU tools, and on Wayland what the app can't see there.
const x11 = platformLine('linux', { arch: 'x64', session: 'x11', desktop: 'XFCE', distro: 'Linux Mint 22' });
assert.match(x11, /^Platform: Linux \(Linux Mint 22\) on x64, the XFCE desktop on X11\./);
assert.match(x11, /Ctrl, not Cmd/);
assert.match(x11, /Ctrl\+End and Ctrl\+Home/);
assert.match(x11, /bash with the GNU tools/);
assert.ok(!/Cmd\+Down|BSD|cmd\.exe|Wayland/.test(x11), 'none of the Mac or Windows advice, and no Wayland limits on X11');
const wl = platformLine('linux', { arch: 'arm64', session: 'wayland', desktop: 'ubuntu:GNOME', distro: 'Ubuntu 26.04 LTS' });
assert.match(wl, /^Platform: Linux \(Ubuntu 26\.04 LTS\) on Arm, the GNOME desktop on Wayland\./, 'the desktop is the last part of XDG_CURRENT_DESKTOP');
assert.match(wl, /never waits for a click or hover/, 'Wayland: no waiting on what it cannot see');
assert.match(platformLine('linux', {}), /^Platform: Linux on x64, a desktop on Wayland\./, 'not told the session: the careful answer');

// The session: what the app says, else the same signs it reads.
assert.equal(linuxSession({ ROAMIES_SESSION: 'x11', WAYLAND_DISPLAY: 'wayland-0' }), 'x11', 'the app knows best');
assert.equal(linuxSession({ ROAMIES_SESSION: 'wayland' }), 'wayland');
assert.equal(linuxSession({ XDG_SESSION_TYPE: 'wayland' }), 'wayland');
assert.equal(linuxSession({ WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' }), 'wayland');
assert.equal(linuxSession({ XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' }), 'x11');
assert.equal(linuxSession({ ROAMIES_SESSION: 'nonsense' }), 'x11');

// The pointer over other apps and global shortcuts: everywhere but Wayland.
assert.ok(seesPointer('darwin') && seesPointer('win32') && seesPointer('linux', 'x11') && !seesPointer('linux', 'wayland') && !seesPointer('linux', ''));
assert.ok(hasHotkeys('darwin') && hasHotkeys('win32') && hasHotkeys('linux', 'x11') && !hasHotkeys('linux', 'wayland'));
// Voice: Linux has it, with the same downloaded model as Windows.
assert.ok(hasVoice('darwin') && hasVoice('win32') && hasVoice('linux') && !hasVoice('freebsd'));
assert.ok(!needsVoiceModel('darwin') && needsVoiceModel('win32') && needsVoiceModel('linux'));
// No hands helper on Linux yet: nothing reads or works other apps, no area snap, no circling.
assert.ok(!hasHands('linux', '') && !canSnap('linux', '') && !canCircle('linux'));

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
