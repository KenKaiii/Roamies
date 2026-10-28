// Dither blobs: a shaded metaball pushed through an ordered-dither threshold into a small fixed palette.
// Roamie.ditherKit(options) returns a roamie definition, so each variant only changes its look and extras.
(() => {
  const bayer = (n) => {
    let M = [[0]];
    while (M.length < n) {
      const s = M.length, Q = [[0, 2], [3, 1]], N = [];
      for (let y = 0; y < s * 2; y++) { N.push([]); for (let x = 0; x < s * 2; x++) N[y][x] = M[y % s][x % s] * 4 + Q[(y / s) | 0][(x / s) | 0]; }
      M = N;
    }
    return { n, t: Float32Array.from(M.flat(), (v) => (v + 0.5) / (n * n)) };
  };
  const fixed = (n, rows) => ({ n, t: Float32Array.from(rows.flat(), (v) => (v + 0.5) / (n * n)) });
  const PATTERNS = {
    bayer4: bayer(4),
    bayer8: bayer(8),
    dots: fixed(4, [[12, 5, 6, 13], [4, 0, 1, 7], [11, 3, 2, 8], [15, 10, 9, 14]]),
    lines: fixed(4, [[0, 0, 0, 0], [8, 8, 8, 8], [4, 4, 4, 4], [12, 12, 12, 12]].map((r, i) => r.map((v) => v + i))),
  };

  Roamie.ditherKit = (o) => ({
    id: o.id,
    label: o.label,
    bg: o.bg ?? `rgb(${o.pal[0].join(',')})`,
    create(env) {
      const { clamp, rand } = Roamie;
      const S = (n) => Roamie.sfx?.play(n);
      const PAL = o.pal, L = PAL.length - 1;
      const { n: PN, t: PT } = PATTERNS[o.pattern ?? 'bayer4'], PM = PN - 1;
      const th = (gx, gy) => PT[(gy & PM) * PN + (gx & PM)];
      const K = o.matrix ? 4 : 1;
      const GAP = PAL[0].map((c) => (c * 0.7) | 0);
      const SCAN = o.scan ?? 1;
      const m = new Roamie.Mover(env, { speed: o.speed ?? 95, accel: 2.4 });
      const face = new Roamie.Face();
      const sq = new Roamie.Spring(170, 8);
      const tail = Array.from({ length: 3 }, () => ({ x: m.x, y: m.y, vx: 0, vy: 0 }));
      const ears = o.ears ? [-1, 1].map((s) => ({ s, x: m.x, y: m.y, vx: 0, vy: 0 })) : [];
      const ant = o.antenna ? Array.from({ length: 6 }, () => ({ x: m.x, y: m.y, vx: 0, vy: 0 })) : null;
      const drips = [];
      // Sidekick acts: little performances with pop-out hands, a pixel speech icon and particles.
      const ACTS = ['wave', 'hype', 'remind', 'upset', 'motivate'];
      const forced = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('act') : null;
      const hands = [-1, 1].map((s) => ({ s, x: m.x, y: m.y, vx: 0, vy: 0 }));
      const parts = [];
      let act = null, pending = null, arms = 0, ox = 0, oy = 0, prevHop = 0;
      let actIdx = [...o.id].reduce((a, c) => a + c.charCodeAt(0), 0) % ACTS.length, nextAct = rand(1.2, 3);
      // Presence: 'shown' | 'hidden' | 'in' (entering) | 'out' (leaving); v is the variant playing.
      const pres = { state: 'shown', u: 1, v: null, tx: 0, ty: 0, landed: false, launched: false, crouched: false };
      let mask = null, EW = 800, EH = 600;
      const startAct = (name, quiet) => {
        if (pres.state !== 'shown') { pending = name; return; }
        act = { name, a: 0, dur: name === 'upset' ? 3.4 : name === 'hype' ? 2.8 : 3.1 };
        m.mode = 'rest'; m.rest = act.dur;
        if (name === 'remind') face.set('surprised', 0.3);
        if (!quiet) S(name);
      };
      let wasFlung = false, wasAsleep = false, snoreT = 3;
      const spawn = (x, y, vx, vy, g, lvl, size = 0, rate = 1) => parts.push({ x, y, vx, vy, g, lvl, size, rate, life: 1 });
      let browAt = [];
      let P = 4, gw = 0, gh = 0, IW = 0, IH = 0, R = 40, t = 0, dripT = 0.6;
      const off = document.createElement('canvas');
      const octx = off.getContext('2d');
      const bloom = o.glow ? document.createElement('canvas') : null;
      const bctx = bloom?.getContext('2d');
      let img = null, d = null, clear = false;
      const spring = (p, tx, ty, k, c, dt) => { p.vx += ((tx - p.x) * k - p.vx * c) * dt; p.vy += ((ty - p.y) * k - p.vy * c) * dt; p.x += p.vx * dt; p.y += p.vy * dt; };

      // Writes one logical pixel; in matrix mode it becomes a 3x3 dot with a one-subpixel gap.
      const setPx = (gx, gy, c, a = 255, solid = false) => {
        if (gx < 0 || gy < 0 || gx >= gw || gy >= gh) return;
        if (mask) { const r = mask(gx, gy); if (!r) return; if (r === 2) c = PAL[L]; }
        const f = SCAN !== 1 && gy & 1 ? SCAN : 1;
        const r = c[0] * f, g = c[1] * f, b = c[2] * f;
        if (K === 1) { const i = (gy * IW + gx) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a; return; }
        for (let j = 0; j < K; j++) for (let k = 0; k < K; k++) {
          const i = ((gy * K + j) * IW + gx * K + k) * 4;
          const on = j < 3 && k < 3 && !((j !== 1) && (k !== 1) && o.round);
          if (on) { d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a; }
          else if (!clear || solid) { d[i] = GAP[0]; d[i + 1] = GAP[1]; d[i + 2] = GAP[2]; d[i + 3] = solid ? a : 255; }
        }
      };
      const put = (x, y, lvl = 0) => setPx(x, y, PAL[clamp(lvl, 0, L)]);
      const line = (x0, y0, x1, y1, lvl) => {
        const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / P));
        for (let i = 0; i <= n; i++) put(Math.round((x0 + ((x1 - x0) * i) / n) / P), Math.round((y0 + ((y1 - y0) * i) / n) / P), lvl);
      };
      const disc = (cx, cy, rx, ry, lvl) => {
        for (let yy = -ry; yy <= ry; yy++) for (let xx = -rx; xx <= rx; xx++)
          if ((xx * xx) / (rx * rx + 0.5) + (yy * yy) / (ry * ry + 0.5) <= 1) put(cx + xx, cy + yy, lvl);
      };

      const eyesPixel = (cx, cy) => {
        const gap = Math.max(3, Math.round((R * 0.42) / P)), ew = Math.max(2, Math.round((R * 0.16) / P)), eh = Math.max(3, Math.round((R * 0.28) / P));
        for (const s of [-1, 1]) {
          const ex = cx + s * gap;
          browAt.push({ x: ex, y: cy - eh - 2, w: ew + 1, s });
          if (face.happy > 0.5) {
            for (let i = -ew; i <= ew; i++) { put(ex + i, cy - (ew - Math.abs(i))); put(ex + i, cy - (ew - Math.abs(i)) + 1); }
          } else if (face.dizzy > 0.5) {
            for (let i = -ew; i <= ew; i++) { put(ex + i, cy + i); put(ex + i, cy - i); }
          } else if (face.open < 0.35) {
            for (let i = -ew; i <= ew; i++) put(ex + i, cy + 1);
          } else {
            const h = Math.max(1, Math.round(eh * (face.wide > 0.5 ? 1.3 : Math.min(1, face.open))));
            disc(ex, cy, ew, h, 0);
            put(ex - 1, cy - Math.max(1, h - 1), L);
            if (ew > 2) put(ex - 1, cy - Math.max(1, h - 1) + 1, L);
          }
        }
        return cy + eh + Math.max(2, Math.round((R * 0.12) / P));
      };
      // One big eye: bright sclera, dark outline, pupil that tracks the cursor.
      const eyeCyclops = (cx, cy) => {
        const ew = Math.max(4, Math.round((R * 0.34) / P)), eh = Math.max(4, Math.round((R * 0.36) / P));
        browAt.push({ x: cx, y: cy - eh - 3, w: ew + 2, s: 0 });
        if (face.happy > 0.5) {
          for (let i = -ew; i <= ew; i++) { const y = cy - Math.round(Math.sqrt(Math.max(0, 1 - (i * i) / (ew * ew))) * eh * 0.6); put(cx + i, y); put(cx + i, y + 1); }
        } else if (face.dizzy > 0.5) {
          for (let i = -ew; i <= ew; i++) { put(cx + i, cy + Math.round(i * eh / ew)); put(cx + i, cy - Math.round(i * eh / ew)); }
        } else if (face.open < 0.3) {
          for (let i = -ew; i <= ew; i++) { put(cx + i, cy + 1); put(cx + i, cy + 2); }
        } else {
          const h = Math.max(2, Math.round(eh * (face.wide > 0.5 ? 1.15 : Math.min(1, face.open))));
          disc(cx, cy, ew + 1, h + 1, 0);
          disc(cx, cy, ew, h, L);
          const pr = Math.max(2, Math.round(ew * (face.wide > 0.5 ? 0.32 : 0.5)));
          const px = cx + Math.round(face.lookX * (ew - pr - 1)), py = cy + Math.round(face.lookY * Math.max(0, h - pr - 1));
          disc(px, py, pr, Math.min(pr, h), 0);
          put(px - Math.ceil(pr / 2), py - Math.ceil(pr / 2), L);
        }
        return cy + eh + Math.max(3, Math.round((R * 0.16) / P));
      };
      // A dark visor band with two bright slots that slide toward the cursor.
      const eyeVisor = (cx, cy) => {
        const vw = Math.max(6, Math.round((R * 0.62) / P)), vh = Math.max(2, Math.round((R * 0.16) / P));
        for (let yy = -vh; yy <= vh; yy++) for (let xx = -vw; xx <= vw; xx++) if (Math.abs(xx) < vw - (Math.abs(yy) === vh ? 1 : 0)) put(cx + xx, cy + yy, 0);
        const sx = Math.round(face.lookX * vw * 0.25), sw = Math.max(1, Math.round(vw * 0.22));
        const h = face.wide > 0.5 ? vh : Math.max(0, Math.round((vh - 1) * Math.min(1, face.open)));
        for (const s of [-1, 1]) {
          const ex = cx + sx + s * Math.round(vw * 0.45);
          browAt.push({ x: ex, y: cy - vh - 2, w: sw + 1, s });
          if (face.happy > 0.5) for (let i = -sw; i <= sw; i++) { put(ex + i, cy - (sw - Math.abs(i)) + 1, L); }
          else if (face.dizzy > 0.5) for (let i = -sw; i <= sw; i++) { put(ex + i, cy + Math.round(Math.sin(i + t * 12) * 1), L); }
          else for (let yy = -h; yy <= h; yy++) for (let xx = -sw; xx <= sw; xx++) put(ex + xx, cy + yy, L - (Math.abs(yy) === h && h > 0 ? 1 : 0));
        }
        return cy + vh + Math.max(3, Math.round((R * 0.16) / P));
      };
      const mouth = (cx, my, mode) => {
        if (mode === 'shout') { disc(cx, my + 1, 2, 2, 0); put(cx, my + 2, Math.ceil(L / 2)); put(cx + 1, my + 2, Math.ceil(L / 2)); return; }
        if (mode === 'frown') { put(cx - 2, my + 1); for (let i = -1; i <= 1; i++) put(cx + i, my); put(cx + 2, my + 1); return; }
        if (mode === 'grin') { for (let i = -3; i <= 3; i++) { put(cx + i, my); put(cx + i, my + 2); } put(cx - 3, my + 1); put(cx + 3, my + 1); for (let i = -2; i <= 2; i++) put(cx + i, my + 1, L); return; }
        if (mode === 'o') { disc(cx, my + 1, 1, 1, 0); return; }
        if (mode === 'flat') { for (let i = -2; i <= 2; i++) put(cx + i, my + 1); return; }
        if (mode === 'talk1') { for (let i = -2; i <= 2; i++) { put(cx + i, my); put(cx + i, my + 1); } return; }
        if (mode === 'talk2') { disc(cx, my + 1, 2, 2, 0); put(cx, my + 2, Math.ceil(L / 2)); return; }
        if (face.happy > 0.5) { for (let i = -3; i <= 3; i++) put(cx + i, my + (Math.abs(i) < 3 ? 1 : 0)); for (let i = -2; i <= 2; i++) put(cx + i, my + 2); }
        else if (face.wide > 0.5) disc(cx, my + 1, 1, 1, 0);
        else { put(cx - 1, my); put(cx, my + 1); put(cx + 1, my); }
      };

      const drawBrow = (b, kind) => {
        const thick = kind === 'angry' ? 2 : 1;
        for (let i = -b.w; i <= b.w; i++) {
          const u = i / b.w, inner = b.s === 0 ? 1 - Math.abs(u) : (-b.s * u + 1) / 2;
          let dy = 0;
          if (kind === 'angry') dy = Math.round(inner * 2.4) - 1;
          else if (kind === 'determined') dy = Math.round(inner * 1.4) - 1;
          else if (kind === 'raised') dy = -1 + Math.round(Math.abs(u) * 1.2) - (b.s > 0 ? 1 : 0);
          for (let k = 0; k < thick; k++) put(b.x + i, b.y + dy - k, 0);
        }
      };
      const ICONS = {
        heart: ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'],
        bolt: ['...##', '..##.', '.##..', '#####', '..##.', '.##..', '##...'],
        excl: ['##', '##', '##', '##', '..', '##'],
        clock: ['..###..', '.#...#.', '#..#..#', '#..##.#', '#.....#', '.#...#.', '..###..'],
        anger: ['.##.##.', '##...##', '.......', '##...##', '.##.##.'],
        flame: ['..#...', '..##..', '.###.#', '.#####', '######', '##.###', '#...##', '.####.'],
      };
      const bubble = (gx, gy, icon) => {
        const rows = ICONS[icon], sc = P < 6 ? 2 : 1, h = rows.length * sc, w = rows[0].length * sc;
        const x0 = gx - Math.ceil(w / 2) - 2, y0 = gy - h - 3, x1 = x0 + w + 3, y1 = gy;
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const corner = (x === x0 || x === x1) && (y === y0 || y === y1);
          if (corner) continue;
          const edge = x === x0 || x === x1 || y === y0 || y === y1;
          put(x, y, edge ? 0 : L);
        }
        put(x0 + 1, y1 + 1, 0); put(x0 + 2, y1 + 1, 0); put(x0 + 1, y1 + 2, 0); put(x0 + 2, y1, L);
        const ink = icon === 'heart' || icon === 'flame' ? 1 : 0;
        rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) if (r[i] === '#') for (let a = 0; a < sc; a++) for (let b = 0; b < sc; b++) put(x0 + 2 + i * sc + b, y0 + 2 + j * sc + a, ink); });
      };
      const drawHands = (bx, by) => {
        if (arms < 0.12) return;
        // Floating mitts, no arms: they pop out of the body edge and stay readable over it.
        const hr = Math.max(2, Math.round(((R * 0.25) / P) * Math.min(1, arms * 1.25)));
        for (const h of hands) {
          const sx = bx + h.s * R * 0.62, sy = by + R * 0.18;
          const gx = Math.round(Roamie.lerp(sx, h.x, arms) / P), gy = Math.round(Roamie.lerp(sy, h.y, arms) / P);
          disc(gx, gy, hr + 1, hr + 1, 0);
          disc(gx, gy, hr, hr, Math.max(1, L - 1));
          for (let i = -hr + 1; i < hr; i++) put(gx + i, gy + hr - 1, Math.max(1, L - 2));
          put(gx - Math.ceil(hr / 2), gy - Math.ceil(hr / 2), L); put(gx - Math.ceil(hr / 2) + 1, gy - Math.ceil(hr / 2), L);
          put(gx + h.s * -1 * (hr - 1), gy - 1, 0);
        }
      };

      // ---------- presence performances ----------
      // materialize: LED pixels sparkle in from the centre / beam up and away from the top down
      // crt: a scanline powers on and opens into the body / collapses to a line, then a dot
      // drop: falls in from the top edge and lands / crouches and jumps off the top edge
      const PRES = {
        materialize: { in: 0.72, out: 0.8, sIn: 'materialize', sOut: 'dematerialize' },
        crt: { in: 0.56, out: 0.55, sIn: 'crt_on', sOut: 'crt_off' },
        drop: { in: 0.62, out: 0.66, sIn: 'drop', sOut: null },
      };
      const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
      const teleport = (x, y) => {
        m.x = x; m.y = y; m.vx = m.vy = 0; m.tx = x; m.ty = y; m.mode = 'rest'; m.rest = 1.5; m.flung = false; m.dragging = false;
        for (const q of tail) { q.x = x; q.y = y; q.vx = q.vy = 0; }
        for (const h of hands) { h.x = x; h.y = y; h.vx = h.vy = 0; }
        for (const e of ears) { e.x = x; e.y = y - R; e.vx = e.vy = 0; }
        if (ant) for (const q of ant) { q.x = x; q.y = y - R; q.vx = q.vy = 0; }
        drips.length = 0; parts.length = 0; arms = 0; m.stretch = 0;
      };
      const dust = (x, y, n) => {
        for (let i = 0; i < n; i++) {
          const s = i % 2 ? 1 : -1;
          spawn(x + s * rand(0.2, 0.9) * R, y, s * rand(60, 220), rand(-120, -20), 420, rand(0, 1) < 0.5 ? L : L - 1, i % 3 === 0 ? 1 : 0, 1.8);
        }
      };
      const appear = (variant, x = m.x, y = m.y) => {
        if (pres.state === 'shown' || pres.state === 'in') return false;
        const v = PRES[variant] ? variant : 'materialize';
        x = clamp(x, R * 1.5, EW - R * 1.5); y = clamp(y, R * 1.6, EH - R * 1.5);
        Object.assign(pres, { state: 'in', u: 0, v, tx: x, ty: y, landed: false, launched: false, crouched: false });
        act = null;
        teleport(x, v === 'drop' ? -R * 2.4 : y);
        face.set(v === 'drop' ? 'surprised' : null, v === 'drop' ? 0.7 : 0);
        S(PRES[v].sIn);
        return true;
      };
      const vanish = (variant, instant = false) => {
        if (instant) { Object.assign(pres, { state: 'hidden', u: 1 }); act = null; pending = null; parts.length = 0; m.dragging = false; return true; }
        if (pres.state === 'hidden' || pres.state === 'out') return false;
        const v = PRES[variant] ? variant : 'materialize';
        Object.assign(pres, { state: 'out', u: 0, v, tx: m.x, ty: m.y, landed: false, launched: false, crouched: false });
        act = null; pending = null; m.mode = 'rest'; m.vx = m.vy = 0; m.dragging = false; m.flung = false;
        if (PRES[v].sOut) S(PRES[v].sOut);
        if (v === 'materialize') face.set('happy', 0.5);
        return true;
      };
      // Front of the materialize dissolve, shared by the mask and the particle spray.
      const front = () => (pres.state === 'in' ? pres.u * 1.25 - 0.1 : pres.u * 1.2 - 0.05);
      // Keep the goo tail in a tight streak behind a fast vertical move instead of lagging into lobes.
      const streak = (dir) => tail.forEach((q, i) => { q.x = m.x; q.y = m.y + dir * (i + 1) * R * 0.16; q.vx = 0; q.vy = 0; });
      const presStep = (dt) => {
        const p = pres, D = PRES[p.v], u = (p.u = Math.min(1, p.u + dt / (p.state === 'in' ? D.in : D.out)));
        if (p.v === 'drop' && p.state === 'in') {
          const fall = 0.58;
          if (u < fall) {
            const k = u / fall, y0 = -R * 2.4, ny = y0 + (p.ty - y0) * k * k;
            m.y = ny; m.x = p.tx; m.ang = Math.PI / 2; m.stretch = 0.12 + k * 0.38;
            streak(-1);
            if (k > 0.15 && Math.random() < dt * 40) spawn(m.x + rand(-0.4, 0.4) * R, m.y - R * 1.2, rand(-20, 20), rand(-60, -10), 0, L - 1, 0, 2.6);
          } else if (!p.landed) {
            p.landed = true; m.y = p.ty; m.ang = 0; m.stretch = 0; streak(0); sq.kick(26); S('land'); dust(m.x, m.y + R * 0.92, 18); face.set('happy', 0.9);
          }
        } else if (p.v === 'drop') {
          const crouch = 0.3;
          if (u < crouch) {
            m.ang = 0; streak(0); if (!p.crouched) { p.crouched = true; sq.kick(12); face.set('happy', 1); }
          } else {
            if (!p.launched) { p.launched = true; S('jump'); dust(m.x, m.y + R * 0.92, 12); }
            const k = (u - crouch) / (1 - crouch), y1 = -R * 3.2;
            m.y = p.ty + (y1 - p.ty) * Math.pow(k, 1.6); m.ang = Math.PI / 2; m.stretch = 0.18 + k * 0.32;
            streak(1);
            if (Math.random() < dt * 50) spawn(m.x + rand(-0.4, 0.4) * R, m.y + R * 1.1, rand(-20, 20), rand(10, 60), 0, L - 1, 0, 2.6);
          }
        } else {
          m.stretch = Roamie.damp(m.stretch, 0, 8, dt);
          if (p.v === 'materialize' && p.state === 'in' && u < 0.7) {
            // sparks converge on the body from a ring around it
            for (let i = 0; i < Math.ceil(dt * 90); i++) {
              const a = rand(0, Math.PI * 2), r0 = R * rand(1.6, 2.4), sp = r0 / 0.42;
              spawn(m.x + Math.cos(a) * r0, m.y + Math.sin(a) * r0, -Math.cos(a) * sp, -Math.sin(a) * sp, 0, rand(0, 1) < 0.6 ? L : L - 1, 0, 2.4);
            }
          }
          if (p.v === 'materialize' && p.state === 'out' && u > 0.04 && u < 0.95) {
            // pixels lift off the dissolving front and float up
            const fy = m.y - R * 1.3 + clamp(front(), 0, 1) * R * 2.7;
            for (let i = 0; i < Math.ceil(dt * 120); i++) spawn(m.x + rand(-1, 1) * R * 0.95, fy + rand(-0.1, 0.1) * R, rand(-25, 25), rand(-210, -70), -180, rand(0, 1) < 0.55 ? L : L - 1, 0, 1.5);
          }
        }
        if (u >= 1) {
          if (p.state === 'in') {
            p.state = 'shown'; m.y = p.ty; m.x = p.tx; m.vx = m.vy = 0; m.ang = 0; m.mode = 'rest'; m.rest = 1.5;
            if (p.v !== 'drop') sq.kick(p.v === 'crt' ? 5 : 10);
            nextAct = rand(4, 7);
          } else { p.state = 'hidden'; parts.length = 0; }
        }
      };
      // CRT: scale the finished frame around the body; returns null when not playing.
      const crtXform = () => {
        if (pres.v !== 'crt' || (pres.state !== 'in' && pres.state !== 'out')) return null;
        const u = pres.u;
        if (pres.state === 'in') {
          if (u < 0.28) { const a = smooth(u / 0.28); return { sx: a * 1.25, sy: 0.03, line: 1, flash: 1, dot: 0 }; }
          if (u < 0.75) { const b = smooth((u - 0.28) / 0.47); return { sx: 1.25 - 0.29 * b, sy: 0.03 + 1.11 * b, line: 1 - b, flash: 1 - b * 0.7, dot: 0 }; }
          const c = smooth((u - 0.75) / 0.25); return { sx: 0.96 + 0.04 * c, sy: 1.14 - 0.14 * c, line: 0, flash: 0.3 * (1 - c), dot: 0 };
        }
        if (u < 0.42) { const a = smooth(u / 0.42); return { sx: 1 + 0.3 * a, sy: 1 - 0.97 * a, line: a, flash: a * 0.9, dot: 0 }; }
        if (u < 0.78) { const b = smooth((u - 0.42) / 0.36); return { sx: 1.3 * (1 - b), sy: 0.03, line: 1, flash: 0.9, dot: b }; }
        const c = (u - 0.78) / 0.22; return { sx: 0, sy: 0.03, line: 0, flash: 0, dot: 1 - c };
      };

      // Plugins (the agent layer) get the kit's drawing helpers and can drive the pose.
      const kit = {
        o, m, face, sq, hands, PAL, L, th, put, disc, line, setPx, spawn, S, startAct,
        get P() { return P; }, get R() { return R; }, get gw() { return gw; }, get gh() { return gh; }, get t() { return t; },
        get busy() { return !!act; },
        appear, vanish,
        stopAct: () => { if (act) { act = null; nextAct = rand(3, 6); } },
        get presence() { return pres.state; }, get presU() { return pres.u; },
      };
      const plug = o.plugin ? o.plugin(kit) : null;
      let pose = null;

      return {
        mover: m, face, agent: plug?.api, appear, vanish,
        get hidden() { return pres.state === 'hidden' || pres.state === 'out'; },
        hit: (x, y) => !!plug?.hit?.(x, y),
        press: (x, y) => plug?.press?.(x, y),
        wheel: (dy) => plug?.wheel?.(dy),
        resize(env) {
          const S = Roamie.unit(env);
          const base = (S / 110) * (o.pixel ?? 1);
          P = K > 1 ? K * Math.max(1, Math.round(base / K)) : Math.max(o.pixel < 1 ? 2 : 3, Math.round(base));
          gw = Math.ceil(env.w / P); gh = Math.ceil(env.h / P);
          IW = gw * K; IH = gh * K;
          off.width = IW; off.height = IH; img = octx.createImageData(IW, IH);
          if (bloom) { bloom.width = Math.ceil(gw / 4); bloom.height = Math.ceil(gh / 4); }
          R = clamp(S * 0.15, 28, 140); m.radius = R * (o.ears || o.antenna ? 1.35 : 1.25);
        },
        boop() { sq.kick(11); S('boop'); if (ant) ant.forEach((p, i) => { p.vx += rand(-1, 1) * 260 * i; }); if (!forced) startAct('hype', true); },
        grab() { S('grab'); },
        tap() { S('pip'); },
        bonk() { sq.kick(16); S('bonk'); if (!forced) pending = 'upset'; for (let i = 0; i < 6; i++) drips.push({ x: m.x, y: m.y, vx: rand(-260, 260), vy: rand(-300, 60), r: R * rand(0.12, 0.22), rMax: 0, hold: 0, life: 1 }); },
        update(dt, env) {
          t += dt;
          EW = env.w; EH = env.h;
          if (pres.state === 'hidden') { plug?.update?.(dt, env); return; }
          const performing = pres.state === 'in' || pres.state === 'out';
          if (performing) presStep(dt); else m.update(dt, env);
          sq.update(dt);
          let px = m.x, py = m.y;
          tail.forEach((s, i) => { spring(s, px, py, 70 - i * 14, 8, dt); px = s.x; py = s.y; });
          if (forced && !act) startAct(forced);
          if (pending && !m.flung && !m.dragging && pres.state === 'shown') { const n = pending; pending = null; startAct(n); }
          if (act && m.dragging) act = null;
          if (act) {
            act.a += dt;
            m.mode = 'rest'; m.rest = Math.max(m.rest, 0.3);
            if (act.a >= act.dur) { act = null; m.rest = rand(0.4, 1.2); nextAct = rand(2.5, 5); }
          } else if (!performing && !plug?.busy?.() && env.sleepy < 0.5 && !m.dragging && !m.flung && (nextAct -= dt) <= 0) {
            startAct(ACTS[actIdx++ % ACTS.length]);
          }
          const A = act?.name, a = act?.a ?? 0;
          // A speech bubble is up: keep the gesture, skip the confetti, steam and flames, hop lower.
          const calm = !!plug?.calm?.();
          let tl = [-0.55, 0.2], tr = [0.55, 0.2];
          ox = 0; oy = 0;
          if (A === 'wave') {
            tr = [1.05 + 0.16 * Math.sin(a * 13), -0.62 + 0.05 * Math.cos(a * 13)]; tl = [-1.0, 0.32];
            face.set('happy', 0.15);
          } else if (A === 'hype') {
            const p = Math.sin(a * 10);
            tr = [0.92, -0.95 - 0.3 * Math.max(0, p)]; tl = [-0.92, -0.95 - 0.3 * Math.max(0, -p)];
            const hop = Math.abs(Math.sin(a * 6.5));
            oy = -hop * R * (calm ? 0.1 : 0.26);
            if (hop < 0.12 && prevHop >= 0.12) { sq.kick(6); S('hop'); }
            prevHop = hop;
            face.set('happy', 0.15);
            if (!calm && Math.random() < dt * 30) spawn(m.x + rand(-R, R), m.y - R * 1.1 + oy, rand(-130, 130), rand(-280, -120), 540, [L, L - 1, 1][(Math.random() * 3) | 0], 0, 0.8);
          } else if (A === 'remind') {
            let dx = 1, dy = 0.3;
            if (env.mouse.active) { dx = env.mouse.x - m.x; dy = env.mouse.y - m.y; }
            const dd = Math.hypot(dx, dy) || 1, jab = 1.18 + 0.2 * Math.max(0, Math.sin(a * 11));
            const point = [(dx / dd) * jab, (dy / dd) * jab * 0.8], hip = [-Math.sign(dx || 1) * 0.98, 0.36];
            if (dx >= 0) { tr = point; tl = hip; } else { tl = point; tr = hip; }
            if (Math.sin(a * 11) > 0.97) sq.kick(1.5);
          } else if (A === 'upset') {
            tl = [0.36, 0.56]; tr = [-0.36, 0.62];
            const burst = a % 0.9 < 0.32;
            ox = burst ? Math.sin(a * 48) * R * 0.05 : 0;
            if (burst && !act.stomped) { sq.kick(8); act.stomped = true; S('stomp'); }
            if (!burst) act.stomped = false;
            if (!calm && Math.random() < dt * 16) { const s = Math.random() < 0.5 ? -1 : 1; spawn(m.x + s * R * 0.55, m.y - R * 0.8, s * rand(10, 45), rand(-120, -60), -25, Math.max(1, L - 1), 1, 1.1); }
          } else if (A === 'motivate') {
            const p = Math.max(0, Math.sin(a * 8));
            tr = [0.95, -0.82 - 0.32 * p]; tl = [-0.6, 0.32];
            oy = -p * R * 0.07;
            if (!calm && Math.random() < dt * 14) spawn(m.x + rand(-R * 1.15, R * 1.15), m.y + R * rand(0, 0.7), 0, rand(-170, -80), -30, L, 2, 0.9);
          }
          pose = m.dragging || performing ? null : plug?.pose?.(dt, env) ?? null;
          if (pose) {
            act = null;
            if (pose.tl) tl = pose.tl;
            if (pose.tr) tr = pose.tr;
            ox = pose.ox ?? 0; oy = pose.oy ?? 0;
          }
          arms = Roamie.damp(arms, act ? 1 : pose?.arms ?? 0, act || pose?.arms ? 10 : 6, dt);
          for (const h of hands) { const tg = h.s < 0 ? tl : tr; spring(h, m.x + ox + tg[0] * R, m.y + oy + tg[1] * R, 150, 13, dt); }
          for (let i = parts.length - 1; i >= 0; i--) {
            const q = parts[i]; q.vy += q.g * dt; q.vx *= 0.985; q.x += q.vx * dt; q.y += q.vy * dt; q.life -= dt * q.rate;
            if (q.life <= 0) parts.splice(i, 1);
          }
          for (const e of ears) spring(e, m.x + ox + e.s * R * 0.68, m.y + oy - R * 1.12 * (1 - sq.x * 0.03), 70, 7, dt);
          if (ant) {
            const seg = R * 0.16;
            ant[0].x = m.x + ox + R * 0.1; ant[0].y = m.y + oy - R * 0.86 * (1 - sq.x * 0.03); ant[0].vx = ant[0].vy = 0;
            for (let i = 1; i < ant.length; i++) spring(ant[i], ant[i - 1].x, ant[i - 1].y - seg, 120 - i * 14, 6, dt);
          }
          if (o.drip && (dripT -= dt) <= 0) {
            dripT = rand(0.5, 1.4);
            drips.push({ ox: rand(-0.4, 0.4) * R, x: m.x, y: m.y, vx: 0, vy: 0, r: 0, rMax: R * rand(0.13, 0.19), hold: 0.55, life: 1 });
          }
          for (let i = drips.length - 1; i >= 0; i--) {
            const q = drips[i];
            if (q.hold > 0) {
              q.hold -= dt;
              const k = 1 - q.hold / 0.55;
              q.r = q.rMax * Math.min(1, k * 1.6);
              q.x = m.x + q.ox; q.y = m.y + R * (0.62 + k * 0.42);
              if (q.hold <= 0) { q.vx = m.vx * 0.4; q.vy = m.vy * 0.4 + 40; }
              continue;
            }
            q.life -= dt * 0.6; q.vy += 500 * dt; q.vx *= 0.98; q.x += q.vx * dt; q.y += q.vy * dt;
            if (q.y > env.h - q.r) { q.y = env.h - q.r; q.vy *= -0.3; }
            if (q.life <= 0) drips.splice(i, 1);
          }
          if (pres.state === 'shown' && pres.u >= 1 && m.flung && !wasFlung) S('whoosh');
          wasFlung = m.flung;
          const asleep = env.sleepy > 0.5;
          if (!performing) {
            if (asleep !== wasAsleep) { S(asleep ? 'yawn' : 'wake'); snoreT = 3; wasAsleep = asleep; }
            else if (asleep && (snoreT -= dt) <= 0) { S('snore'); snoreT = 3.6; }
          }
          face.update(dt, env, m.x, m.y, m);
          plug?.update?.(dt, env);
        },
        draw(ctx, env) {
          if (!img || pres.state === 'hidden') return;
          d = img.data; clear = !!env.transparent;
          const performing = pres.state === 'in' || pres.state === 'out';
          // During drop/jump the shadow stays on the floor and grows or shrinks with height.
          const dropping = performing && pres.v === 'drop';
          const shX = dropping ? pres.tx : m.x, shY = dropping ? pres.ty : m.y;
          const shK = dropping ? clamp(1 - Math.abs(m.y - pres.ty) / (pres.ty + R * 2.4), 0, 1) : 1;
          const ca = Math.cos(m.ang), sa = Math.sin(m.ang);
          const st = m.stretch, sqx = 1 + sq.x * 0.05;
          const bx = m.x + ox, by = m.y + oy;
          const balls = [{ x: bx, y: by, r: R * (1 + Math.sin(t * 2.4) * 0.03) }];
          tail.forEach((s, i) => balls.push({ x: s.x, y: s.y, r: R * (0.75 - i * 0.16) }));
          for (const e of ears) balls.push({ x: e.x, y: e.y, r: R * 0.3 });
          if (ant) balls.push({ x: ant[ant.length - 1].x, y: ant[ant.length - 1].y, r: R * 0.17 });
          drips.forEach((q) => balls.push({ x: q.x, y: q.y, r: q.r * Math.min(1, q.life * 2) }));
          for (const b of balls) b.r2 = b.r * b.r;
          const lx = -0.5, ly = -0.65, lz = 0.57;
          let gx0 = 0, gx1 = gw, gy0 = 0, gy1 = gh;
          if (clear) {
            d.fill(0);
            let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
            for (const b of balls) { const e = b.r * 1.8 + R * 0.3; x0 = Math.min(x0, b.x - e); y0 = Math.min(y0, b.y - e); x1 = Math.max(x1, b.x + e); y1 = Math.max(y1, b.y + e); }
            y1 = Math.max(y1, shY + R * 1.7);
            if (dropping) { x0 = Math.min(x0, shX - R * 1.5); x1 = Math.max(x1, shX + R * 1.5); y0 = Math.min(y0, shY + R * 0.6); }
            gx0 = clamp(Math.floor(x0 / P), 0, gw); gx1 = clamp(Math.ceil(x1 / P), 0, gw);
            gy0 = clamp(Math.floor(y0 / P), 0, gh); gy1 = clamp(Math.ceil(y1 / P), 0, gh);
          }
          mask = null;
          if (performing && pres.v === 'materialize') {
            const e = front(), entering = pres.state === 'in', top = by - R * 1.3, H2 = R * 2.7, R2 = R * 1.4;
            mask = entering
              ? (gx, gy) => { const v = 0.55 * th(gx, gy) + 0.45 * clamp(Math.hypot((gx + 0.5) * P - bx, (gy + 0.5) * P - by) / R2, 0, 1); return v < e ? (v > e - 0.14 ? 2 : 1) : 0; }
              : (gx, gy) => { const v = 0.5 * th(gx, gy) + 0.5 * clamp(((gy + 0.5) * P - top) / H2, 0, 1); return v < e ? 0 : v < e + 0.12 ? 2 : 1; };
          }
          for (let gy = gy0; gy < gy1; gy++) {
            const y = (gy + 0.5) * P;
            for (let gx = gx0; gx < gx1; gx++) {
              const x = (gx + 0.5) * P;
              let f = 0, nx = 0, ny = 0;
              for (let i = 0; i < balls.length; i++) {
                const b = balls[i];
                let dx = x - b.x, dy = y - b.y;
                if (i === 0) {
                  let u = dx * ca + dy * sa, v = -dx * sa + dy * ca;
                  u /= (1 + st * 0.6) * sqx; v /= (1 - st * 0.3) / sqx;
                  dx = u * ca - v * sa; dy = u * sa + v * ca;
                }
                const q = dx * dx + dy * dy + 1, val = b.r2 / q;
                f += val; const g = (2 * val) / q; nx += dx * g; ny += dy * g;
              }
              let v;
              if (f > 1 && f < 1.18) {
                v = -1;
              } else if (f > 1) {
                const gl = Math.hypot(nx, ny);
                let Nx = nx / (gl + 1e-6), Ny = ny / (gl + 1e-6);
                const flat = 1 / (1 + gl * R * 0.5);
                Nx *= 1 - flat; Ny *= 1 - flat;
                const Nz = Math.sqrt(Math.max(0, 1 - Nx * Nx - Ny * Ny));
                const lam = clamp(Nx * lx + Ny * ly + Nz * lz, 0, 1);
                v = 0.38 + lam * 0.62 + Math.pow(lam, 24) * 0.6;
              } else {
                const shadow = shK * Math.exp(-((y - (shY + R * 1.15)) ** 2) / (R * R * 0.05) - ((x - shX) ** 2) / (R * R * 0.9 * (0.4 + 0.6 * shK)));
                if (clear) {
                  if (shadow * 0.85 > th(gx, gy)) setPx(gx, gy, PAL[0], 220);
                  continue;
                }
                const vx = x / env.w - 0.5, vy = y / env.h - 0.45;
                v = clamp(0.3 - Math.hypot(vx, vy) * 0.62 - shadow * 0.4, 0, 0.3);
              }
              setPx(gx, gy, PAL[v < 0 ? 0 : clamp(Math.floor(v * L + th(gx, gy)), 0, L)]);
            }
          }
          if (ant) {
            for (let i = 1; i < ant.length - 1; i++) line(ant[i - 1].x, ant[i - 1].y, ant[i].x, ant[i].y, Math.ceil(L / 2));
            if (Math.sin(t * 5) > 0.6) { const tip = ant[ant.length - 1]; put(Math.round(tip.x / P), Math.round(tip.y / P), L); }
          }
          for (const e of ears) disc(Math.round((e.x - e.s * R * 0.03) / P), Math.round((e.y + R * 0.02) / P), Math.max(1, Math.round((R * 0.13) / P)), Math.max(1, Math.round((R * 0.13) / P)), Math.max(1, L - 2));
          const cx = Math.round((bx + face.lookX * R * 0.18) / P), cy = Math.round((by - R * 0.1 + face.lookY * R * 0.12) / P);
          const eye = o.eye === 'cyclops' ? eyeCyclops : o.eye === 'visor' ? eyeVisor : eyesPixel;
          const A = act?.name;
          browAt = [];
          const my = eye(cx, cy);
          mouth(cx, my, pose?.mouth ?? (act && { wave: null, hype: 'shout', remind: 'o', upset: 'frown', motivate: 'grin' }[A]));
          const brow = pose ? pose.brow : A === 'upset' ? 'angry' : A === 'motivate' ? 'determined' : A === 'remind' ? 'raised' : null;
          if (brow) for (const b of browAt) drawBrow(b, brow);
          plug?.gridUnder?.(env);
          drawHands(bx, by);
          mask = null;
          for (const q of parts) {
            const gx = Math.round(q.x / P), gy = Math.round(q.y / P);
            if (q.size === 1) disc(gx, gy, q.life > 0.5 ? 1 : 0, q.life > 0.5 ? 1 : 0, q.lvl);
            else if (q.size === 2 && q.life > 0.45) { put(gx, gy, q.lvl); put(gx - 1, gy, q.lvl - 1); put(gx + 1, gy, q.lvl - 1); put(gx, gy - 1, q.lvl - 1); put(gx, gy + 1, q.lvl - 1); }
            else put(gx, gy, q.lvl);
          }
          if (act && act.a > 0.18 && act.a < act.dur - 0.15 && !plug?.calm?.()) {
            const icon = { wave: 'heart', hype: 'bolt', remind: act.a % 1.2 < 0.6 ? 'excl' : 'clock', upset: 'anger', motivate: 'flame' }[A];
            const side = A === 'remind' && hands[0].x > hands[1].x - R ? -1 : 1;
            const sf = env.safe ?? {}, top = Math.ceil(((sf.top ?? 0) + R * 0.9) / P);
            const gx = clamp(Math.round((bx + side * R * 0.95) / P), Math.ceil(((sf.left ?? 0) + R * 0.4) / P), Math.floor((env.w - (sf.right ?? 0) - R * 0.4) / P));
            const gy = Math.max(top, Math.round((by - R * 1.3) / P) - Math.round(Math.abs(Math.sin(act.a * 6))));
            bubble(gx, gy, icon);
          }
          plug?.gridOver?.(env);

          octx.putImageData(img, 0, 0);
          ctx.imageSmoothingEnabled = false;
          const crt = crtXform();
          if (crt) {
            ctx.save();
            ctx.translate(bx, by); ctx.scale(Math.max(crt.sx, 0.0001), crt.sy); ctx.translate(-bx, -by);
          }
          if (!crt || crt.sx > 0.01) ctx.drawImage(off, 0, 0, gw * P, gh * P);
          if (crt && crt.flash > 0.01 && crt.sx > 0.01) {
            // over-exposed tube warming up / cooling down
            ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = crt.flash * 0.85;
            ctx.drawImage(off, 0, 0, gw * P, gh * P); ctx.restore();
          }
          if (bloom && (!crt || crt.sx > 0.01)) {
            bctx.clearRect(0, 0, bloom.width, bloom.height);
            bctx.imageSmoothingEnabled = true;
            bctx.drawImage(off, 0, 0, bloom.width, bloom.height);
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = o.glow;
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(bloom, 0, 0, gw * P, gh * P);
            ctx.restore();
          }
          if (crt) {
            ctx.restore();
            const hot = `rgb(${PAL[L].join(',')})`, glow = `rgb(${PAL[L - 1].join(',')})`;
            ctx.save(); ctx.globalCompositeOperation = 'lighter';
            if (crt.line > 0.01 && crt.sx > 0.01) {
              const w = R * 2.1 * crt.sx, h = Math.max(2, P * 0.9);
              ctx.shadowColor = glow; ctx.shadowBlur = P * 4; ctx.globalAlpha = crt.line; ctx.fillStyle = hot;
              ctx.fillRect(bx - w / 2, by - h / 2, w, h);
            }
            if (crt.dot > 0.01) {
              const r = P * (0.6 + 1.6 * crt.dot);
              ctx.shadowColor = glow; ctx.shadowBlur = P * 6 * crt.dot; ctx.globalAlpha = Math.min(1, crt.dot * 1.4); ctx.fillStyle = hot;
              ctx.fillRect(bx - r, by - r, r * 2, r * 2);
            }
            ctx.restore();
          }
          plug?.over?.(ctx, env);
          if (o.grid && !clear) {
            ctx.fillStyle = o.grid;
            for (let x = 0; x < env.w; x += P) ctx.fillRect(x, 0, 1, env.h);
            for (let y = 0; y < env.h; y += P) ctx.fillRect(0, y, env.w, 1);
          }
        },
      };
    },
  });

  Roamie.register(Roamie.ditherKit({
    id: 'dither', label: 'Dither blob', bg: '#0f380f',
    pal: [[15, 56, 15], [48, 98, 48], [139, 172, 15], [155, 188, 15]],
    grid: 'rgba(15,56,15,0.18)',
  }));
})();
