// Tool-call performances for the sidekick. Each tool has a pose, pixel props drawn on the LED grid,
// optional effects above everything, and a few variants. The agent layer runs them via agent.tool().
(() => {
  const R = window.Roamie;
  const { clamp, lerp } = R;
  const T = (R.agentTools = {});
  const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

  // ----- sprite helpers (grid cells) -----
  const box = (c, x0, y0, w, h, fill, edge, round = true) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const cornerX = x === 0 || x === w - 1, cornerY = y === 0 || y === h - 1;
      if (round && cornerX && cornerY) continue;
      c.put(x0 + x, y0 + y, cornerX || cornerY ? edge : fill);
    }
  };
  const ring = (c, cx, cy, r, lvl, a0 = 0, a1 = Math.PI * 2) => {
    const n = Math.max(8, Math.ceil(r * 7));
    for (let i = 0; i <= n; i++) { const a = lerp(a0, a1, i / n); c.put(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), lvl); }
  };
  const seg = (c, x0, y0, x1, y1, lvl, thick = 1) => {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    for (let i = 0; i <= n; i++) {
      const x = Math.round(lerp(x0, x1, i / n)), y = Math.round(lerp(y0, y1, i / n));
      c.put(x, y, lvl); if (thick > 1) { c.put(x + 1, y, lvl); c.put(x, y + 1, lvl); }
    }
  };
  // Dark silhouette one cell larger than a sprite, so props read against the body.
  const halo = (c, x0, y0, w, h) => { for (let y = -1; y <= h; y++) for (let x = -1; x <= w; x++) c.put(x0 + x, y0 + y, 0); };
  const check = (c, cx, cy, lvl) => { seg(c, cx - 3, cy, cx - 1, cy + 2, lvl, 2); seg(c, cx - 1, cy + 2, cx + 3, cy - 2, lvl, 2); };
  const cross = (c, cx, cy, lvl) => { seg(c, cx - 2, cy - 2, cx + 2, cy + 2, lvl, 2); seg(c, cx + 2, cy - 2, cx - 2, cy + 2, lvl, 2); };

  const paper = (c, cx, cy, st, opts = {}) => {
    const w = opts.w ?? 16, h = opts.h ?? 20, x0 = Math.round(cx - w / 2), y0 = Math.round(cy - h / 2), L = c.L;
    const appear = opts.appear ?? 1, crumble = opts.crumble ?? 0, F = 4;
    const vis = (x, y) => c.th(x, y) < appear && !(crumble && c.th(x * 3 + 1, y * 5) < crumble * 1.2 - (y - y0) / h * 0.3);
    for (let y = -1; y <= h; y++) for (let x = -1; x <= w; x++) {
      const gx = x0 + x, gy = y0 + y;
      if (!vis(gx, gy)) continue;
      if (x - (w - F) > y + 1) continue;
      const out = x < 0 || y < 0 || x >= w || y >= h || x - (w - F) === y + 1;
      if (out) { c.put(gx, gy, 0); continue; }
      if (x - (w - F) > y) continue;
      const edge = x === 0 || y === h - 1 || y === 0 || x === w - 1 || x - (w - F) === y;
      c.put(gx, gy, edge ? L - 1 : L);
    }
    for (let y = 0; y < F; y++) for (let x = 0; x <= y; x++) if (vis(x0 + w - F + x, y0 + y)) c.put(x0 + w - F + x, y0 + y, x === y || y === F - 1 ? 1 : L - 2);
    const lines = opts.lines ?? 5, seed = st.seed + (opts.page ?? 0) * 13;
    for (let i = 0; i < lines; i++) {
      const ly = y0 + 4 + i * 2;
      if (ly >= y0 + h - 2) break;
      let len = Math.round((w - 5) * (0.45 + hash(seed + i) * 0.55));
      if (opts.write != null) len = i < opts.write.line ? len : i === opts.write.line ? Math.round(len * opts.write.u) : 0;
      const hi = opts.hi === i;
      if (hi) for (let x = 1; x < w - 1; x++) for (let yy = -1; yy <= 1; yy++) if (vis(x0 + x, ly + yy)) c.put(x0 + x, ly + yy, L - 2);
      for (let x = 0; x < len; x++) {
        if (!vis(x0 + 2 + x, ly)) continue;
        const struck = opts.strike?.includes(i);
        c.put(x0 + 2 + x, ly, struck ? L - 2 : hi ? 0 : 1);
      }
      if (opts.strike?.includes(i) && len) for (let x = -1; x <= len; x++) { c.put(x0 + 2 + x, ly, 0); }
    }
    return { x0, y0, w, h };
  };

  const camera = (c, cx, cy, st, flash) => {
    const L = c.L;
    halo(c, cx - 10, cy - 6, 21, 14); halo(c, cx - 6, cy - 9, 8, 4);
    box(c, cx - 10, cy - 6, 21, 14, 1, L - 1);
    box(c, cx - 6, cy - 9, 8, 4, L - 1, L - 1, false);
    for (let x = cx - 9; x <= cx + 9; x++) c.put(x, cy - 3, 0);
    for (let x = cx + 4; x <= cx + 8; x++) for (let y = cy - 5; y <= cy - 4; y++) c.put(x, y, flash > 0.2 ? L : 2);
    c.disc(cx, cy + 1, 6, 6, 0);
    c.disc(cx, cy + 1, 5, 5, L);
    c.disc(cx, cy + 1, 4, 4, 0);
    c.disc(cx, cy + 1, 2, 2, 1);
    c.put(cx - 2, cy - 1, L); c.put(cx - 1, cy - 1, L); c.put(cx - 2, cy, L);
    if (Math.sin(c.now * 8) > 0) { c.put(cx - 8, cy - 5, L); c.put(cx - 7, cy - 5, L); }
  };

  const pencil = (c, x, y, ang) => {
    const dx = Math.cos(ang), dy = Math.sin(ang), L = c.L;
    for (let i = -1; i < 13; i++) { const px = Math.round(x - dx * i), py = Math.round(y - dy * i); for (let a = -1; a <= 2; a++) for (let b2 = -1; b2 <= 1; b2++) c.put(px + a, py + b2, 0); }
    for (let i = 0; i < 12; i++) {
      const px = Math.round(x - dx * i), py = Math.round(y - dy * i);
      const lvl = i < 2 ? (i === 0 ? 1 : L) : i > 10 ? L - 2 : i % 2 ? L - 1 : L;
      c.put(px, py, lvl); c.put(px + 1, py, i < 1 ? 0 : lvl);
    }
  };

  const magnifier = (c, cx, cy, r = 4) => {
    const L = c.L;
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
      const d = Math.hypot(x, y);
      if (d <= r - 0.6 && c.th(cx + x, cy + y) < 0.25) c.put(cx + x, cy + y, 2);
    }
    ring(c, cx, cy, r + 1.4, 0); ring(c, cx, cy, r - 1, 0);
    ring(c, cx, cy, r, L); ring(c, cx, cy, r + 0.7, L - 1);
    c.put(cx - 2, cy - 2, L); c.put(cx - 1, cy - 2, L);
    seg(c, cx + r, cy + r, cx + r + 5, cy + r + 5, 0, 2); seg(c, cx + r + 1, cy + r, cx + r + 6, cy + r + 5, 0, 2); seg(c, cx + r - 1, cy + r - 1, cx + r + 4, cy + r + 4, L - 1, 2);
  };

  const globe = (c, cx, cy, r, rot) => {
    const L = c.L;
    c.disc(cx, cy, r + 1, r + 1, 0);
    c.disc(cx, cy, r, r, 1);
    for (let y = -r; y <= r; y++) {
      const hw = Math.sqrt(Math.max(0, r * r - y * y));
      for (let k = 0; k < 4; k++) {
        const ph = rot + (k * Math.PI) / 4, s = Math.sin(ph), front = Math.cos(ph) > 0;
        c.put(Math.round(cx + hw * s), cy + y, front ? L - 1 : 2);
      }
      if (y === 0 || Math.abs(y) === Math.round(r / 2)) for (let x = -Math.floor(hw); x <= Math.floor(hw); x++) c.put(cx + x, cy + y, L - 2);
    }
    ring(c, cx, cy, r + 0.4, L - 1);
    c.put(cx - Math.round(r * 0.5), cy - Math.round(r * 0.55), L);
  };

  const terminal = (c, x0, y0, w, h, st, lines, status) => {
    const L = c.L;
    halo(c, x0, y0, w, h);
    box(c, x0, y0, w, h, 0, L - 1);
    for (let x = 1; x < w - 1; x++) { c.put(x0 + x, y0 + 1, 1); c.put(x0 + x, y0 + 2, 1); }
    [2, 5, 8].forEach((x, i) => { c.put(x0 + x, y0 + 1, i === 0 ? L : L - 2); c.put(x0 + x + 1, y0 + 1, i === 0 ? L : L - 2); });
    const rows = Math.floor((h - 6) / 2);
    const first = Math.max(0, lines.length - rows);
    lines.slice(first).forEach((ln, i) => {
      const y = y0 + 4 + i * 2;
      if (ln.prompt) { c.put(x0 + 2, y, L); c.put(x0 + 3, y, L - 1); }
      for (let x = 0; x < ln.len; x++) c.put(x0 + (ln.prompt ? 5 : 2) + x, y, ln.lvl ?? L - 1);
    });
    const last = lines[lines.length - 1];
    if (!status && Math.sin(c.now * 10) > 0) {
      const y = y0 + 4 + Math.min(rows - 1, lines.length - 1 - first) * 2;
      const x = x0 + (last?.prompt ? 5 : 2) + (last?.len ?? 0) + 1;
      c.put(x, y, L); c.put(x, y - 1, L);
    }
    if (status) {
      const cx = x0 + w - 7, cy = y0 + h - 6;
      c.disc(cx, cy, 5, 5, 1);
      (status === 'ok' ? check : cross)(c, cx, cy, L);
    }
  };

  const brackets = (c, x0, y0, x1, y1, lvl, len = 4) => {
    for (const [x, y, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
      for (let i = 0; i < len; i++) { c.put(x + sx * i, y, lvl); c.put(x, y + sy * i, lvl); c.put(x + sx * i, y + sy, lvl - 1); c.put(x + sx, y + sy * i, lvl - 1); }
    }
  };

  // ===== SCREENSHOT =====  variants: screen | region | window
  T.screenshot = {
    variants: ['screen', 'region', 'window'], label: 'screenshot', sound: 'focus',
    start(st, c) {
      const pad = 14;
      let r;
      if (st.variant === 'screen') r = [pad, pad, c.W - pad, c.H - pad];
      else if (st.variant === 'window') { const w = c.W * 0.46, h = c.H * 0.42, x = c.bx < c.W / 2 ? c.W * 0.48 : c.W * 0.06; r = [x, c.H * 0.1, x + w, c.H * 0.1 + h]; }
      else { const w = c.W * 0.28, h = c.H * 0.24, x = c.bx < c.W / 2 ? c.W * 0.62 : c.W * 0.1; r = [x, c.H * 0.16, x + w, c.H * 0.16 + h]; }
      st.d.rect = r;
      st.d.cur = [c.bx - c.R, c.by - c.R, c.bx + c.R, c.by + c.R];
      st.d.snapAt = st.variant === 'region' ? 1.6 : 1.25;
    },
    update(st, c, dt) {
      const a = st.age, d = st.d, r = d.rect;
      const k = st.variant === 'window' ? 9 : 6;
      if (st.variant === 'region' && a < d.snapAt) {
        // region: the marquee is dragged out from one corner
        const u = ease(clamp((a - 0.35) / 0.9, 0, 1));
        const tgt = [r[0], r[1], lerp(r[0] + 8, r[2], u), lerp(r[1] + 8, r[3], u)];
        for (let i = 0; i < 4; i++) d.cur[i] = R.damp(d.cur[i], tgt[i], 10, dt);
      } else for (let i = 0; i < 4; i++) d.cur[i] = R.damp(d.cur[i], r[i], k, dt);
      if (a > d.snapAt - 0.45 && !d.focus) { d.focus = 1; c.S('focus'); }
      if (a >= d.snapAt && !d.snapped) {
        d.snapped = 1; d.flash = 1; c.S('shutter'); c.sq.kick(7);
        d.fly = { x: (r[0] + r[2]) / 2, y: (r[1] + r[3]) / 2, u: 0 };
      }
      if (d.flash) d.flash = Math.max(0, d.flash - dt * 3.2);
      if (d.fly) {
        d.fly.u += dt / 0.6;
        if (d.fly.u >= 1 && !d.gulped) { d.gulped = 1; c.sq.kick(9); c.S('gulp'); st.finish(true); }
      }
    },
    pose(st, c) {
      const d = st.d, rec = d.snapped && st.age - d.snapAt < 0.25 ? 0.1 : 0;
      const tx = (d.rect[0] + d.rect[2]) / 2, ty = (d.rect[1] + d.rect[3]) / 2;
      c.look(tx, ty);
      return { arms: 1, tl: [-0.72, 0.42 + rec], tr: [0.72, 0.42 + rec], oy: rec * c.R, mouth: d.snapped ? 'grin' : 'flat', brow: d.focus && !d.snapped ? 'determined' : null };
    },
    grid(st, c) {
      if (st.out > 0.4) return;
      camera(c, Math.round(c.bx / c.P), Math.round((c.by + c.R * 0.42) / c.P), st, st.d.flash);
    },
    top(st, c) {
      const d = st.d, P = c.P;
      if (!d.snapped || d.flash > 0.4) {
        const blink = d.focus && !d.snapped ? Math.sin(c.now * 30) > 0 : true;
        if (blink) brackets(c, Math.round(d.cur[0] / P), Math.round(d.cur[1] / P), Math.round(d.cur[2] / P), Math.round(d.cur[3] / P), c.L, st.variant === 'screen' ? 7 : 4);
        if (st.variant === 'region' && !d.snapped) {
          const x0 = Math.round(d.cur[0] / P), y0 = Math.round(d.cur[1] / P), x1 = Math.round(d.cur[2] / P), y1 = Math.round(d.cur[3] / P);
          for (let x = x0; x <= x1; x += 2) { c.put(x, y0, c.L - 2); c.put(x, y1, c.L - 2); }
          for (let y = y0; y <= y1; y += 2) { c.put(x0, y, c.L - 2); c.put(x1, y, c.L - 2); }
        }
      }
      if (d.fly && d.fly.u < 1) {
        const u = ease(d.fly.u), sx = d.fly.x, sy = d.fly.y, ex = c.bx, ey = c.by;
        const x = lerp(sx, ex, u), y = lerp(sy, ey, u) - Math.sin(u * Math.PI) * c.R * 1.2;
        const s = lerp(1, 0.35, u), w = Math.max(3, Math.round(11 * s)), h = Math.max(3, Math.round(10 * s));
        const gx = Math.round(x / P - w / 2), gy = Math.round(y / P - h / 2);
        box(c, gx, gy, w, h, c.L, c.L, false);
        for (let yy = 1; yy < h - Math.max(2, Math.round(3 * s)); yy++) for (let xx = 1; xx < w - 1; xx++) c.put(gx + xx, gy + yy, c.th(gx + xx, gy + yy) < 0.5 ? 1 : 2);
      }
    },
    over(st, c, ctx) {
      const d = st.d;
      if (!d.flash) return;
      const r = d.rect;
      ctx.fillStyle = c.css(c.PAL[c.L], d.flash * 0.32);
      ctx.fillRect(r[0], r[1], r[2] - r[0], r[3] - r[1]);
    },
  };

  // ===== READ =====  variants: file | many | search
  T.read = {
    variants: ['file', 'many', 'search'], label: 'read',
    start(st) { st.d.page = 0; st.d.pages = st.variant === 'many' ? 3 + Math.floor(hash(st.seed) * 3) : 1; st.d.flip = 0; },
    update(st, c, dt) {
      const d = st.d;
      if (st.variant === 'search') {
        d.found = d.found ?? 1.6 + hash(st.seed) * 0.8;
        if (st.age > d.found && !d.hit) { d.hit = 1; c.S('ping'); c.face.set('surprised', 0.4); }
        if (st.age > d.found + 1) st.finish(true);
        return;
      }
      const per = st.variant === 'many' ? 1.25 : 2.6;
      const p = Math.floor(st.age / per);
      if (p !== d.page) {
        if (p >= d.pages) { st.finish(true); return; }
        d.page = p; d.flip = 1; c.S('page');
      }
      d.flip = Math.max(0, d.flip - dt * 4);
      d.line = Math.floor(((st.age % per) / per) * 6);
      d.u = (((st.age % per) / per) * 6) % 1;
    },
    pose(st, c) {
      const d = st.d;
      if (st.variant === 'search') {
        const sweep = Math.sin(st.age * 2.6), lift = d.hit ? -0.25 : 0;
        const mx = 0.1 + sweep * 0.55, my = 0.45 + Math.cos(st.age * 1.9) * 0.18 + lift;
        c.look(c.bx + mx * c.R * 2, c.by + my * c.R);
        d.mag = [mx, my];
        return { arms: 1, tl: [-0.95, 0.4], tr: [mx + 0.35, my + 0.35], mouth: d.hit ? 'o' : 'flat', brow: d.hit ? 'raised' : 'determined' };
      }
      const u = d.u ?? 0;
      c.look(c.bx + lerp(-0.4, 0.4, u) * c.R, c.by + c.R);
      const sway = Math.sin(st.age * 2) * 0.03;
      return { arms: 1, tl: [-0.52, 1.25 + sway], tr: [0.52, 1.25 - sway], oy: -d.flip * c.R * 0.04, mouth: 'flat', brow: null };
    },
    grid(st, c) {
      const d = st.d, P = c.P, cx = Math.round(c.bx / P), cy = Math.round((c.by + c.R * 0.82) / P);
      if (st.out > 0.5) return;
      if (st.variant === 'search') {
        const docs = [[-9, 2], [0, 4], [9, 2]];
        [[-12, 3], [0, 5], [12, 3]].forEach(([dx, dy], i) => paper(c, cx + dx, cy + dy - 1, st, { w: 10, h: 13, lines: 3, page: i, hi: d.hit && i === 1 ? 1 : null }));
        const [mx, my] = d.mag ?? [0, 0.5];
        magnifier(c, Math.round((c.bx + mx * c.R * 1.6) / P), Math.round((c.by + my * c.R) / P), 5);
        if (d.hit) { const by = cy - 8 - Math.round(Math.abs(Math.sin(st.age * 9)) * 2); for (let y = 0; y < 3; y++) c.put(cx + 2, by + y, c.L); c.put(cx + 2, by + 4, c.L); }
        return;
      }
      if (st.variant === 'many' && d.page < d.pages - 1) for (let i = 2; i >= 1; i--) paper(c, cx + i, cy - i, st, { page: d.page + i, lines: 0 });
      const slide = d.flip * 6;
      paper(c, cx - Math.round(slide), cy + Math.round(slide * 0.3), st, { page: d.page, hi: d.line, lines: 6 });
      if (st.variant === 'many') {
        const n = d.pages, x0 = cx - n;
        for (let i = 0; i < n; i++) c.put(x0 + i * 2, cy + 10, i <= d.page ? c.L : 1);
      }
    },
  };

  // ===== WRITE =====  variants: edit | create | delete
  T.write = {
    variants: ['edit', 'create', 'delete'], label: 'write',
    start(st) { st.d.lines = 6; },
    update(st, c, dt) {
      const d = st.d;
      if (st.variant === 'delete') {
        d.crumble = clamp((st.age - 0.7) / 1.1, 0, 1);
        if (d.crumble > 0 && !d.cr) { d.cr = 1; c.S('crunch'); }
        if (d.crumble > 0 && Math.random() < dt * 40) c.spawn(c.bx + R.rand(-0.4, 0.4) * c.R, c.by + c.R * R.rand(0.3, 1), R.rand(-40, 40), R.rand(-30, 20), 420, R.rand(0, 1) < 0.5 ? c.L - 1 : c.L - 2, 0, 1.1);
        if (st.age > 2.2) st.finish(true);
        return;
      }
      const t0 = st.variant === 'create' ? 0.7 : 0.2;
      d.appear = st.variant === 'create' ? clamp(st.age / 0.7, 0, 1) : 1;
      const w = Math.max(0, st.age - t0) / 0.42;
      d.wline = Math.floor(w); d.wu = w % 1;
      if (d.appear >= 1 && d.wline < d.lines && Math.random() < dt * 9) c.S('scribble');
      if (st.variant === 'edit' && d.wline !== d.lastPlus && d.wline < d.lines && d.wline > 0) {
        d.lastPlus = d.wline;
        const minus = d.wline === 2 || d.wline === 4;
        c.spawnGlyph(minus ? '-' : '+', c.bx - c.R * 0.1, c.by + c.R * 0.2);
      }
      if (d.wline >= d.lines + 1) st.finish(true);
    },
    pose(st, c) {
      const d = st.d;
      if (st.variant === 'delete') {
        const shake = d.crumble ? Math.sin(st.age * 50) * 0.04 : 0;
        c.look(c.bx, c.by + c.R);
        return { arms: d.crumble > 0.7 ? 0.5 : 1, tl: [-0.5 + shake, 1.0], tr: [0.5 + shake, 1.0], mouth: d.crumble ? 'frown' : 'o', brow: d.crumble ? 'raised' : null };
      }
      const line = Math.min(d.wline ?? 0, d.lines - 1), u = d.wu ?? 0;
      const zig = Math.sin(u * Math.PI * 10) * 0.05;
      const px = lerp(-1.3, -0.62, u), py = 0.38 + line * 0.13 + zig;
      d.pen = [px, py];
      c.look(c.bx + px * c.R, c.by + py * c.R);
      return { arms: 1, tl: [-1.6, 0.85], tr: [px + 0.36, py + 0.42], mouth: st.variant === 'create' && d.appear < 1 ? 'o' : 'flat', brow: 'determined' };
    },
    grid(st, c) {
      const d = st.d, P = c.P;
      if (st.out > 0.5) return;
      if (st.variant === 'delete') {
        if (d.crumble < 1) paper(c, Math.round(c.bx / P), Math.round((c.by + c.R * 0.66) / P), st, { crumble: d.crumble, lines: 6 });
        return;
      }
      const cx = Math.round((c.bx - c.R * 0.95) / P), cy = Math.round((c.by + c.R * 0.78) / P);
      const strike = st.variant === 'edit' ? [2, 4].filter((i) => i < (d.wline ?? 0)) : [];
      paper(c, cx, cy, st, { appear: d.appear, write: { line: d.wline ?? 0, u: d.wu ?? 0 }, lines: d.lines, strike });
      const [px, py] = d.pen ?? [-0.6, 0.4];
      pencil(c, Math.round((c.bx + px * c.R) / P) + 1, Math.round((c.by + py * c.R) / P), -2.3);
    },
  };

  // ===== RUN (terminal) =====  variants: ok | fail | progress
  T.run = {
    variants: ['ok', 'progress', 'fail'], label: 'run',
    start(st) { st.d.lines = [{ prompt: true, len: 0 }]; st.d.typed = 0; st.d.cmdLen = 8 + Math.floor(hash(st.seed) * 6); },
    update(st, c, dt) {
      const d = st.d, L = d.lines;
      if (st.age < 0.9) {
        const n = Math.floor(st.age / 0.9 * d.cmdLen);
        if (n > L[0].len) { L[0].len = n; c.S('key', 0.8 + hash(n + st.seed) * 0.5); }
        d.typing = true;
        return;
      }
      d.typing = false;
      const outT = st.age - 0.9, total = st.variant === 'progress' ? 2.6 : 1.8;
      if (st.variant === 'progress') d.bar = clamp(outT / (total - 0.3), 0, 1);
      const want = Math.min(7, Math.floor(outT / 0.22));
      while (L.length - 1 < want) L.push({ len: 3 + Math.floor(hash(L.length + st.seed) * 12), lvl: L.length % 3 ? c.L - 2 : 1 });
      if (outT > total && !st.status) {
        if (st.variant === 'fail') { L.push({ len: 9, lvl: c.L }); st.finish(false); c.face.set(null, 0); }
        else st.finish(true);
      }
    },
    pose(st, c) {
      const d = st.d, side = c.bx < c.W * 0.62 ? 1 : -1;
      d.side = side;
      const ty = d.typing ? Math.sin(st.age * 26) : 0;
      c.look(c.bx + side * c.R * 2, c.by - c.R * 0.1);
      const fail = st.status === 'fail';
      return {
        arms: 1, tl: [-0.36 + side * 0.15, 0.8 - Math.max(0, ty) * 0.14], tr: [0.36 + side * 0.15, 0.8 - Math.max(0, -ty) * 0.14],
        ox: side * c.R * 0.05, mouth: fail ? 'frown' : st.status === 'ok' ? 'grin' : 'flat', brow: fail ? 'angry' : 'determined',
      };
    },
    grid(st, c) {
      const d = st.d, P = c.P, w = 30, h = 21;
      const side = d.side ?? 1;
      const x0 = Math.round((c.bx + side * (c.R * 1.35)) / P) - (side < 0 ? w : 0), y0 = Math.round((c.by - c.R * 0.9) / P);
      const pop = clamp(st.age / 0.18, 0, 1) * (1 - clamp((st.out - 0.4) / 0.4, 0, 1));
      if (pop < 0.3) return;
      terminal(c, x0, y0, w, h, st, d.lines, st.status);
      if (d.bar != null) {
        const y = y0 + h - 3, bw = w - 4;
        for (let x = 0; x < bw; x++) { c.put(x0 + 2 + x, y, x < Math.round(bw * d.bar) ? c.L : 1); c.put(x0 + 2 + x, y - 1, x < Math.round(bw * d.bar) ? c.L - 1 : 1); }
      }
      // little cable of light from the blob's hands to the terminal while typing
      if (d.typing) for (let i = 0; i < 3; i++) { const u = ((c.now * 2 + i / 3) % 1); c.put(Math.round(lerp(c.bx / P + side * 4, x0 + (side > 0 ? 0 : w), u)), Math.round(lerp((c.by + c.R * 0.6) / P, y0 + h / 2, u)), c.L); }
    },
  };

  // ===== WEB =====  variants: search | fetch
  T.web = {
    variants: ['search', 'fetch'], label: 'web', head: 0.9,
    start(st) { st.d.packets = []; st.d.got = 0; },
    update(st, c, dt) {
      const d = st.d;
      if (st.variant === 'fetch' && st.age > 0.4 && st.age < 2.4 && Math.random() < dt * 9) {
        const a = Math.random() * Math.PI * 2, r = Math.max(c.W, c.H) * 0.6;
        d.packets.push({ x: c.bx + Math.cos(a) * r, y: c.by + Math.sin(a) * r, u: 0, sp: R.rand(0.9, 1.5) });
      }
      for (let i = d.packets.length - 1; i >= 0; i--) {
        const p = d.packets[i]; p.u += dt * p.sp;
        if (p.u >= 1) { d.packets.splice(i, 1); d.got++; if (d.got % 3 === 1) c.S('ping'); }
      }
      if (st.age > (st.variant === 'fetch' ? 2.9 : 2.4)) st.finish(true);
      if (st.variant === 'search' && Math.random() < dt * 3) c.S('tick');
    },
    pose(st, c) {
      const lift = Math.sin(st.age * 3) * 0.05;
      c.look(c.bx + c.R * 0.8, c.by - c.R * 1.4);
      return { arms: 1, tl: [-0.98, 0.35], tr: [0.82, -0.72 + lift], mouth: 'o', brow: 'raised' };
    },
    grid(st, c) {
      const P = c.P, d = st.d;
      if (st.out > 0.5) return;
      const gx = Math.round((c.bx + c.R * 0.86) / P), gy = Math.round((c.by - c.R * 1.38 + Math.sin(st.age * 3) * c.R * 0.05) / P);
      globe(c, gx, gy, 8, st.age * 2.4);
      if (st.variant === 'search') {
        const a = st.age * 3, mx = gx + Math.round(Math.cos(a) * 12), my = gy + Math.round(Math.sin(a) * 8);
        magnifier(c, mx, my, 4);
      } else {
        for (let i = 0; i < 3; i++) {
          const rr = 10 + ((st.age * 9 + i * 4) % 12);
          ring(c, gx, gy, rr, rr > 16 ? 1 : 2, -Math.PI * 0.95, -Math.PI * 0.05);
        }
      }
    },
    top(st, c) {
      const P = c.P, gx = c.bx + c.R * 0.86, gy = c.by - c.R * 1.38;
      for (const p of st.d.packets) {
        const u = ease(p.u), x = lerp(p.x, gx, u), y = lerp(p.y, gy, u);
        c.put(Math.round(x / P), Math.round(y / P), c.L); c.put(Math.round(x / P) + 1, Math.round(y / P), c.L - 1);
      }
    },
  };
})();
