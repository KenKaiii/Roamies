// ASCII goop: a metaball slug (head, trailing tail, orbiting droplets) sampled into a character grid.
Roamie.register({
  id: 'ascii-goop',
  label: 'ASCII goop',
  bg: 'radial-gradient(130% 90% at 50% 45%, #1c1208 0%, #090604 72%)',
  create(env) {
    const { TAU, clamp, rand } = Roamie;
    const RAMP = ' .:-=+*xoO#%@';
    const BUCKETS = 8;
    const COLORS = ['#4a2208', '#7a3809', '#b45a10', '#e07a1a', '#ff9d3a', '#ffbf6e', '#ffdca6', '#fff3e0'];
    const m = new Roamie.Mover(env, { speed: 100 });
    const face = new Roamie.Face();
    const sq = new Roamie.Spring(160, 8);
    const tail = Array.from({ length: 6 }, () => ({ x: m.x, y: m.y, vx: 0, vy: 0 }));
    const drops = Array.from({ length: 4 }, (_, i) => ({ a: (i / 4) * TAU, sp: rand(0.6, 1.4) * (i % 2 ? -1 : 1), x: m.x, y: m.y, vx: 0, vy: 0 }));
    let R = 50, cw = 9, ch = 14, cols = 0, rows = 0, t = 0;
    const balls = [];

    const spring = (p, tx, ty, k, c, dt) => {
      p.vx += ((tx - p.x) * k - p.vx * c) * dt;
      p.vy += ((ty - p.y) * k - p.vy * c) * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
    };

    return {
      mover: m, face,
      resize(env) {
        const S = Roamie.unit(env);
        R = clamp(S * 0.15, 30, 150);
        m.radius = R * 1.2;
        cw = Math.max(7, S / 56); ch = cw * 1.5;
        cols = Math.ceil(env.w / cw); rows = Math.ceil(env.h / ch);
      },
      boop() {
        sq.kick(10);
        for (const d of drops) { const a = rand(0, TAU); d.vx += Math.cos(a) * 700; d.vy += Math.sin(a) * 700; }
      },
      bonk() { sq.kick(16); for (const d of drops) { d.vx += rand(-900, 900); d.vy += rand(-900, 900); } },
      update(dt, env) {
        t += dt;
        m.update(dt, env);
        sq.update(dt);
        let px = m.x, py = m.y;
        tail.forEach((s, i) => {
          spring(s, px, py, 75 - i * 7, 9, dt);
          px = s.x; py = s.y;
        });
        drops.forEach((d) => {
          d.a += dt * d.sp;
          const rr = R * (1.35 + Math.sin(t * 1.3 + d.a) * 0.2);
          spring(d, m.x + Math.cos(d.a) * rr, m.y + Math.sin(d.a) * rr, 28, 4, dt);
        });
        face.update(dt, env, m.x, m.y, m);
      },
      draw(ctx, env) {
        balls.length = 0;
        const breathe = 1 + Math.sin(t * 2) * 0.04;
        const hr = R * breathe * (1 + sq.x * 0.015);
        balls.push({ x: m.x, y: m.y, r2: hr * hr });
        tail.forEach((s, i) => { const r = R * (0.92 - i * 0.12); balls.push({ x: s.x, y: s.y, r2: r * r }); });
        drops.forEach((d) => { const r = R * 0.3; balls.push({ x: d.x, y: d.y, r2: r * r }); });

        const eyeGap = R * 0.42;
        const ex = m.x + face.lookX * R * 0.16, ey = m.y - R * 0.12 + face.lookY * R * 0.1;
        const eyes = [{ x: ex - eyeGap, y: ey }, { x: ex + eyeGap, y: ey }];
        const mouth = { x: ex, y: ey + R * 0.5 };
        const sock = (cw * 1.1) ** 2;

        ctx.font = `600 ${ch * 0.95}px ui-monospace, SFMono-Regular, Menlo, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const lists = Array.from({ length: BUCKETS + 1 }, () => []);
        for (let rIdx = 0; rIdx < rows; rIdx++) {
          const y = (rIdx + 0.5) * ch;
          for (let c = 0; c < cols; c++) {
            const x = (c + 0.5) * cw;
            let f = 0;
            for (let b = 0; b < balls.length; b++) {
              const B = balls[b], dx = x - B.x, dy = y - B.y;
              f += B.r2 / (dx * dx + dy * dy + 1);
            }
            f += Roamie.noise(c * 0.35, rIdx * 0.35, t * 1.4) * 0.09;
            if (f < 0.6) {
              if (f > 0.3 && (c + rIdx) % 2 === 0) lists[BUCKETS].push(x, y, f > 0.45 ? ':' : '.');
              continue;
            }
            let carve = false;
            for (const e of eyes) if ((x - e.x) ** 2 + (y - e.y) ** 2 < sock) carve = true;
            if ((x - mouth.x) ** 2 + (y - mouth.y) ** 2 < sock * 0.6) carve = true;
            if (carve) continue;
            const n = clamp((f - 0.6) / 2.4, 0, 0.999);
            const ch_ = RAMP[1 + Math.floor(n * (RAMP.length - 1))] || '@';
            lists[Math.floor(n * BUCKETS)].push(x, y, ch_);
          }
        }
        for (let b = 0; b <= BUCKETS; b++) {
          const L = lists[b];
          if (!L.length) continue;
          ctx.fillStyle = b === BUCKETS ? 'rgba(255,150,60,0.35)' : COLORS[b];
          for (let i = 0; i < L.length; i += 3) ctx.fillText(L[i + 2], L[i], L[i + 1]);
        }

        let eye = 'O';
        if (face.dizzy > 0.5) eye = '@';
        else if (face.happy > 0.5) eye = '^';
        else if (face.wide > 0.5) eye = '0';
        else if (face.open < 0.3) eye = '-';
        else if (face.open < 0.65) eye = '=';
        let mouthC = face.happy > 0.5 ? 'w' : face.wide > 0.5 ? 'o' : face.dizzy > 0.5 ? '~' : face.sleepy > 0.5 ? '.' : 'u';
        ctx.save();
        ctx.shadowColor = '#ffd9a0';
        ctx.shadowBlur = ch * 0.8;
        ctx.fillStyle = '#fffaf0';
        ctx.font = `800 ${ch * 1.25}px ui-monospace, SFMono-Regular, Menlo, monospace`;
        for (const e of eyes) ctx.fillText(eye, e.x, e.y);
        ctx.font = `800 ${ch * 1.05}px ui-monospace, SFMono-Regular, Menlo, monospace`;
        ctx.fillText(mouthC, mouth.x, mouth.y);
        ctx.restore();
      },
    };
  },
});
