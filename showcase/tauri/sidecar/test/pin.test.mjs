// pin_avatar: the tool that keeps the Roamie in one spot. It saves the pin for the next start and tells the
// overlay where it went. Run: npm test
import assert from 'node:assert/strict';
import { createTools } from '../tools.mjs';

const seen = [];
const saved = [];
const noop = () => {};
const made = createTools({
  allowActions: () => true, ui: (m) => { if (m.kind === 'avatar_pin') seen.push(m); }, ask: async () => true,
  openUrl: noop, onCommitments: noop, showList: noop, fmtWhen: String, commitmentsText: () => '', userName: 'Test',
  saveAvatarPin: (pin) => saved.push(pin),
});
const pin = made.tools.find((t) => t.name === 'pin_avatar');
assert.ok(pin, 'pin_avatar is in the tool list');

const said = await pin.execute({ corner: 'top-right' });
assert.match(said, /top right/);
assert.deepEqual(saved.at(-1), { corner: 'top-right', x: null, y: null, margin: null });
assert.deepEqual(seen.at(-1), { kind: 'avatar_pin', corner: 'top-right', x: null, y: null, margin: null });

await pin.execute({ x: 100.4, y: 220.6, margin: 8 });
assert.deepEqual(saved.at(-1), { corner: null, x: 100, y: 221, margin: 8 });
assert.deepEqual(seen.at(-1), { kind: 'avatar_pin', corner: null, x: 100, y: 221, margin: 8 });

await pin.execute({ release: true });
assert.equal(saved.at(-1), null);
assert.deepEqual(seen.at(-1), { kind: 'avatar_pin', release: true });

await assert.rejects(() => pin.execute({}), /Give a corner/);

console.log('pin tests: ok');
