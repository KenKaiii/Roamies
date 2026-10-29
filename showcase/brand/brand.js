// Brand art for Roamies: the app icon and the DMG installer background, drawn with the same
// LED-dither renderer as the Sidekick so they match the app exactly. Rendered headless by render.mjs.
(() => {
  const TAU = Math.PI * 2;
  const PAL = [[4, 16, 18], [14, 92, 96], [40, 196, 184], [120, 255, 226], [230, 255, 250]];
  const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

  // ---------- the Sidekick, frozen in a pose ----------
  // R: body radius in px (28..140). P: LED cell size in px (a multiple of 4 for the matrix look).
  // pose: { tl, tr: hand targets in body radii, mouth, brow } (same shape the agent layer uses).
  function sidekick({ w, h, R, P, matrix = true, glow = 0.55, mood = 'happy', look = [0, -0.1], x = w / 2, y = h / 2, pose = null }) {
    const unit = R / 0.15, pixel = (P * 110) / unit;
    const plugin = pose ? () => ({ pose: () => ({ arms: 1, ...pose }), busy: () => true }) : undefined;
    const def = Roamie.ditherKit({ id: 'brand', label: 'brand', matrix, pixel, glow, pal: PAL, plugin });
    const env = { w, h, dpr: 1, t: 0, unit, transparent: true, safe: {}, spawn: { x, y }, mouse: { x: 0, y: 0, inside: false, active: false }, sleepy: 0, reduced: true };
    const c = def.create(env);
    c.resize(env);
    const m = c.mover;
    for (let i = 0; i < 40; i++) {
      m.x = x; m.y = y; m.vx = m.vy = 0; m.mode = 'rest'; m.rest = 99;
      if (mood) c.face.set(mood, 99);
      c.face.nextBlink = 99; c.face.blinkT = -1;
      c.update(1 / 60, env);
    }
    c.face.lookX = look[0]; c.face.lookY = look[1];
    const can = document.createElement('canvas');
    can.width = w; can.height = h;
    const ctx = can.getContext('2d');
    c.draw(ctx, env);
    return { canvas: can, R: m.radius / 1.25 };
  }

  // ---------- 5x7 LED font ----------
  const F = {
    A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
    D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
    E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
    G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
    I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
    L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
    M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
    N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
    O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
    P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
    R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
    S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
    T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
    B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
    C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
    H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
    K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
    U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
    V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
    W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
    Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
    "'": ['00100', '00100', '01000', '00000', '00000', '00000', '00000'],
    '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
    ',': ['00000', '00000', '00000', '00000', '00110', '00100', '01000'],
    '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
    '?': ['01110', '10001', '00001', '00110', '00100', '00000', '00100'],
    ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  };
  // Narrow glyphs (punctuation, space) take 3 columns so lines don't look gappy.
  const NARROW = new Set(["'", '!', ',', '.', ' ']);
  const adv = (ch, gap) => (NARROW.has(ch) ? 3 : 5) + gap;
  const textWidth = (s, cell, gap = 1) => ([...s.toUpperCase()].reduce((n, ch) => n + adv(ch, gap), 0) - gap) * cell;
  // One LED per lit cell: a soft halo, the dot, a hot core. Unlit cells glow faintly, like a real panel.
  function ledText(ctx, s, x, y, { cell = 4, gap = 1, on = PAL[3], off = [10, 40, 42], halo = 0.35, dot = 0.78 } = {}) {
    const pts = [];
    let col = 0;
    for (const ch of s.toUpperCase()) {
      const g = F[ch] ?? F[' '], narrow = NARROW.has(ch), c0 = narrow ? 1 : 0, c1 = narrow ? 4 : 5;
      for (let r = 0; r < 7; r++) for (let c = c0; c < c1; c++) pts.push([x + (col + c - c0) * cell, y + r * cell, g[r][c] === '1']);
      col += adv(ch, gap);
    }
    const d = cell * dot, o = (cell - d) / 2;
    for (const [px, py, lit] of pts) if (!lit) { ctx.fillStyle = rgb(off, 0.55); ctx.fillRect(px + o, py + o, d, d); }
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const [px, py, lit] of pts) if (lit) {
      const g = ctx.createRadialGradient(px + cell / 2, py + cell / 2, 0, px + cell / 2, py + cell / 2, cell * 1.6);
      g.addColorStop(0, rgb(on, halo)); g.addColorStop(1, rgb(on, 0));
      ctx.fillStyle = g; ctx.fillRect(px - cell, py - cell, cell * 3, cell * 3);
    }
    ctx.restore();
    for (const [px, py, lit] of pts) if (lit) {
      ctx.fillStyle = rgb(on); ctx.fillRect(px + o, py + o, d, d);
      ctx.fillStyle = rgb(PAL[4], 0.9); ctx.fillRect(px + o + d * 0.2, py + o + d * 0.2, d * 0.45, d * 0.45);
    }
  }

  // ---------- shared "LED panel" surface ----------
  function panel(ctx, x, y, w, h, { cell, glowAt, glowR, dotAlpha = 0.08 }) {
    const bg = ctx.createRadialGradient(glowAt[0], glowAt[1], 0, glowAt[0], glowAt[1], Math.max(w, h) * 0.85);
    bg.addColorStop(0, '#0d2628'); bg.addColorStop(0.45, '#061517'); bg.addColorStop(1, '#020708');
    ctx.fillStyle = bg; ctx.fillRect(x, y, w, h);
    // unlit LED grid, brighter near the glow
    for (let gy = y + cell / 2; gy < y + h; gy += cell) for (let gx = x + cell / 2; gx < x + w; gx += cell) {
      const d = Math.hypot(gx - glowAt[0], gy - glowAt[1]) / glowR;
      const a = dotAlpha * (0.35 + 0.65 * Math.max(0, 1 - d * 0.8));
      ctx.fillStyle = `rgba(60,200,180,${a})`;
      ctx.fillRect(gx - cell * 0.18, gy - cell * 0.18, cell * 0.36, cell * 0.36);
    }
    // scanlines
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    for (let sy = y; sy < y + h; sy += cell / 2) ctx.fillRect(x, sy, w, Math.max(1, cell / 8));
  }
  const glowSpot = (ctx, cx, cy, r, a) => {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(70,240,210,${a})`); g.addColorStop(0.45, `rgba(30,160,150,${a * 0.35})`); g.addColorStop(1, 'rgba(10,60,60,0)');
    ctx.fillStyle = g; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.restore();
  };

  // macOS icon squircle (continuous corners), as a path.
  function squircle(ctx, x, y, s, n = 5) {
    const r = s / 2, cx = x + r, cy = y + r;
    ctx.beginPath();
    for (let i = 0; i <= 256; i++) {
      const t = (i / 256) * TAU, c = Math.cos(t), sn = Math.sin(t);
      const px = cx + r * Math.sign(c) * Math.abs(c) ** (2 / n), py = cy + r * Math.sign(sn) * Math.abs(sn) ** (2 / n);
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
  }

  // ---------- app icon ----------
  // size: output px. Small sizes use solid (non-matrix) pixels and fewer, chunkier cells so they stay readable.
  function icon(size, { mood = 'happy', look = [0.15, -0.2], pose = null } = {}) {
    const can = document.createElement('canvas'); can.width = can.height = size;
    const ctx = can.getContext('2d');
    const k = size / 1024, px0 = 100 * k, ps = 824 * k;
    // drop shadow (Apple grid: plate 824 on 1024)
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 28 * k; ctx.shadowOffsetY = 12 * k;
    squircle(ctx, px0, px0, ps); ctx.fillStyle = '#020708'; ctx.fill();
    ctx.restore();
    ctx.save();
    squircle(ctx, px0, px0, ps); ctx.clip();
    const small = size <= 64;
    const cell = Math.max(2, Math.round(22 * k));
    panel(ctx, px0, px0, ps, ps, { cell, glowAt: [size / 2, size * 0.47], glowR: ps * 0.6, dotAlpha: small ? 0 : 0.09 });
    glowSpot(ctx, size / 2, size * 0.53, ps * 0.48, small ? 0.55 : 0.4);
    if (small) tinyBlob(ctx, size);
    else {
      // The Sidekick, about 29 LED cells across, rendered on a 256 grid: blown up without smoothing
      // for 512/1024, drawn 1:1 at 256, and smoothly halved for 128.
      const bw = 256, scale = size / bw;
      const sk = sidekick({ w: bw, h: bw, R: bw * 0.172, P: 4, glow: 0.5, mood, look, pose, x: bw / 2, y: bw * 0.53 });
      ctx.imageSmoothingEnabled = scale < 1;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(sk.canvas, 0, 0, bw * scale, bw * scale);
    }
    // glass: top sheen and an inner rim light
    const sheen = ctx.createLinearGradient(0, px0, 0, px0 + ps * 0.55);
    sheen.addColorStop(0, 'rgba(190,255,240,0.10)'); sheen.addColorStop(1, 'rgba(190,255,240,0)');
    ctx.fillStyle = sheen; ctx.fillRect(px0, px0, ps, ps * 0.55);
    ctx.restore();
    squircle(ctx, px0 + 1.5 * k, px0 + 1.5 * k, ps - 3 * k);
    const rim = ctx.createLinearGradient(0, px0, 0, px0 + ps);
    rim.addColorStop(0, 'rgba(160,255,230,0.42)'); rim.addColorStop(0.25, 'rgba(120,230,210,0.06)'); rim.addColorStop(1, 'rgba(120,230,210,0.12)');
    ctx.strokeStyle = rim; ctx.lineWidth = Math.max(1, 3 * k); ctx.stroke();
    return can;
  }

  // 16-64 px: dithered LEDs turn to noise this small, so draw a clean glowing blob with two eyes.
  function tinyBlob(ctx, size) {
    const cx = size / 2, cy = size * 0.53, r = size * 0.27;
    const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.45, r * 0.1, cx, cy, r);
    g.addColorStop(0, rgb(PAL[4])); g.addColorStop(0.35, rgb(PAL[3])); g.addColorStop(0.8, rgb(PAL[2])); g.addColorStop(1, rgb(PAL[1]));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
    const e = Math.max(1, Math.round(size * 0.07)), gap = Math.max(e + 1, Math.round(size * 0.1));
    const ey = Math.round(cy - r * 0.12 - e / 2);
    ctx.fillStyle = rgb(PAL[0]);
    for (const sx of [-1, 1]) ctx.fillRect(Math.round(cx + sx * gap / 2 - (sx < 0 ? e : 0)), ey, e, Math.max(e, Math.round(e * 1.4)));
  }

  // ---------- DMG background ----------
  // Finder window 660x400 pt. Icons (128 pt) sit at APP and DEST; their labels fall just below.
  // The Sidekick hangs out between them, pointing at Applications and saying hi in an LED bubble.
  const DMG = { w: 660, h: 400, app: [165, 222], dest: [495, 222] };
  const LINES = ["HI! I'M SIDEKICK.", 'DROP ME IN THERE ', 'AND LET ME ROAM!'];

  // Pixel speech bubble on a 2 pt grid, matching the in-app bubbles: dark fill, lit rim, rounded corners.
  function speech(ctx, x, y, w, h, tail) {
    const g = 2, rows = Math.round(h / g), cols = Math.round(w / g);
    const inside = (c, r) => {
      const cut = [3, 2, 1, 1];
      const cx = Math.min(c, cols - 1 - c), cy = Math.min(r, rows - 1 - r);
      return !(cy < cut.length && cx < cut[cy]);
    };
    ctx.save();
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (!inside(c, r)) continue;
      const edge = !inside(c - 1, r) || !inside(c + 1, r) || !inside(c, r - 1) || !inside(c, r + 1) || r === 0 || c === 0 || r === rows - 1 || c === cols - 1;
      ctx.fillStyle = edge ? rgb(PAL[3], 0.95) : 'rgba(3,14,16,0.92)';
      ctx.fillRect(x + c * g, y + r * g, g - (edge ? 0 : 0.3), g - (edge ? 0 : 0.3));
    }
    // Stepped tail: a short wedge leaving the bottom edge at tail[0], narrowing as it goes down.
    const tx = Math.round(tail[0] / g) * g, len = tail[1];
    for (let i = 0; i < len; i++) {
      const half = len - 1 - i, py = y + h - g + (i + 1) * g;
      for (let k = -half; k <= half; k++) {
        const edge = k === -half || k === half || i === len - 1;
        ctx.fillStyle = edge ? rgb(PAL[3], 0.95) : 'rgba(3,14,16,0.92)';
        ctx.fillRect(tx + k * g - Math.round(i * 0.6) * g, py, g, g);
      }
    }
    ctx.fillStyle = 'rgba(3,14,16,0.92)';
    for (let k = -(len - 2); k <= len - 2; k++) ctx.fillRect(tx + k * g, y + h - g, g, g);
    // soft outer glow
    ctx.globalCompositeOperation = 'lighter';
    const glo = ctx.createRadialGradient(x + w / 2, y + h / 2, Math.min(w, h) * 0.3, x + w / 2, y + h / 2, Math.max(w, h) * 0.75);
    glo.addColorStop(0, 'rgba(70,240,210,0.06)'); glo.addColorStop(1, 'rgba(70,240,210,0)');
    ctx.fillStyle = glo; ctx.fillRect(x - w * 0.3, y - h * 0.5, w * 1.6, h * 2);
    ctx.restore();
  }

  // Twinkly LED sparks scattered around the edges.
  function sparks(ctx, seed, n, avoid) {
    let a = seed;
    const rnd = () => ((a = (a * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) {
      const x = 20 + rnd() * (DMG.w - 40), y = 20 + rnd() * (DMG.h - 40);
      if (avoid.some(([ax, ay, r]) => Math.hypot(x - ax, y - ay) < r)) continue;
      const big = rnd() < 0.3, c = big ? 2 : 1.4, lvl = 0.35 + rnd() * 0.55;
      ctx.fillStyle = rgb(PAL[big ? 4 : 3], lvl);
      ctx.fillRect(x - c / 2, y - c / 2, c, c);
      if (big) { ctx.fillStyle = rgb(PAL[3], lvl * 0.5); for (const [dx, dy] of [[c, 0], [-c, 0], [0, c], [0, -c]]) ctx.fillRect(x - c / 2 + dx, y - c / 2 + dy, c, c); }
    }
  }

  // Finder always draws icon labels in black and offers no setting to change it, so each label gets a lit
  // LED name plate behind it. Label centre measured from a real Finder window: icon y + 84 pt.
  const PLATE = { w: 124, h: 26, dy: 84 };
  function plate(ctx, cx, cy) {
    const g = 2, cols = PLATE.w / g, rows = PLATE.h / g, x = cx - PLATE.w / 2, y = cy - PLATE.h / 2;
    const cut = [2, 1];
    // Soft elliptical halo that reaches zero inside its own box, so it leaves no edges.
    const hr = PLATE.w * 0.72;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(cx, cy); ctx.scale(1, 0.32);
    const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, hr);
    halo.addColorStop(0, 'rgba(70,240,210,0.2)'); halo.addColorStop(0.6, 'rgba(70,240,210,0.07)'); halo.addColorStop(1, 'rgba(70,240,210,0)');
    ctx.fillStyle = halo; ctx.fillRect(-hr, -hr, hr * 2, hr * 2);
    ctx.restore();
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const ey = Math.min(r, rows - 1 - r), ex = Math.min(c, cols - 1 - c);
      if (ey < cut.length && ex < cut[ey]) continue;
      // bright top, slightly deeper bottom, like a lit panel; a faint LED dot grid inside
      const u = r / (rows - 1), col = [PAL[4][0] + (PAL[3][0] - PAL[4][0]) * u, PAL[4][1] + (PAL[3][1] - PAL[4][1]) * u, PAL[4][2] + (PAL[3][2] - PAL[4][2]) * u];
      ctx.fillStyle = rgb(col.map(Math.round));
      ctx.fillRect(x + c * g, y + r * g, g, g);
      if ((r + c) % 2 === 0 && ey > 0 && ex > 1) { ctx.fillStyle = 'rgba(0,60,55,0.07)'; ctx.fillRect(x + c * g + 0.5, y + r * g + 0.5, g - 1, g - 1); }
    }
  }

  function dmg(scale = 2) {
    const W = DMG.w * scale, H = DMG.h * scale;
    const can = document.createElement('canvas'); can.width = W; can.height = H;
    const ctx = can.getContext('2d');
    ctx.scale(scale, scale);
    panel(ctx, 0, 0, DMG.w, DMG.h, { cell: 8, glowAt: [330, 230], glowR: 380, dotAlpha: 0.1 });

    // pads under both icons
    for (const [x, y] of [DMG.app, DMG.dest]) {
      glowSpot(ctx, x, y, 110, 0.2);
      ctx.save(); ctx.translate(x, y + 52); ctx.scale(1, 0.24);
      ctx.strokeStyle = 'rgba(120,255,226,0.32)'; ctx.lineWidth = 2.4; ctx.setLineDash([2.4, 4.6]);
      ctx.beginPath(); ctx.arc(0, 0, 64, 0, TAU); ctx.stroke(); ctx.restore();
      plate(ctx, x, y + PLATE.dy);
    }
    sparks(ctx, 7, 46, [[DMG.app[0], DMG.app[1], 90], [DMG.dest[0], DMG.dest[1], 90], [330, 150, 150]]);

    // The Sidekick, pointing right at Applications with a big grin.
    const sx = 322, sy = 226, k2 = 2, bw = 170, bh = 150;
    glowSpot(ctx, sx, sy, 90, 0.24);
    const sk = sidekick({
      w: bw * k2, h: bh * k2, R: 30 * k2, P: 4, glow: 0.55, mood: 'happy', look: [1, 0.1],
      x: (bw * k2) / 2, y: (bh * k2) / 2,
      pose: { tr: [1.45, -0.05], tl: [-1.0, 0.55], mouth: 'grin' },
    });
    ctx.save(); ctx.imageSmoothingEnabled = scale !== k2;
    ctx.drawImage(sk.canvas, sx - bw / 2, sy - bh / 2, bw, bh);
    ctx.restore();

    // Speech bubble with the greeting, tail down toward the Sidekick.
    const cell = 2, lineH = 7 * cell + 7, pad = 12;
    const tw = Math.max(...LINES.map((l) => textWidth(l, cell)));
    const bubW = Math.ceil((tw + pad * 2) / 2) * 2, bubH = Math.ceil((LINES.length * lineH - 7 + pad * 2) / 2) * 2;
    const bx = Math.round((330 - bubW / 2) / 2) * 2, by = 48;
    speech(ctx, bx, by, bubW, bubH, [sx - 10, 6]);
    LINES.forEach((l, i) => ledText(ctx, l, bx + pad, by + pad + i * lineH, { cell, gap: 1, off: [8, 30, 32], halo: 0.28 }));

    // Chevrons from the app to Applications, under the pointing hand, dim to bright.
    const cy = DMG.app[1] + 34, c2 = 3.4;
    const chev = ['10000', '01000', '00100', '00010', '00100', '01000', '10000'];
    [0, 1, 2].forEach((i) => {
      const x0 = 392 + i * 15, lvl = 0.25 + i * 0.35;
      chev.forEach((row, r) => [...row].forEach((v, c) => {
        if (v !== '1') return;
        const x = x0 + c * c2, y = cy - 3.5 * c2 + r * c2;
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(x, y, 0, x, y, c2 * 1.8);
        g.addColorStop(0, `rgba(120,255,226,${0.45 * lvl})`); g.addColorStop(1, 'rgba(120,255,226,0)');
        ctx.fillStyle = g; ctx.fillRect(x - c2 * 2, y - c2 * 2, c2 * 4, c2 * 4); ctx.restore();
        ctx.fillStyle = `rgba(120,255,226,${0.3 + 0.7 * lvl})`; ctx.fillRect(x - c2 * 0.4, y - c2 * 0.4, c2 * 0.8, c2 * 0.8);
      }));
    });

    // vignette
    const v = ctx.createRadialGradient(330, 210, 170, 330, 210, 430);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, DMG.w, DMG.h);
    return can;
  }

  window.Brand = { icon, dmg, DMG, sidekick };
})();
