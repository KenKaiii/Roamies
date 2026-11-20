// Apps for Record (Windows): the open apps to pick from, the processes to hear when only some apps are picked, and a
// best guess of which app was heard when everything is recorded. One fixed PowerShell command lists the processes; the
// names the user picked are only ever compared with its output, never put in a command.
import { execFile } from 'node:child_process';

/** At most this many apps can be picked. */
export const MAX_APPS = 8;
const MAX_PIDS = 16;

/** A picked app is stored by its program name, without ".exe" ("Discord", "chrome"). '' when the name isn't one. */
export function cleanAppName(name) {
  const s = String(name ?? '').trim().replace(/\.exe$/i, '');
  return /^[A-Za-z0-9][\w .()+-]{0,63}$/.test(s) ? s : '';
}

/** Windows parts and Roamies itself: never offered. */
const HIDDEN = new Set(['roamies', 'roamies-voice', 'roamies-hands', 'explorer', 'applicationframehost', 'textinputhost',
  'shellexperiencehost', 'startmenuexperiencehost', 'searchhost', 'lockapp', 'systemsettings']);

/** Lines of "<pid>|<parent pid>|<program>|<window title>" into [{ pid, ppid, name, title }]. */
export function parseProcesses(text) {
  const out = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const [pid, ppid, exe, ...title] = line.split('|');
    const name = cleanAppName(exe);
    if (!name || !/^\d+$/.test(pid ?? '') || !/^\d+$/.test(ppid ?? '')) continue;
    out.push({ pid: Number(pid), ppid: Number(ppid), name, title: title.join('|').replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, 120) });
  }
  return out;
}

const key = (name) => name.toLowerCase();

/** The apps with a window open, one row per program, by name: [{ name, title }]. */
export function openApps(procs) {
  const seen = new Map();
  for (const p of procs) {
    if (!p.title || HIDDEN.has(key(p.name)) || seen.has(key(p.name))) continue;
    seen.set(key(p.name), { name: p.name, title: p.title });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/** The processes to hear for the picked app names: each app's top processes (whose parent is another program), since
 *  hearing a process also hears everything it started. Discord's and Chrome's sound comes from child processes. */
export function rootPids(procs, names) {
  const wanted = new Set(names.map(cleanAppName).filter(Boolean).map(key));
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  return procs
    .filter((p) => wanted.has(key(p.name)) && key(byPid.get(p.ppid)?.name ?? '') !== key(p.name))
    .map((p) => p.pid)
    .slice(0, MAX_PIDS);
}

/** [label, test on "<program>|<window title>"]: call apps first, then calls in a browser tab. */
export const CALL_APPS = [
  ['Discord', /^discord\|/i],
  ['Microsoft Teams', /^(ms-teams|teams)\|/i],
  ['Zoom', /^zoom\|/i],
  ['Skype', /^skype\|/i],
  ['Slack', /^slack\|.*(huddle|call)/i],
  ['WhatsApp', /^whatsapp\|/i],
  ['Telegram', /^telegram\|/i],
  ['Signal', /^signal\|/i],
  ['Google Meet', /\|.*(\bmeet\b.*google|meet\.google)/i],
  ['Zoom (browser)', /\|.*\bzoom\b/i],
  ['Microsoft Teams (browser)', /\|.*\bmicrosoft teams\b/i],
];

/** When everything the PC plays is recorded, which app it probably was: the first call app with a window open. */
export function guessCallApp(procs) {
  const rows = procs.filter((p) => p.title).map((p) => `${p.name}|${p.title}`);
  for (const [label, re] of CALL_APPS) if (rows.some((r) => re.test(r))) return label;
  return 'unknown app';
}

const LIST = '$ErrorActionPreference="SilentlyContinue";$w=@{};Get-Process|Where-Object{$_.MainWindowTitle}|ForEach-Object{$w[$_.Id]=$_.MainWindowTitle};'
  + 'Get-CimInstance Win32_Process|ForEach-Object{"$($_.ProcessId)|$($_.ParentProcessId)|$($_.Name)|$($w[[int]$_.ProcessId])"}';

function runList() {
  if (process.platform !== 'win32') return Promise.resolve('');
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', LIST], { timeout: 10_000, windowsHide: true, maxBuffer: 4 << 20 },
      (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

/** list({ fresh }) -> [{ pid, ppid, name, title }]. Kept for a few seconds unless `fresh`; [] when listing fails. */
export function createProcessLister({ run = runList, now = Date.now, ttl = 5000 } = {}) {
  let cached = null, at = 0;
  return async function list({ fresh = false } = {}) {
    if (cached && !fresh && now() - at < ttl) return cached;
    try { cached = parseProcesses(await run()); } catch { cached = []; }
    at = now();
    return cached;
  };
}
