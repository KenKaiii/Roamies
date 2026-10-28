// ASCII medusa: a pulsing glyph bell with verlet tentacles. Each contraction pushes it forward.
Roamie.register({
  id: 'ascii-medusa',
  label: 'ASCII medusa',
  bg: 'radial-gradient(130% 100% at 50% 20%, #04263a 0%, #010a12 70%)',
  create(env) {
    const { TAU, clamp, rand } = Roamie;
    const m = new Roamie.Mover(env, { speed: 70, accel: 1.4, curiosity: 0.35, margin: 0.25 });
    const face = new Roamie.Face();
    const RAMP = ' .:-~=+*o#%@';
    const BELL = ['#0a5872', '#1394b8', '#38d6ff', '#9fecff', '#e8fbff'];
    const NT = 9, LT = 16;
    let R = 50, cw = 8, ch = 12, cols = 0, rows = 0, t = 0, phase = 0, c = 0, kicked = false;
    const tent = Array.from({ length: NT }, (_, k) => Array.from({ length: k === 4 || k === 5 ? 11 : LT }, () => ({ x: m.x, y: m.y, px: m.x, py: m.y })));
    const plankton = Array.from({ length: 60 }, () => ({ x: Math.random(), y: Math.random(), z: rand(0.3, 1), p: rand(0, TAU) }));
    const geo = { bw: 50, bh: 40, rim: 0 };
    const segLen = () => R * 0.16;
    return {
      mover: m, face,
      resize(env) {
        const S = Roamie.unit(env);
        R = clamp(S * 0.17, 30, 160); m.radius = R;
        cw = Math.max(6, S / 64); ch = cw * 1.5;
        cols = Math.ceil(env.w / cw); rows = Math.ceil(env.h / ch);
        tent.forEach((L) => L.forEach((p, i) => { p.x = p.px = m.x; p.y = p.py = m.y + i * segLen(); }));
      },
      boop() { phase = Math.PI * 0.5; for (const L of tent) for (const p of L) { p.px -= rand(-6, 6); } },
      bonk() { for (const L of tent) for (const p of L) { p.px += rand(-12, 12); p.py += rand(-12, 12); } },
      update(dt, env) {
        t += dt;
        m.update(dt, env);
        phase += dt * (2.2 + m.speed / 60);
        c = Math.pow(Math.max(0, Math.sin(phase)), 3);
        if (c > 0.6 && !kicked) {
          kicked = true;
          const dx = m.tx - m.x, dy = m.ty - m.y, d = Math.hypot(dx, dy);
          if (m.mode === 'go' && d > 20) { m.vx += (dx / d) * 70; m.vy += (dy / d) * 70; }
        } else if (c < 0.1) kicked = false;
        geo.bw = R * (1 - 0.2 * c);
        geo.bh = R * 0.78 * (1 + 0.14 * c);
        geo.rim = m.y + R * 0.18;
        const sl = segLen();
        tent.forEach((L, k) => {
          const u = (k / (NT - 1)) * 2 - 1;
          const inner = k === 4 || k === 5;
          L[0].x = m.x + u * geo.bw * (inner ? 0.18 : 0.82);
          L[0].y = geo.rim - (inner ? R * 0.05 : Math.abs(u) * R * 0.08);
          for (let i = 1; i < L.length; i++) {
            const p = L[i];
            const vx = (p.x - p.px) * 0.9, vy = (p.y - p.py) * 0.9;
            p.px = p.x; p.py = p.y;
            p.x += vx + Math.sin(t * 1.8 + i * 0.45 + k * 1.3) * 0.35;
            p.y += vy + 0.16;
          }
          for (let it = 0; it < 4; it++) {
            for (let i = 1; i < L.length; i++) {
              const a = L[i - 1], b = L[i];
              const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, diff = (d - sl * (inner ? 1.15 : 1)) / d;
              if (i === 1) { b.x -= dx * diff; b.y -= dy * diff; }
              else { a.x += dx * diff * 0.5; a.y += dy * diff * 0.5; b.x -= dx * diff * 0.5; b.y -= dy * diff * 0.5; }
            }
          }
        });
        face.update(dt, env, m.x, m.y, m);
      },
      draw(ctx, env) {
        const mono = (w, px) => `${w} ${px}px ui-monospace, SFMono-Regular, Menlo, monospace`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = mono(500, ch * 0.8);
        if (!env.transparent) for (const p of plankton) {
          const y = ((p.y - t * 0.01 * p.z) % 1 + 1) % 1;
          ctx.fillStyle = `rgba(120,220,255,${0.08 + 0.18 * p.z * (0.5 + 0.5 * Math.sin(t * 2 + p.p))})`;
          ctx.fillText(p.z > 0.8 ? '+' : '.', p.x * env.w, y * env.h);
        }

        ctx.save();
        ctx.font = mono(600, ch * 0.9);
        ctx.shadowColor = 'rgba(255,90,220,0.7)'; ctx.shadowBlur = ch * 0.6;
        tent.forEach((L, k) => {
          const inner = k === 4 || k === 5;
          for (let i = 1; i < L.length; i++) {
            const a = L[i - 1], b = L[i];
            const ang = Math.atan2(b.y - a.y, b.x - a.x);
            const s = Math.sin(ang * 2);
            let g = Math.abs(Math.cos(ang)) > 0.85 ? '~' : s > 0.45 ? '\\' : s < -0.45 ? '/' : '|';
            if (inner) g = 'S8$%'[(i + Math.floor(t * 4)) % 4];
            const f = 1 - i / L.length;
            ctx.fillStyle = inner ? `rgba(255,${180 + f * 75 | 0},${235},${0.35 + f * 0.6})` : `rgba(${200 + f * 55 | 0},${90 + f * 120 | 0},255,${0.15 + f * 0.75})`;
            ctx.fillText(g, b.x, b.y);
          }
        });
        ctx.restore();

        const { bw, bh, rim } = geo;
        const top = rim - bh;
        const buckets = BELL.map(() => []);
        const r0 = Math.max(0, Math.floor(top / ch) - 1), r1 = Math.min(rows, Math.ceil((rim + R * 0.2) / ch));
        const c0 = Math.max(0, Math.floor((m.x - bw * 1.15) / cw)), c1 = Math.min(cols, Math.ceil((m.x + bw * 1.15) / cw));
        const ex = m.x + face.lookX * bw * 0.12, ey = rim - bh * 0.42 + face.lookY * bh * 0.08;
        const eg = bw * 0.33;
        for (let r = r0; r < r1; r++) {
          const y = (r + 0.5) * ch;
          for (let cc = c0; cc < c1; cc++) {
            const x = (cc + 0.5) * cw;
            const u = (x - m.x) / bw;
            const v = (rim - y) / bh;
            const scallop = 0.08 * Math.cos(u * 18 + phase * 0.5) - 0.04;
            if (v < scallop) continue;
            const d = u * u + v * v;
            if (d > 1) continue;
            if (Math.hypot((x - (ex - eg)) / (bw * 0.13), (y - ey) / (bh * 0.15)) < 1 || Math.hypot((x - (ex + eg)) / (bw * 0.13), (y - ey) / (bh * 0.15)) < 1) continue;
            const shell = Math.pow(Math.sqrt(d), 6);
            const ang = Math.atan2(v, u);
            const clover = Math.max(0, Math.cos(ang * 4 + 0.6)) * Math.exp(-((Math.sqrt(d) - 0.45) ** 2) * 30);
            const n = Roamie.noise(cc * 0.4, r * 0.4, t * 1.2) * 0.12;
            const val = clamp(0.18 + shell * 0.75 + clover * 0.6 + n + c * 0.15, 0, 0.999);
            buckets[Math.floor(val * BELL.length)].push(x, y, RAMP[1 + Math.floor(val * (RAMP.length - 1))]);
          }
        }
        ctx.save();
        ctx.font = mono(600, ch * 0.92);
        ctx.shadowColor = 'rgba(60,210,255,0.75)'; ctx.shadowBlur = ch * 0.7;
        buckets.forEach((L, i) => { ctx.fillStyle = BELL[i]; for (let k = 0; k < L.length; k += 3) ctx.fillText(L[k + 2], L[k], L[k + 1]); });
        ctx.fillStyle = '#c8f6ff';
        for (let x = m.x - bw; x <= m.x + bw; x += cw) {
          const u = (x - m.x) / bw;
          ctx.fillText(Math.cos(u * 18 + phase * 0.5) > 0 ? 'v' : 'w', x, rim + ch * 0.2);
        }
        let eye = 'o';
        if (face.dizzy > 0.5) eye = '@'; else if (face.happy > 0.5) eye = '^'; else if (face.wide > 0.5) eye = 'O'; else if (face.open < 0.35) eye = '-'; else if (face.open < 0.7) eye = '=';
        ctx.font = mono(800, ch * 1.3);
        ctx.shadowColor = '#ffffff'; ctx.shadowBlur = ch;
        ctx.fillStyle = '#ffffff';
        ctx.fillText(eye, ex - eg, ey); ctx.fillText(eye, ex + eg, ey);
        if (face.happy > 0.5 || face.wide > 0.5) { ctx.font = mono(800, ch); ctx.fillText(face.happy > 0.5 ? 'w' : 'o', ex, ey + ch * 1.1); }
        ctx.restore();
      },
    };
  },
});
