// The model-facing tool schemas (lean.mjs): short, but every call is still checked against the full schema.
import assert from 'node:assert/strict';
import { resolveToolSchema } from '@kenkaiiii/gg-ai';
import { createTools } from '../tools.mjs';
import { leanSchema, leanTools, stripNulls } from '../lean.mjs';
import { DrawArgs } from '../draw.mjs';

const n = async () => {};
const tools = createTools({ allowActions: () => false, ui: () => {}, ask: n, openUrl: n, onCommitments: n, showList: n, fmtWhen: String, commitmentsText: () => '', userName: 'T', focus: { start: n, stop: n }, jobs: { changed: n, run: n }, skills: { changed: n, used: n } }).tools;
const full = tools.reduce((s, t) => s + JSON.stringify(resolveToolSchema(t)).length, 0);
leanTools(tools);
const lean = tools.reduce((s, t) => s + JSON.stringify(resolveToolSchema(t)).length, 0);
// Regression: the schemas alone were about 15,600 characters (draw's 10,500) on every request.
assert.ok(lean < full * 0.95, `the schemas the model sees are smaller (${lean} of ${full})`);
const draw = tools.find((t) => t.name === 'draw');
const mark = resolveToolSchema(draw).properties.beats.items.properties.marks.items.properties;
// Draw's schema was about 5,000 tokens on every request: a card's list items are shown only as objects (their fields
// are in the description), and the shapes models then guess are set right before the check.
assert.deepEqual(mark.parts, { type: 'array', items: { type: 'object', additionalProperties: true }, maxItems: 40 }, "a card's list items are only objects (any fields), with their counts");
assert.ok(mark.tie.properties.text, 'places keep their fields (as bare objects Claude tied cards to guessed pixels)');
// 5,700: saying the list items take any fields (#156) costs about 520 characters.
assert.ok(JSON.stringify(resolveToolSchema(draw)).length < 5700, 'draw schema stays short');
assert.deepEqual(mark.points.items, { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }, 'mark fields keep their types and counts');
// Regression: DeepSeek wrote a model's at as {x, y, z} and lost the drawing.
const shaped = DrawArgs.parse({ beats: [{ say: 'x', marks: [
  { kind: 'model', parts: [{ shape: 'box', at: { x: 1, y: 2, z: 3 } }, { shape: 'box', at: { x: 1, y: 2 }, rot: { x: 0, y: 0.5, z: 0 }, motion: { do: 'slide', to: { x: 0, y: 1, z: 0 } } }] },
  { kind: 'graph', x_range: { min: 0, max: 5 }, y_range: [0, 9], plots: [{ points: [{ x: 0, y: 0 }, { x: 1, y: 2 }] }] },
  { kind: 'table', columns: ['a', 'b'], rows: [{ b: 'two', a: 'one' }] },
  { kind: 'list', title: 'L', items: [{ text: 'milk' }, 'eggs'] },
] }] }).beats[0].marks;
assert.deepEqual(shaped[0].parts[0].at, [1, 2, 3]); assert.deepEqual(shaped[0].parts[1].at, [1, 2, 0], 'a flat place gets z = 0'); assert.deepEqual(shaped[0].parts[1].rot, [0, 0.5, 0]); assert.deepEqual(shaped[0].parts[1].motion.to, [0, 1, 0]);
assert.deepEqual(shaped[1].x_range, [0, 5]); assert.deepEqual(shaped[1].plots[0].points, [[0, 0], [1, 2]]);
assert.deepEqual(shaped[2].rows, [['one', 'two']], 'a row keyed by column goes in column order');
assert.deepEqual(shaped[3].items, ['milk', 'eggs']);
// Regression: DeepSeek sent a lone card as the whole call, its lists as JSON text, sizes as {w, h, d}.
const lone = DrawArgs.parse({ kind: 'map', target: 'screen', region: 'Portugal', shade: '[{"name":"Portugal","tone":"teal"}]' });
assert.deepEqual(lone.beats[0].marks[0], { kind: 'map', region: 'Portugal', shade: [{ name: 'Portugal', tone: 'teal' }] }); assert.equal(lone.target, 'screen');
assert.deepEqual(DrawArgs.parse({ beats: [{ say: 'x', marks: [{ kind: 'model', parts: [{ shape: 'box', at: [0, 1], size: { w: 1, h: 2, d: 3 } }] }] }] }).beats[0].marks[0].parts[0], { shape: 'box', at: [0, 1, 0], size: [1, 2, 3] });
assert.equal(DrawArgs.parse({ beats: [{ say: 'x', marks: [{ kind: 'note', text: '[not a list]' }] }] }).beats[0].marks[0].text, '[not a list]', 'words stay words');
assert.deepEqual(DrawArgs.parse({ beats: [{ say: 'x', marks: [{ kind: 'ring', at: { x: 5, y: 6, w: 10, h: 10 } }] }] }).beats[0].marks[0].at, { x: 5, y: 6, w: 10, h: 10 }, 'a place stays a place');
assert.ok(mark.tone.enum.includes('teal'), 'and their choices');
// Each kind's fields are listed in the description, and the full check still takes them.
for (const f of ['heading', 'items', 'nodes', 'links', 'columns', 'rows', 'bars', 'region', 'pins', 'steps', 'vertices', 'questions', 'smiles', 'parts', 'branches', 'events', 'plots'])
  assert.ok(draw.description.includes(`${f} `) || draw.description.includes(`${f}:`) || draw.description.includes(`${f},`) || draw.description.includes(`${f})`), `the description names ${f}`);
const card = { beats: [{ say: 'Here.', marks: [{ kind: 'card', heading: 'Stars', items: ['Hot', 'Big'] }] }] };
assert.deepEqual(draw.parameters.parse(card).beats[0].marks[0].items, ['Hot', 'Big'], 'card fields reach draw');
assert.throws(() => draw.parameters.parse({ beats: [{ say: 'x', marks: [{ kind: 'nope' }] }] }), 'the full check still refuses a bad kind');
assert.throws(() => draw.parameters.parse({ beats: [{ say: 'x'.repeat(300), marks: [] }] }), 'and still enforces the limits');
// Models that send null for a field they leave out still get through, as with every other tool.
assert.deepEqual(stripNulls({ a: null, b: [1, { c: null, d: 2 }] }), { b: [1, { d: 2 }] });
assert.equal(draw.parameters.parse({ ...card, keep: null, edit: null }).keep, undefined);
// The short schema keeps the fields and choices, without the limits.
const s = leanSchema(DrawArgs);
assert.ok(!/"(minLength|maxLength)"/.test(JSON.stringify(s)), 'no length limits'); assert.ok(JSON.stringify(s).includes('"maxItems"'), 'item counts stay');
assert.ok(JSON.stringify(s).includes('"enum"'), 'choices stay');
// Regression: DeepSeek sent a table with text: "" and the whole drawing was refused; an empty field is one left out.
assert.equal(DrawArgs.safeParse({ beats: [{ say: 'x', marks: [{ kind: 'table', text: '', columns: ['a'], rows: [['b']] }] }] }).success, true);
console.log('lean schema tests: passed');
process.exit(0);
