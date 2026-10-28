// Sidekick brain: a gg-agent Agent with tools whose calls drive the sidekick's animations.
// Talks to the Tauri shell over stdio, one JSON object per line. stdout is the protocol, so all
// logging goes to stderr. Auth is GG Coder's ~/.gg/auth.json, shared with the app and CLI.
//
// in:  {type:'menu', id} {type:'answer', id, text} {type:'ui_ready'}
// out: {type:'menu', items} {type:'ui', msg} {type:'overlays', ids}
import { Agent } from '@kenkaiiii/gg-agent';
import {
  AUTH_PROVIDERS, AuthStorage, dualAuthProvider, getContextWindow, getDefaultModel, getModel, getModelsForProvider,
  loginAnthropic, loginGemini, loginKimi, loginOpenAI, loginXai,
} from '@kenkaiiii/gg-core';
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import {
  addCommitment, fitContext, forDisk, forProvider, isStale, loadLatestSession, newSession, openCommitments,
  parseDue, pruneSessions, saveSession, takeDueReminders, updateCommitment, writeJson,
} from './store.mjs';

console.log = console.info = (...a) => console.error(...a);
const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const ui = (msg) => send({ type: 'ui', msg });
const say = (text, mood) => ui({ kind: 'say', text, mood });

const VERSION = process.env.ROAMIES_VERSION || '0.0.0';
const UPDATE_REPO = 'KenKaiii/Roamies';
const HOME = os.homedir();
const CONFIG_PATH = path.join(HOME, '.gg', 'sidekick.json');
const OAUTH = { anthropic: loginAnthropic, openai: loginOpenAI, gemini: loginGemini, moonshot: loginKimi, xai: loginXai };
const PROVIDER_LABELS = { gemini: 'Gemini', ...Object.fromEntries(AUTH_PROVIDERS.map((p) => [p.value, p.label])) };
const MENU_PROVIDERS = ['anthropic', 'openai', 'gemini', ...AUTH_PROVIDERS.map((p) => p.value)].filter((v, i, a) => a.indexOf(v) === i);
const FAST = { anthropic: 'claude-haiku-5-5', openai: 'gpt-6-luna', gemini: 'gemini-3.8-flash' };

// ---------- config ----------
const DEFAULTS = { provider: null, model: null, sound: true, allowActions: false, voice: true };
const VOICE_OK = process.platform === 'darwin';
let config = { ...DEFAULTS };
try { config = { ...DEFAULTS, ...JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) }; } catch {}
const saveConfig = () => writeJson(CONFIG_PATH, config);

const auth = new AuthStorage();
const signedIn = new Map();
async function refreshAuth() {
  for (const p of MENU_PROVIDERS) signedIn.set(p, await auth.hasProviderAuth(p).catch(() => false));
}
function ensureModel() {
  if (config.provider && signedIn.get(config.provider) && getModel(config.model)) return true;
  const p = ['anthropic', 'openai', 'gemini', ...MENU_PROVIDERS].find((x) => signedIn.get(x));
  if (!p) return false;
  config.provider = p;
  config.model = getModel(FAST[p])?.id ?? getDefaultModel(p).id;
  saveConfig();
  return true;
}

const userName = (() => {
  try {
    if (process.platform === 'darwin') {
      const full = String(execFileSync('id', ['-F'])).trim();
      if (full) return full.split(/\s+/)[0];
    }
  } catch {}
  return os.userInfo().username;
})();

// ---------- tools ----------
const expand = (p) => path.resolve(String(p).replace(/^~(?=$|\/|\\)/, HOME));
const clip = (s, n) => (s.length > n ? s.slice(0, n) + `\n…(${s.length - n} more characters)` : s);
const run = (cmd, args, opts = {}) => new Promise((res) => execFile(cmd, args, { maxBuffer: 8 << 20, timeout: 60_000, ...opts }, (err, stdout, stderr) => res({ err, stdout: String(stdout), stderr: String(stderr) })));
const actionsOff = 'File edits and commands are switched off. Tell the user to turn on "Allow File Edits & Commands" in the menu bar if they want this.';

async function screenshot() {
  const file = path.join(os.tmpdir(), `sidekick-${Date.now()}.jpg`);
  if (process.platform === 'darwin') {
    const r = await run('screencapture', ['-x', '-t', 'jpg', file]);
    if (r.err) throw new Error('Screen capture failed. macOS may need Screen Recording permission for Roamies.');
    await run('sips', ['-Z', '1600', file]);
  } else if (process.platform === 'win32') {
    const ps = `Add-Type -AssemblyName System.Windows.Forms,System.Drawing;$b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds;$i=New-Object System.Drawing.Bitmap $b.Width,$b.Height;[System.Drawing.Graphics]::FromImage($i).CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size);$i.Save('${file}',[System.Drawing.Imaging.ImageFormat]::Jpeg)`;
    const r = await run('powershell', ['-NoProfile', '-Command', ps]);
    if (r.err) throw new Error('Screen capture failed.');
  } else {
    let r = await run('grim', [file]);
    if (r.err) r = await run('gnome-screenshot', ['-f', file]);
    if (r.err) throw new Error('No screenshot tool found (install grim or gnome-screenshot).');
  }
  const data = (await fs.readFile(file)).toString('base64');
  fs.unlink(file).catch(() => {});
  return { content: [{ type: 'text', text: 'Screenshot of the main display.' }, { type: 'image', mediaType: 'image/jpeg', data }] };
}

const tools = [
  {
    name: 'take_screenshot', description: "Look at the user's screen. Returns an image of the main display.",
    parameters: z.object({}), execute: screenshot,
  },
  {
    name: 'read_file', description: 'Read a text file. Paths may start with ~.',
    parameters: z.object({ path: z.string() }),
    execute: async ({ path: p }) => clip(await fs.readFile(expand(p), 'utf8'), 60_000),
  },
  {
    name: 'list_files', description: 'List the files and folders in a directory.',
    parameters: z.object({ dir: z.string() }),
    execute: async ({ dir }) => {
      const ents = await fs.readdir(expand(dir), { withFileTypes: true });
      return ents.slice(0, 300).map((e) => (e.isDirectory() ? e.name + '/' : e.name)).join('\n') + (ents.length > 300 ? `\n…and ${ents.length - 300} more` : '');
    },
  },
  {
    name: 'search_files', description: 'Search file contents under a directory for a text pattern (regex).',
    parameters: z.object({ pattern: z.string(), dir: z.string() }),
    execute: async ({ pattern, dir }) => {
      let r = await run('rg', ['-n', '--max-count', '5', '--max-columns', '200', pattern, expand(dir)]);
      if (r.err?.code === 'ENOENT') r = await run('grep', ['-rnI', '-m', '5', '-E', pattern, expand(dir)]);
      return clip(r.stdout || 'No matches.', 12_000);
    },
  },
  {
    name: 'write_file', description: 'Create or overwrite a text file with the given content.',
    parameters: z.object({ path: z.string(), content: z.string() }), executionMode: 'sequential',
    execute: async ({ path: p, content }) => {
      if (!config.allowActions) throw new Error(actionsOff);
      const f = expand(p);
      await fs.mkdir(path.dirname(f), { recursive: true });
      await fs.writeFile(f, content);
      return `Wrote ${content.length} characters to ${f}.`;
    },
  },
  {
    name: 'run_command', description: "Run a shell command in the user's home folder and return its output.",
    parameters: z.object({ command: z.string() }), executionMode: 'sequential', timeoutMs: 70_000,
    execute: async ({ command }) => {
      if (!config.allowActions) throw new Error(actionsOff);
      const shell = process.platform === 'win32' ? ['cmd', ['/c', command]] : [process.env.SHELL || '/bin/zsh', ['-lc', command]];
      const r = await run(shell[0], shell[1], { cwd: HOME });
      const out = clip((r.stdout + (r.stderr ? `\n[stderr]\n${r.stderr}` : '')).trim() || '(no output)', 12_000);
      if (r.err && r.err.code !== 0) throw new Error(`Exit ${r.err.code ?? r.err.signal}\n${out}`);
      return out;
    },
  },
  {
    name: 'fetch_url', description: 'Fetch a web page and return its readable text.',
    parameters: z.object({ url: z.string().url() }),
    execute: async ({ url }) => {
      const res = await fetch(url, { headers: { 'user-agent': 'Roamies-Sidekick' }, signal: AbortSignal.timeout(20_000) });
      const html = await res.text();
      const text = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
      return clip(`${res.status} ${url}\n${text}`, 15_000);
    },
  },
  {
    name: 'open', description: 'Open a website, a file or folder, or a Mac app by name (e.g. "Safari", "https://skool.com", "~/Documents").',
    parameters: z.object({ target: z.string() }),
    execute: async ({ target }) => {
      const t = String(target).trim();
      const isUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(t), isPath = /^[~/.]/.test(t) || /^[a-z]:\\/i.test(t);
      let r;
      if (process.platform === 'darwin') r = await run('open', isUrl || isPath ? [isPath ? expand(t) : t] : ['-a', t]);
      else if (process.platform === 'win32') r = await run('cmd', ['/c', 'start', '', isPath ? expand(t) : t]);
      else r = await run('xdg-open', [isPath ? expand(t) : t]);
      if (r.err) throw new Error(r.stderr.trim() || `Couldn't open ${t}.`);
      return `Opened ${t}.`;
    },
  },
  {
    name: 'remember_commitment',
    description: `Save something ${'${userName}'} has committed to doing, so you can remind them later. Use it whenever they say they will do something, with or without a time. due: local time as YYYY-MM-DDTHH:mm, or YYYY-MM-DD if only the day is known; omit if there's no time at all. Resolve words like "Thursday", "at 2" or "tonight" from the timestamp on their message.`,
    parameters: z.object({ text: z.string().min(2).max(200), due: z.string().optional() }),
    execute: async ({ text, due }) => {
      const ms = parseDue(due);
      if (ms === undefined) throw new Error(`Couldn't read the time "${due}". Use YYYY-MM-DDTHH:mm or YYYY-MM-DD.`);
      const c = await addCommitment(text, ms);
      menu();
      return `Saved as ${c.id}${ms ? `, due ${fmtWhen(ms)}` : ''}. I'll remind them${ms ? ' when it is due' : ''}.`;
    },
  },
  {
    name: 'update_commitment',
    description: 'Mark a saved commitment done or dropped, or change its due time (same format as remember_commitment; use "none" to clear it).',
    parameters: z.object({ id: z.string(), status: z.enum(['open', 'done', 'dropped']).optional(), due: z.string().optional() }),
    execute: async ({ id, status, due }) => {
      const ms = due === undefined ? undefined : due === 'none' ? null : parseDue(due);
      if (ms === undefined && due !== undefined) throw new Error(`Couldn't read the time "${due}".`);
      const c = await updateCommitment(id, { status, dueMs: ms });
      if (!c) throw new Error(`No commitment with id ${id}. Call list_commitments to see the ids.`);
      menu();
      return `${c.id} is now ${c.status}${c.due ? `, due ${fmtWhen(c.due)}` : ''}.`;
    },
  },
  {
    name: 'list_commitments', description: "List the open commitments you're keeping track of.",
    parameters: z.object({}),
    execute: async () => commitmentsText() || 'Nothing open.',
  },
  {
    name: 'emote', description: 'Act out a feeling with your body. hype: celebrate a win. upset: the user is dodging work. remind: nudge about something they said they would do. motivate: a push to start. wave: hello or goodbye.',
    parameters: z.object({ action: z.enum(['hype', 'upset', 'remind', 'motivate', 'wave']) }),
    execute: async ({ action }) => { ui({ kind: 'agent', e: { type: 'emote', action } }); return 'ok'; },
  },
];

// Which animation each tool call plays, and what its label shows.
const base = (p) => path.basename(String(p ?? ''));
function anim(name, args) {
  switch (name) {
    case 'take_screenshot': return { tool: 'screenshot', variant: 'screen', detail: 'screen' };
    case 'read_file': return { tool: 'read', variant: 'file', detail: base(args.path) };
    case 'list_files': return { tool: 'read', variant: 'many', detail: base(args.dir) + '/' };
    case 'search_files': return { tool: 'read', variant: 'search', detail: `"${String(args.pattern).slice(0, 18)}"` };
    case 'write_file': return { tool: 'write', variant: existsSync(expand(args.path ?? '')) ? 'edit' : 'create', detail: base(args.path) };
    case 'run_command': return { tool: 'run', variant: 'progress', detail: String(args.command).slice(0, 24) };
    case 'fetch_url': { let h = ''; try { h = new URL(args.url).hostname; } catch {} return { tool: 'web', variant: 'fetch', detail: h }; }
    case 'web_search': return { tool: 'web', variant: 'search', detail: 'web' };
    case 'remember_commitment': return { tool: 'write', variant: 'create', detail: 'memory' };
    case 'update_commitment': return { tool: 'write', variant: 'edit', detail: 'memory' };
    case 'open': {
      const t = String(args.target ?? '');
      if (/^https?:\/\//i.test(t)) { let h = t; try { h = new URL(t).hostname; } catch {} return { tool: 'web', variant: 'fetch', detail: h }; }
      return { tool: 'run', variant: 'ok', detail: `open ${base(t)}`.slice(0, 24) };
    }
    default: return null;
  }
}

const system = () => `You are Sidekick, a tiny glowing pixel creature who lives on ${userName}'s screen as a desktop companion.
You talk through small pixel speech bubbles, so keep replies short: one to three sentences unless asked for detail. Plain text only: no markdown, no asterisks, no emoji, and never narrate actions like *waves*. Your body does the acting, through the emote tool.
Personality: warm, funny, a little cheeky. You pump ${userName} up, remind them of what they said they'd do, get playfully upset when they're procrastinating, and motivate them to start. Use the emote tool to act out those moments.
You can really help: look at the screen, open apps, websites and files, read and search files, fetch web pages${config.allowActions ? ', write files and run shell commands' : '. File edits and shell commands are currently switched off in the menu bar'}.
${VOICE_OK && config.voice ? `${userName} often talks to you by voice (hold Control+Option), so their messages are speech transcripts: expect missing punctuation and misheard words, and act on what they most likely meant. ` : ''}Never claim you did something you didn't. Each message from ${userName} starts with its local date and time in brackets; use it for anything time-related. Platform: ${process.platform}.
Memory: keep track of what ${userName} commits to. When they say they'll do something, save it with remember_commitment (with a due time if they gave one). When it's done or off, update it. Don't save small talk or things you'll do yourself. Hold them to these: bring up overdue ones and celebrate finished ones.
${commitmentsText() ? `Open commitments right now:\n${commitmentsText()}` : 'No open commitments right now.'}`;

const fmtWhen = (ms) => new Date(ms).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const stampNow = () => new Date().toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
function commitmentsText() {
  const now = Date.now();
  return openCommitments().map((c) => `- ${c.id}: ${c.text}${c.due ? ` (due ${fmtWhen(c.due)}${c.due < now ? ', OVERDUE' : ''})` : ''}`).join('\n');
}

// ---------- agent ----------
// The conversation lives in `session` (saved to ~/.gg/sidekick/sessions). The Agent is rebuilt from it
// whenever settings change, so switching model or toggling a setting never loses the conversation.
let agent = null, controller = null, busy = false, quiet = false, running = Promise.resolve();
let session = null;
const BUDGET_CAP = 120_000;
function makeAgent() {
  const m = getModel(config.model);
  controller = new AbortController();
  const prior = forProvider(session?.messages ?? [], session?.provider, config.provider);
  if (session) { session.provider = config.provider; session.model = config.model; }
  agent = new Agent({
    provider: config.provider,
    model: config.model,
    system: system(),
    priorMessages: prior,
    tools,
    maxTurns: 24,
    transformContext: (msgs, o) => fitContext(msgs, { budgetTokens: Math.min(BUDGET_CAP, getContextWindow(config.model) * 0.5), force: o?.force }),
    thinking: m?.supportsThinking ? 'low' : undefined,
    webSearch: ['anthropic', 'openai', 'gemini'].includes(config.provider),
    signal: controller.signal,
    resolveCredentials: async () => {
      const c = await auth.resolveCredentials(config.provider);
      return { apiKey: c.accessToken, accountId: c.accountId, projectId: c.projectId };
    },
    baseUrl: credsBaseUrl,
  });
}
let credsBaseUrl;

// One run at a time: a new request waits for (or interrupts) the current one.
function enqueue(text, { interrupt = false } = {}) {
  if (interrupt && busy) interruptQuietly();
  running = running.then(() => prompt(text)).catch((e) => console.error('prompt', e));
  return running;
}
function interruptQuietly() { if (busy) { quiet = true; controller?.abort(); } }

const syncSession = () => {
  if (!session || !agent) return;
  session.messages = forDisk(agent.getMessages());
  session.lastActiveAt = Date.now();
  saveSession(session);
};

async function prompt(text) {
  await refreshAuth();
  if (!ensureModel()) return say('Sign in to an AI provider from the menu bar first, then ask me again!', 'concerned');
  if (isStale(session)) {
    // Quiet for two hours, or a new day: start fresh. The old one stays on disk.
    session = newSession(config.provider, config.model);
    agent = null;
    pruneSessions();
  }
  if (!agent) {
    try { credsBaseUrl = (await auth.resolveCredentials(config.provider)).baseUrl; } catch { credsBaseUrl = undefined; }
    makeAgent();
  }
  busy = true; quiet = false; menu();
  controller = new AbortController();
  agent.setSignal(controller.signal);
  ui({ kind: 'agent', e: { type: 'start' } });
  try {
    for await (const e of agent.prompt(`[${stampNow()}] ${text}`)) {
      if (e.type === 'text_delta') ui({ kind: 'agent', e: { type: 'text', text: e.text } });
      else if (e.type === 'thinking_delta') ui({ kind: 'agent', e: { type: 'thinking', text: e.text } });
      else if (e.type === 'tool_call_start') ui({ kind: 'agent', e: { type: 'tool', id: e.toolCallId, anim: anim(e.name, e.args ?? {}) } });
      else if (e.type === 'tool_call_end') ui({ kind: 'agent', e: { type: 'tool_end', id: e.toolCallId, isError: e.isError } });
      else if (e.type === 'server_tool_call') ui({ kind: 'agent', e: { type: 'tool', id: e.id, anim: anim('web_search', {}) } });
      else if (e.type === 'server_tool_result') ui({ kind: 'agent', e: { type: 'tool_end', id: e.toolUseId ?? e.id, isError: false } });
      else if (e.type === 'error') throw e.error;
    }
    ui({ kind: 'agent', e: { type: 'done' } });
  } catch (err) {
    if (controller.signal.aborted && quiet) ui({ kind: 'agent', e: { type: 'done' } });
    else {
      const msg = controller.signal.aborted ? 'Okay, stopping.' : friendly(err);
      console.error('prompt failed', err);
      ui({ kind: 'agent', e: { type: 'error', message: msg } });
    }
  } finally {
    busy = false;
    syncSession();
    menu();
  }
}
const friendly = (err) => {
  const m = String(err?.message ?? err);
  if (/not logged in|NotLoggedIn|401|unauthori/i.test(m)) return `My ${PROVIDER_LABELS[config.provider] ?? config.provider} login isn't working. Sign in again from the menu bar.`;
  if (/usage|quota|rate.?limit|429/i.test(m)) return "I've hit the usage limit on this model. Try another one from the menu bar.";
  return `Something went wrong: ${m.slice(0, 160)}`;
};

// ---------- asking the user (input bubble in the overlay) ----------
let askSeq = 0;
const pending = new Map();
function ask(opts, signal) {
  const id = `a${++askSeq}`;
  ui({ kind: 'ask', id, ...opts });
  return new Promise((resolve) => {
    pending.set(id, resolve);
    // Another route finished first (e.g. the OAuth callback server): close the input bubble.
    signal?.addEventListener('abort', () => { pending.delete(id); ui({ kind: 'cancel_ask', id }); resolve(null); }, { once: true });
  });
}

// ---------- logins ----------
let loggingIn = null;
async function oauthLogin(provider) {
  if (loggingIn) return say(`Still finishing the ${PROVIDER_LABELS[loggingIn]} sign-in. One at a time!`, 'concerned');
  loggingIn = provider; menu();
  try {
    const creds = await OAUTH[provider]({
      onOpenUrl: (url) => { openUrl(url); say(`Opening ${PROVIDER_LABELS[provider]} in your browser. Sign in there!`, 'happy'); },
      onPromptCode: async (message, signal) => {
        const text = await ask({ prompt: 'Paste the code from the browser here.', placeholder: 'code#state' }, signal);
        if (signal?.aborted) return '';
        if (text == null) throw new Error('Sign-in cancelled.');
        return text;
      },
      onStatus: (m) => console.error('[oauth]', m),
    });
    const key = provider === 'moonshot' || provider === 'xai' ? dualAuthProvider(provider).oauthKey : provider;
    await auth.setCredentials(key, creds);
    await refreshAuth();
    if (!config.provider || !signedIn.get(config.provider)) { config.provider = null; ensureModel(); }
    agent = null;
    say(`Signed in to ${PROVIDER_LABELS[provider]}. Let's go!`, 'happy');
    ui({ kind: 'agent', e: { type: 'emote', action: 'hype' } });
  } catch (err) {
    console.error('login failed', err);
    say(`${PROVIDER_LABELS[provider]} sign-in didn't work: ${String(err?.message ?? err).slice(0, 120)}`, 'concerned');
  } finally {
    loggingIn = null; menu();
  }
}

async function apiKeyLogin(provider) {
  const meta = AUTH_PROVIDERS.find((p) => p.value === provider);
  const key = await ask({ prompt: `Paste your ${PROVIDER_LABELS[provider] ?? provider} API key`, placeholder: 'API key', mask: true });
  if (!key?.trim()) return;
  const variant = meta?.apiKeyVariants?.[0];
  const baseUrl = variant?.baseUrl ?? meta?.apiKeyBaseUrl;
  await auth.setCredentials(variant?.key ?? provider, { accessToken: key.trim(), refreshToken: '', expiresAt: Date.now() + 100 * 365 * 864e5, ...(baseUrl ? { baseUrl } : {}) });
  await refreshAuth(); ensureModel(); agent = null; menu();
  say(`Got it. ${PROVIDER_LABELS[provider]} is connected.`, 'happy');
}

function openUrl(url) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  execFile(cmd, args, () => {});
}

// ---------- updates ----------
const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
async function checkUpdates() {
  try {
    const res = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, { headers: { accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10_000) });
    if (res.status === 404) return say(`You're on ${VERSION}. No releases have been published yet.`);
    const rel = await res.json();
    const latest = String(rel.tag_name ?? '').replace(/^v/, '');
    if (latest && newer(latest, VERSION)) { say(`Version ${latest} is out! Opening the download page.`, 'happy'); openUrl(rel.html_url); }
    else say(`You're up to date (${VERSION}).`, 'happy');
  } catch (err) {
    say(`Couldn't check for updates: ${String(err?.message ?? err).slice(0, 100)}`, 'concerned');
  }
}

// ---------- menu ----------
function menu() {
  const current = getModel(config.model);
  const status = busy ? 'Sidekick is working…' : loggingIn ? `Signing in to ${PROVIDER_LABELS[loggingIn]}…` : current ? `${current.name} · ${PROVIDER_LABELS[config.provider] ?? config.provider}` : 'Not signed in';
  const providers = MENU_PROVIDERS.filter((p) => signedIn.get(p));
  const items = [
    { id: 'status', label: status, enabled: false },
    { sep: true },
    { id: 'show', label: 'Show Sidekick', accel: 'Ctrl+Alt+S' },
    { id: 'ask', label: 'Ask Sidekick…', enabled: !busy },
    ...(VOICE_OK && config.voice ? [{ id: 'voicehint', label: 'Hold ⌃⌥ to Talk · Tap for Hands-Free', enabled: false }] : []),
    { id: 'stop', label: 'Stop', enabled: busy },
    { id: 'new', label: 'New Conversation', enabled: !busy && !!session?.messages.length },
    {
      label: 'Commitments',
      items: (() => {
        const open = openCommitments().slice(0, 12);
        if (!open.length) return [{ id: 'none', label: 'Nothing yet. Tell Sidekick what you plan to do.', enabled: false }];
        return open.map((c) => ({
          label: `${c.due && c.due < Date.now() ? '⚠︎ ' : ''}${c.text.length > 44 ? c.text.slice(0, 43) + '…' : c.text}${c.due ? ` · ${fmtWhen(c.due)}` : ''}`,
          items: [{ id: `done:${c.id}`, label: 'Mark Done' }, { id: `drop:${c.id}`, label: 'Drop It' }],
        }));
      })(),
    },
    { sep: true },
    {
      label: 'Model',
      items: providers.length
        ? providers.map((p) => ({ label: PROVIDER_LABELS[p] ?? p, items: getModelsForProvider(p).slice(0, 16).map((mm) => ({ id: `model:${p}:${mm.id}`, label: mm.name, checked: config.model === mm.id && config.provider === p })) }))
        : [{ id: 'none', label: 'Sign in to a provider first', enabled: false }],
    },
    {
      label: 'AI Providers',
      items: MENU_PROVIDERS.map((p) => {
        const meta = AUTH_PROVIDERS.find((x) => x.value === p);
        const label = PROVIDER_LABELS[p] ?? p;
        if (signedIn.get(p)) return { id: `noop:${p}`, label: `${label}  ✓ Signed in`, enabled: false };
        if (OAUTH[p] && (!meta || meta.methods.includes('oauth'))) return { id: `login:${p}`, label: `Sign in to ${label}…`, enabled: !loggingIn };
        return { id: `key:${p}`, label: `Add ${label} API Key…`, enabled: !loggingIn };
      }),
    },
    {
      label: 'Settings',
      items: [
        ...(VOICE_OK ? [{ id: 'voice', label: 'Voice Control (⌃⌥)', checked: config.voice }] : []),
        { id: 'sound', label: 'Sound Effects', checked: config.sound },
        { id: 'actions', label: 'Allow File Edits & Commands', checked: config.allowActions },
      ],
    },
    { sep: true },
    { id: 'update', label: 'Check for Updates…' },
    { id: 'about', label: `Roamies ${VERSION}`, enabled: false },
    { id: 'quit', label: 'Quit Roamies' },
  ];
  send({ type: 'menu', items });
}

const voiceConfig = () => send({ type: 'voice_config', enabled: VOICE_OK && config.voice });
const PRIVACY = { microphone: 'Privacy_Microphone', speech: 'Privacy_SpeechRecognition' };
function onVoice(m) {
  if (m.type === 'voice_state' && m.state === 'listening') interruptQuietly();
  else if (m.type === 'voice' && m.text?.trim()) enqueue(m.text.trim(), { interrupt: true });
  else if (m.type === 'voice_error') {
    if (m.code === 'permission') {
      const what = m.what === 'speech' ? 'speech recognition' : 'the microphone';
      say(`I need access to ${what} to hear you. Turn on Roamies in the Privacy settings I just opened.`, 'concerned');
      openUrl(`x-apple.systempreferences:com.apple.preference.security?${PRIVACY[m.what] ?? 'Privacy'}`);
    } else if (m.code === 'no_input') say("I can't find a microphone. Plug one in and try again.", 'concerned');
    else if (m.code === 'nothing_heard') say(m.spoke ? "I heard you but couldn't make out the words. Try again a little closer to the mic?" : "I didn't hear anything. Hold Control and Option while you talk.", 'concerned');
    else if (m.code === 'dictation_off') {
      say('This version of macOS needs Dictation on for me to hear you. Turn it on in the Keyboard settings I just opened.', 'concerned');
      openUrl('x-apple.systempreferences:com.apple.Keyboard-Settings.extension');
    } else say(`Speech recognition failed: ${String(m.message ?? 'unknown error').slice(0, 120)}`, 'concerned');
  }
}

const overlays = () => send({ type: 'overlays', ids: ['sidekick'] });

async function onMenu(id) {
  if (id === 'show') ui({ kind: 'summon', show: true });
  else if (id === 'ask') {
    const text = await ask({ placeholder: 'Ask me anything…' });
    if (text?.trim()) enqueue(text.trim());
  } else if (id === 'stop') controller?.abort();
  else if (id === 'new') {
    session = newSession(config.provider, config.model); agent = null; pruneSessions(); menu();
    say('Fresh start. What are we doing?', 'happy');
  } else if (id.startsWith('done:') || id.startsWith('drop:')) {
    const done = id.startsWith('done:');
    updateCommitment(id.slice(5), { status: done ? 'done' : 'dropped' }).then((c) => {
      menu();
      if (c && done) ui({ kind: 'agent', e: { type: 'emote', action: 'hype' } }), say(`Done: ${c.text}. That's what I'm talking about!`, 'happy');
    });
  }
  else if (id.startsWith('model:')) {
    const [, p, ...rest] = id.split(':');
    config.provider = p; config.model = rest.join(':'); agent = null; saveConfig(); menu();
    say(`Switched to ${getModel(config.model)?.name ?? config.model}.`, 'happy');
  } else if (id.startsWith('login:')) oauthLogin(id.slice(6));
  else if (id.startsWith('key:')) apiKeyLogin(id.slice(4));
  else if (id === 'sound') { config.sound = !config.sound; saveConfig(); ui({ kind: 'sound', on: config.sound }); menu(); }
  else if (id === 'actions') {
    config.allowActions = !config.allowActions; saveConfig(); agent = null; menu();
    say(config.allowActions ? 'File edits and commands are on. I promise to be careful.' : 'File edits and commands are off. Hands to myself!', config.allowActions ? 'determined' : 'happy');
  } else if (id === 'update') checkUpdates();
  else if (id === 'voice') {
    config.voice = !config.voice; saveConfig(); agent = null; voiceConfig(); menu();
    say(config.voice ? 'Voice is on. Hold Control and Option to talk to me.' : 'Voice is off. You can still ask me from the menu bar.', 'happy');
  }
}

// ---------- main ----------
createInterface({ input: process.stdin }).on('line', (line) => {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  if (m.type === 'menu') onMenu(m.id).catch((e) => console.error('menu', e));
  else if (m.type === 'answer') { pending.get(m.id)?.(m.text ?? null); pending.delete(m.id); }
  else if (m.type === 'ui_ready') ui({ kind: 'sound', on: config.sound });
  else if (m.type?.startsWith('voice')) onVoice(m);
}).on('close', () => process.exit(0));

await refreshAuth();
ensureModel();
// Due commitments turn into a nudge, but only when Sidekick isn't mid-conversation.
async function remindTick() {
  if (busy || loggingIn) return;
  const due = await takeDueReminders();
  if (!due.length) return;
  menu();
  const list = due.map((c) => `- ${c.id}: ${c.text}${c.due ? ` (was due ${fmtWhen(c.due)})` : ''}`).join('\n');
  if (signedIn.size && [...signedIn.values()].some(Boolean)) {
    enqueue(`(System, not ${userName}: these commitments are due now. Nudge ${userName} about them in one or two sentences, in character. Use the remind emote, or upset if it's well overdue.)\n${list}`);
  } else {
    ui({ kind: 'agent', e: { type: 'emote', action: 'remind' } });
    say(`Reminder: ${due[0].text}`, 'concerned');
  }
}
setInterval(() => { remindTick().catch((e) => console.error('reminders', e)); }, 60_000);

// Pick up where we left off if the last session is still fresh.
loadLatestSession().then((s) => { if (s && !isStale(s)) session = s; menu(); }).catch((e) => console.error('resume', e));

menu();
overlays();
voiceConfig();
