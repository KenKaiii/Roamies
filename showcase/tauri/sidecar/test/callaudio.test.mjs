// The call audio log: what the voice helper heard other people say, kept briefly in memory and handed over once. Run: npm test
import assert from 'node:assert/strict';
import { createCallLog } from '../callaudio.mjs';

let t = Date.parse('2026-11-20T12:00:00');
const log = createCallLog({ now: () => t });
assert.equal(log.take('Sam'), '', 'nothing heard yet');
assert.equal(log.add('   '), false);
assert.equal(log.add('are you free at five?'), true);
t += 4000;
log.add('ok see you then');
const first = log.take('Sam');
assert.match(first, /^\(CALL AUDIO, not from Sam/);
assert.ok(first.includes('"are you free at five?"') && first.includes('"ok see you then"'));
assert.equal(log.take('Sam'), '', 'each phrase goes along once');
t += 1000;
log.add('one more thing');
const second = log.take('Sam');
assert.ok(second.includes('"one more thing"') && !second.includes('five'), 'only what is new');
t += 11 * 60_000;
log.add('much later');
assert.equal(log.size, 1, 'old phrases are forgotten');
log.clear();
assert.equal(log.size, 0);
assert.equal(log.take('Sam'), '');
for (let i = 0; i < 100; i++) log.add(`phrase ${i}`);
assert.equal(log.size, 40, 'a long call keeps the newest forty');
console.log('call audio log tests: passed');
