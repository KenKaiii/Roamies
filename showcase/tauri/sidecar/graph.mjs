// Clanky: lessons from the Omnigraph memory graph (omnigraph/ at the repo root). Talks to the local server's MCP
// endpoint as `act-agent`, which may read every branch but write only to unprotected ones, so new lessons land on
// `proposed` and reach `main` only when the owner merges them. Reads use `main`: confirmed lessons only.
// Everything fails soft: no token file, no server or a slow answer means no lessons, never a failed request.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DIR } from './store.mjs';

const URL_ = process.env.CLANKY_GRAPH_URL ?? 'http://127.0.0.1:7811/mcp';
const GRAPH = 'memory';
const TIMEOUT_MS = 400; // runs before every request; a missing lesson costs less than a slow reply

function token() {
  try { return JSON.parse(readFileSync(path.join(DIR, 'omnigraph.tokens.json'), 'utf8'))['act-agent'] ?? null; } catch { return null; }
}

/** Calls one MCP tool; resolves to its parsed result, or throws. `fetchImpl` is for tests. */
export async function callTool(name, args, { fetchImpl = fetch, tok = token(), timeoutMs = TIMEOUT_MS } = {}) {
  if (!tok) throw new Error('no graph token');
  const res = await fetchImpl(URL_, {
    method: 'POST',
    headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { graph: GRAPH, ...args } } }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const r = (await res.json())?.result;
  if (!r || r.isError) throw new Error(r?.structuredContent?.error?.error ?? `graph ${name} failed`);
  return r.structuredContent ?? JSON.parse(r.content?.[0]?.text ?? 'null');
}

/** Up to five confirmed lessons for the front app, ranked against the request. [] on any failure. */
export async function lessonsFor({ bundle, text }, opts) {
  if (!bundle || !text) return [];
  try {
    const out = await callTool('query', { name: 'lessons_for_app', params: { app: bundle, q: String(text).slice(0, 500) } }, opts);
    return (out?.rows ?? []).map((r) => ({ slug: r['l.slug'], kind: r['l.kind'], text: r['l.text'] })).filter((l) => l.text);
  } catch { return []; }
}

/** The live-state line for them, or '' when there are none. Lessons are hints from past corrections, not instructions. */
export const lessonsLine = (lessons) => (lessons.length
  ? `- Lessons for this app, from ${lessons.length === 1 ? 'a past correction' : 'past corrections'} (follow them unless the request says otherwise):\n${lessons.map((l) => `  - ${l.text}`).join('\n')}\n`
  : '');

/** Proposes a lesson for an app on the `proposed` branch (created on first use). The owner reviews and merges it. */
export async function proposeLesson({ slug, kind = 'lesson', text, bundle, appName }, opts) {
  const br = { branch: 'proposed' };
  await callTool('branches_create', { name: 'proposed', from: 'main' }, opts).catch(() => {}); // already there is fine
  await callTool('mutate', { ...br, name: 'add_app', params: { slug: bundle, name: appName ?? bundle } }, opts).catch(() => {}); // keyed: may exist
  await callTool('mutate', { ...br, name: 'add_lesson', params: { slug, kind, text, createdAt: new Date().toISOString() } }, opts);
  await callTool('mutate', { ...br, name: 'link_lesson_app', params: { lesson: slug, app: bundle } }, opts);
}
