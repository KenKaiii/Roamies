// Tool schemas every provider accepts. Run: npm test
import assert from 'node:assert/strict';
import { resolveToolSchema } from '@kenkaiiii/gg-ai';
import { createTools } from '../tools.mjs';

const noop = async () => {};
const { tools } = createTools({ allowActions: false, ui: () => {}, ask: async () => false, openUrl: noop, onCommitments: noop, showList: noop, fmtWhen: String, commitmentsText: () => '', userName: 'Test' });

// Regression: fetch_url's url had format "uri", which OpenAI strict schemas reject, failing every OpenAI request.
const formats = [];
const walk = (name, node, at) => {
  if (Array.isArray(node)) return node.forEach((n, i) => walk(name, n, `${at}/${i}`));
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'format') formats.push(`${name}${at}: ${v}`);
    walk(name, v, `${at}/${k}`);
  }
};
for (const t of tools) walk(t.name, resolveToolSchema(t), '');
assert.deepEqual(formats, [], 'no tool uses a string format');
// draw replaced point_at, on every platform (pixels from a screenshot work everywhere).
assert.ok(tools.some((t) => t.name === 'draw') && !tools.some((t) => t.name === 'point_at'), 'draw, not point_at');
const drawSchema = JSON.stringify(resolveToolSchema(tools.find((t) => t.name === 'draw')));
assert.ok(!/"(oneOf|anyOf|allOf)"/.test(drawSchema), 'draw is one flat object schema (no unions some providers reject)');
console.log('tool schema ok');

// act_in_app that only types a web address into a browser's bar becomes a direct open.
{
  const { typedAddress } = await import('../tools.mjs');
  const go = (t) => [{ do: 'type', text: t }, { do: 'key', key: 'return' }];
  assert.equal(typedAddress('Safari', [{ do: 'key', key: 'cmd+l' }, ...go('example.com'), { do: 'wait', seconds: 2 }]), 'example.com');
  assert.equal(typedAddress('Safari', [{ do: 'click_text', text: 'smart search field' }, ...go('example.com')]), 'example.com');
  assert.equal(typedAddress('Google Chrome', [{ do: 'key', key: 'cmd+t' }, ...go('https://bbc.co.uk/news')]), 'https://bbc.co.uk/news');
  assert.equal(typedAddress('browser', [{ do: 'click_text', text: 'New Tab' }, ...go('example.com')]), 'example.com');
  // Not just opening a link: leave it alone.
  assert.equal(typedAddress('TextEdit', [{ do: 'key', key: 'cmd+l' }, ...go('example.com')]), null);
  assert.equal(typedAddress('Safari', [{ do: 'key', key: 'cmd+l' }, ...go('cheap flights to rome')]), null);
  assert.equal(typedAddress('Safari', [{ do: 'click_text', text: 'Search' }, ...go('example.com')]), null);
  assert.equal(typedAddress('Safari', [{ do: 'key', key: 'cmd+l' }, ...go('example.com'), { do: 'click_text', text: 'More information' }]), null);
  assert.equal(typedAddress('Safari', [{ do: 'key', key: 'cmd+l' }, { do: 'type', text: 'example.com' }]), null);
  assert.equal(typedAddress('Safari', [{ do: 'fill', field: 'Email', text: 'a@b.com' }, ...go('example.com')]), null);
  console.log('typed address ok');
}

// Regression: a YouTube search typed into the search box failed and re-ran the old search; the search URL works.
// act_in_app is there on macOS, and elsewhere when the hands helper is (ROAMIES_HANDS).
assert.equal(tools.some((t) => t.name === 'act_in_app'), process.platform === 'darwin' || !!process.env.ROAMIES_HANDS, 'act_in_app follows the helper');
if (process.platform === 'darwin') {
  const actInApp = tools.find((t) => t.name === 'act_in_app').description;
  assert.match(actInApp, /youtube\.com\/results\?search_query=/);
  // ...but when the user asks for the page's own search box, it uses the box.
  assert.match(actInApp, /unless the user asks you to use the box: then fill it/);
}
