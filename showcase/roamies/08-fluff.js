// Fluff: hundreds of fur strands on springs. Tips lag behind the body, so the coat sweeps, ripples and shakes off.
Roamie.register({
  id: 'fluff',
  label: 'Fluff',
  bg: 'radial-gradient(120% 90% at 50% 35%, #1b2630 0%, #090d11 72%)',
  create(env) {
    const { TAU, clamp, rand, lerp } = Roamie;
    const m = new Roamie.Mover(env, { speed: 105, accel: 2.4 });
    const face = new Roamie.Face();
    const sq = new Roamie.Spring(150, 7);
    const N = 1100;
    const S = Array.from({ length: N }, (_, i) => {
      const th = rand(0, TAU), root = Math.sqrt(Math.random()) * 0.78;
      return { th, root, len: rand(0.95, 1.18), curl: rand(-1, 1), x: m.x, y: m.y, vx: 0, vy: 0, k: rand(20, 42) };
    });
    S.sort((a, b) => b.root - a.root);
    const COLS = ['#2c3d4f', '#4f6a83', '#7f9cb7', '#b4cde0', '#e1eef8', '#ffffff'];
    let r = 50, t = 0, shake = 0;
    const paths = COLS.map(() => []);
    return {
      mover: m, face,
      resize(env) {
        r = clamp(Roamie.unit(env) * 0.19, 34, 170); m.radius = r * 1.05;
        for (const s of S) { s.x = m.x + Math.cos(s.th) * r * s.len; s.y = m.y + Math.sin(s.th) * r * s.len; }
      },
      boop() { sq.kick(10); shake = 1; },
      bonk() { sq.kick(14); shake = 1.5; },
      update(dt, env) {
        t += dt;
        m.update(dt, env);
        sq.update(dt);
        shake = Math.max(0, shake - dt * 1.4);
        const ca = Math.cos(m.ang), sa = Math.sin(m.ang), st = m.stretch;
        const breathe = 1 + Math.sin(t * 2.4) * 0.025;
        for (const s of S) {
          const reach = (s.root + (s.len - s.root) * (1 - s.root * 0.55)) * r * breathe;
          let bx = Math.cos(s.th) * reach, by = Math.sin(s.th) * reach;
          let u = bx * ca + by * sa, v = -bx * sa + by * ca;
          u *= 1 + st * 0.5; v *= 1 - st * 0.3;
          bx = u * ca - v * sa; by = u * sa + v * ca;
          bx *= 1 + sq.x * 0.05; by *= 1 - sq.x * 0.05;
          const wind = Roamie.noise(Math.cos(s.th) * 2, Math.sin(s.th) * 2, t * 0.8) * r * 0.06;
          const jig = shake * Math.sin(t * 40 + s.th * 7) * r * 0.08;
          const tx = m.x + bx + wind + jig * -Math.sin(s.th), ty = m.y + by + wind * 0.6 + jig * Math.cos(s.th);
          s.vx += ((tx - s.x) * s.k - s.vx * 5.5) * dt;
          s.vy += ((ty - s.y) * s.k - s.vy * 5.5) * dt;
          s.x += s.vx * dt; s.y += s.vy * dt;
        }
        face.update(dt, env, m.x, m.y, m);
      },
      draw(ctx) {
        const sh = ctx.createRadialGradient(m.x, m.y + r * 1.15, 0, m.x, m.y + r * 1.15, r);
        sh.addColorStop(0, 'rgba(0,0,0,0.55)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.save(); ctx.translate(m.x, m.y + r * 1.15); ctx.scale(1, 0.2); ctx.translate(-m.x, -(m.y + r * 1.15));
        ctx.fillStyle = sh; ctx.fillRect(m.x - r, m.y, r * 2, r * 2.3); ctx.restore();

        const core = ctx.createRadialGradient(m.x - r * 0.2, m.y - r * 0.3, 0, m.x, m.y, r * 0.95);
        core.addColorStop(0, '#7f97ad'); core.addColorStop(1, '#1d2a37');
        ctx.fillStyle = core;
        ctx.beginPath(); ctx.arc(m.x, m.y, r * 0.9, 0, TAU); ctx.fill();

        for (const p of paths) p.length = 0;
        const lx = -0.55, ly = -0.83;
        for (const s of S) {
          const dx = Math.cos(s.th), dy = Math.sin(s.th);
          const rx = m.x + dx * r * s.root, ry = m.y + dy * r * s.root;
          const ex = s.x - rx, ey = s.y - ry;
          const cxp = rx + ex * 0.5 - ey * s.curl * 0.35, cyp = ry + ey * 0.5 + ex * s.curl * 0.35;
          const light = ((s.x - m.x) / r * lx + (s.y - m.y) / r * ly) * 0.42 + 0.5 + (1 - s.root) * 0.1;
          const b = clamp(Math.floor(light * COLS.length), 0, COLS.length - 1);
          paths[b].push(rx, ry, cxp, cyp, s.x, s.y, 0);
        }
        ctx.lineCap = 'round';
        paths.forEach((P, b) => {
          if (!P.length) return;
          ctx.strokeStyle = COLS[b];
          ctx.lineWidth = Math.max(1, r * 0.022);
          ctx.beginPath();
          for (let i = 0; i < P.length; i += 7) { ctx.moveTo(P[i], P[i + 1]); ctx.quadraticCurveTo(P[i + 2], P[i + 3], P[i + 4], P[i + 5]); }
          ctx.stroke();
        });

        const fx = m.x + face.lookX * r * 0.12, fy = m.y - r * 0.02 + face.lookY * r * 0.08;
        Roamie.drawEyesPro(ctx, face, fx, fy, r * 0.42, {
          gap: r * 0.62, lid: '#c3d7e8', lash: '#1b2733', socket: 'rgba(12,20,30,0.55)', rim: 'rgba(10,18,26,0.45)',
          iris: ['#e9fff5', '#38c79a', '#063b2c'], tilt: 0.06, relax: 0.88, irisSize: 0.9,
        });
        Roamie.drawMouthPro(ctx, face, fx, fy + r * 0.42, r * 0.34, { ink: '#1b2733', inner: '#1a0b10', rest: false });
      },
    };
  },
});
