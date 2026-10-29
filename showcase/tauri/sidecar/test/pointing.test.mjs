// Screenshot pixels → screen points for point_at / click_at. Run: npm test
import assert from 'node:assert/strict';
import { shotMap, toScreen, parseSipsSize } from '../pointing.mjs';

// Regression: an 1800×1066 pt Brave window at (0, 39) is captured at 3600 px and capped to 1568 px wide.
// Image pixels used to be treated as points, so points landed up and left of the target.
const brave = shotMap([0, 39, 1800, 1066], 1568, 929);
assert.deepEqual(toScreen(brave, 1026, 531), [1178, 648], 'scales up and adds the window origin');
assert.deepEqual(toScreen(brave, 0, 0), [0, 39], 'image corner is the window corner');
assert.deepEqual(toScreen(brave, 1568, 929), [1800, 1105], 'far corner is the far window corner');

// A small window isn't capped, so its Retina image is twice its size in points.
const small = shotMap([400, 300, 700, 500], 1400, 1000);
assert.deepEqual(toScreen(small, 700, 500), [750, 550], 'Retina 2x maps back to points');

assert.deepEqual(parseSipsSize('/tmp/a.jpg\n  pixelWidth: 1568\n  pixelHeight: 929\n'), [1568, 929]);
assert.equal(parseSipsSize('garbage'), null);
console.log('screenshot coordinate tests: passed');

// Regression: after navigating, id 70 was a pinned post instead of SETTINGS, so Sidekick pointed at the wrong thing.
{
  const { rematch, sameBounds } = await import('../pointing.mjs');
  const read = [
    { id: 69, role: 'link', label: 'Members', bounds: [1100, 560, 80, 20] },
    { id: 70, role: 'button', label: 'SETTINGS', bounds: [1060, 620, 230, 40] },
  ];
  const settings = read[1];
  const after = [
    { id: 70, role: 'link', label: '👾 Join our Discord here (a must)', bounds: [300, 400, 500, 30] },
    { id: 71, role: 'button', label: 'SETTINGS', bounds: [1060, 700, 230, 40] },
  ];
  const fresh = Array.from({ length: 69 }, (_, i) => ({ id: i + 1, role: 'link', label: `x${i}`, bounds: [0, 0, 1, 1] })).concat(after);
  assert.equal(rematch(settings, fresh, 70)?.id, 71, 'finds SETTINGS at its new id');
  const unchanged = Array.from({ length: 68 }, (_, i) => ({ id: i + 1, role: 'link', label: `x${i}`, bounds: [0, 0, 1, 1] })).concat(read);
  assert.equal(rematch(settings, unchanged, 70)?.label, 'SETTINGS', 'same page keeps the id');
  assert.equal(rematch(settings, fresh.filter((c) => c.label !== 'SETTINGS'), 70), null, 'gone from the page: refuse');
  assert.equal(rematch({ role: 'button', label: '', bounds: [0, 0, 1, 1] }, fresh, 70), null, 'unlabelled and changed: refuse');
  assert.equal(rematch(undefined, fresh, 70), null, 'id never read: refuse');
  // Two SETTINGS buttons: take the one nearest where it was.
  const two = [{ id: 1, role: 'button', label: 'SETTINGS', bounds: [10, 10, 50, 20] }, { id: 2, role: 'button', label: 'SETTINGS', bounds: [1070, 640, 230, 40] }];
  assert.equal(rematch(settings, two, 70)?.id, 2, 'nearest match wins');
  assert.ok(sameBounds([0, 39, 1800, 1066], [0, 40, 1800, 1066]) && !sameBounds([0, 39, 1800, 1066], [200, 39, 1800, 1066]));
  console.log('stale control id tests: passed');
}

// Regression: after switching pages or apps, Sidekick pointed using what it saw for the previous request.
{
  const { shotProblem, readProblem } = await import('../pointing.mjs');
  assert.match(shotProblem(null, 3), /Take a screenshot first/);
  assert.equal(shotProblem({ turn: 3 }, 3), null, 'a screenshot from this request is fine');
  assert.match(shotProblem({ turn: 2 }, 3), /before the user's latest message/, 'a screenshot from the last request is refused');
  assert.match(shotProblem({ turn: 3, used: true }, 3), /clicked or opened since/, 'a screenshot taken before a click is refused');
  assert.equal(readProblem({ win: 7, turn: 3 }, 7, 3), null, 'this window, this request');
  assert.match(readProblem({ win: 7, turn: 2 }, 7, 3), /before the user's latest message/, 'last request: read again');
  assert.match(readProblem({ win: 7, turn: 3 }, 9, 3), /read_window on this window first/, 'another window: read it first');
  assert.match(readProblem(null, 9, 3), /read_window on this window first/);
  console.log('freshness tests: passed');
}
