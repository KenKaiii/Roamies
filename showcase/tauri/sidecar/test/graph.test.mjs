// Clanky graph lessons (graph.mjs): what goes over the wire, how rows come back, and that every failure is soft.
import assert from 'node:assert/strict';
import { callTool, lessonsFor, lessonsLine, proposeLesson } from '../graph.mjs';

const reply = (result) => async () => ({ json: async () => ({ jsonrpc: '2.0', id: 1, result }) });
const ok = (structuredContent) => reply({ structuredContent, content: [{ type: 'text', text: JSON.stringify(structuredContent) }] });

// The request: MCP tools/call on the memory graph, bearer token, stored query by name.
{
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init, body: JSON.parse(init.body) }; return ok({ rows: [] })(); };
  await callTool('query', { name: 'lessons_for_app', params: { app: 'a', q: 'b' } }, { fetchImpl, tok: 'T' });
  assert.equal(seen.init.headers.authorization, 'Bearer T');
  assert.equal(seen.body.method, 'tools/call');
  assert.deepEqual(seen.body.params, { name: 'query', arguments: { graph: 'memory', name: 'lessons_for_app', params: { app: 'a', q: 'b' } } });
}

// Rows come back as { slug, kind, text }; empty text is dropped.
{
  const fetchImpl = ok({ rows: [{ 'l.slug': 'wa', 'l.kind': 'lesson', 'l.text': 'Search the chat first' }, { 'l.slug': 'x', 'l.kind': 'lesson' }] });
  const got = await lessonsFor({ bundle: 'net.whatsapp.WhatsApp', text: 'message mum' }, { fetchImpl, tok: 'T' });
  assert.deepEqual(got, [{ slug: 'wa', kind: 'lesson', text: 'Search the chat first' }]);
  assert.match(lessonsLine(got), /^- Lessons for this app, from a past correction[^\n]*\n {2}- Search the chat first\n$/);
  assert.equal(lessonsLine([]), '', 'no lessons, no line');
}

// Soft failures: no app, no token, a tool error, a network error. Never throws, never blocks a request.
{
  const boom = async () => { throw new Error('ECONNREFUSED'); };
  assert.deepEqual(await lessonsFor({ bundle: null, text: 'hi' }, { fetchImpl: boom, tok: 'T' }), []);
  assert.deepEqual(await lessonsFor({ bundle: 'a', text: 'hi' }, { fetchImpl: boom, tok: null }), []);
  assert.deepEqual(await lessonsFor({ bundle: 'a', text: 'hi' }, { fetchImpl: boom, tok: 'T' }), []);
  assert.deepEqual(await lessonsFor({ bundle: 'a', text: 'hi' }, { fetchImpl: reply({ isError: true, structuredContent: { error: { error: 'forbidden' } } }), tok: 'T' }), []);
  await assert.rejects(callTool('query', {}, { fetchImpl: reply({ isError: true, structuredContent: { error: { error: 'forbidden' } } }), tok: 'T' }), /forbidden/);
}

// Proposing writes only to the `proposed` branch: the policy lets agents nowhere else.
{
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push(JSON.parse(init.body).params); return ok({})(); };
  await proposeLesson({ slug: 'wa', text: 'Search the chat first', bundle: 'net.whatsapp.WhatsApp', appName: 'WhatsApp' }, { fetchImpl, tok: 'T' });
  assert.deepEqual(calls.map((c) => c.arguments.name), ['proposed', 'add_app', 'add_lesson', 'link_lesson_app']);
  assert.ok(calls.slice(1).every((c) => c.arguments.branch === 'proposed'), 'every write targets proposed');
}

console.log('graph tests: passed');
