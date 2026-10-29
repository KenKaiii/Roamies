// Screenshots reach the model resized (Retina pixels, then capped), so its x/y are image pixels, not screen points.
export function shotMap([x, y, w, h], imgW, imgH) {
  return { origin: [x, y], sx: w / imgW, sy: h / imgH, size: [imgW, imgH] };
}

export function toScreen(map, x, y) {
  return [Math.round(map.origin[0] + x * map.sx), Math.round(map.origin[1] + y * map.sy)];
}

export function parseSipsSize(out) {
  const w = +/pixelWidth:\s*(\d+)/.exec(out)?.[1], h = +/pixelHeight:\s*(\d+)/.exec(out)?.[1];
  return w > 0 && h > 0 ? [w, h] : null;
}

export const sameBounds = (a, b) => !!a && !!b && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= 1);

const same = (a, b) => a.role === b.role && (a.label ?? '').trim() === (b.label ?? '').trim();

// read_window ids are list positions, so after the page changes the same id can be another control.
// expected: what read_window listed at that id; fresh: the window's controls now. Returns the live control or null.
export function rematch(expected, fresh, id) {
  if (!expected) return null;
  const now = fresh[id - 1];
  if (now && same(expected, now)) return now;
  if (!(expected.label ?? '').trim()) return null; // nothing to recognise it by
  const [ex, ey] = expected.bounds ?? [0, 0];
  const hits = fresh.filter((c) => same(expected, c));
  hits.sort((a, b) => Math.hypot(a.bounds[0] - ex, a.bounds[1] - ey) - Math.hypot(b.bounds[0] - ex, b.bounds[1] - ey));
  return hits[0] ?? null;
}
