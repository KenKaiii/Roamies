// Soft-body jelly: a ring of spring-mass points chasing a stretched rest shape, so it lags, wobbles and dents.
Roamie.register({
  id: 'jelly',
  label: 'Jelly',
  bg: 'radial-gradient(130% 90% at 50% 38%, #0f2b25 0%, #07120f 70%)',
  create(env) {
    const { TAU, clamp, rand } = Roamie;
    const N = 36;
    const m = new Roamie.Mover(env, { speed: 120 });
    const face = new Roamie.Face();
    const sq = new Roamie.Spring(150, 7);
    const pts = Array.from({ length: N }, () => ({ x: m.x, y: m.y, vx: 0, vy: 0 }));
    const nucleus = { x: m.x, y: m.y, vx: 0, vy: 0 };
    const spec = { x: m.x, y: m.y, vx: 0, vy: 0 };
    const bubbles = Array.from({ length: 4 }, (_, i) => ({ base: rand(0.25, 0.75) * Math.PI, d: rand(0.45, 0.72), s: rand(0.035, 0.07), k: rand(12, 30), x: m.x, y: m.y, vx: 0, vy: 0, ph: rand(0, TAU) }));
    let r = 60, t = 0;

    const spring = (p, tx, ty, k, c, dt) => {
      p.vx += ((tx - p.x) * k - p.vx * c) * dt;
      p.vy += ((ty - p.y) * k - p.vy * c) * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
    };

    return {
      mover: m, face,
      resize(env) {
        const first = !this.sized;
        r = clamp(Roamie.unit(env) * 0.24, 40, 190); m.radius = r;
        if (first) pts.forEach((p, i) => { const th = (i / N) * TAU; p.x = m.x + Math.cos(th) * r; p.y = m.y + Math.sin(th) * r; });
        this.sized = true;
      },
      boop(x, y) {
        sq.kick(9);
        for (const p of pts) {
          const dx = p.x - x, dy = p.y - y, d = Math.hypot(dx, dy) || 1;
          const fall = Math.exp(-(d * d) / (r * r * 0.5));
          const cx = m.x - p.x, cy = m.y - p.y, cd = Math.hypot(cx, cy) || 1;
          p.vx += (cx / cd) * 900 * fall; p.vy += (cy / cd) * 900 * fall;
        }
      },
      bonk() { sq.kick(14); for (const p of pts) { p.vx += rand(-260, 260); p.vy += rand(-260, 260); } },
      update(dt, env) {
        t += dt;
        m.update(dt, env);
        sq.update(dt);
        const st = m.stretch, ca = Math.cos(m.ang), sa = Math.sin(m.ang);
        const breathe = 1 + Math.sin(t * 2.2) * 0.025 * (1 + face.sleepy);
        const sx = (1 + sq.x * 0.06) * breathe, sy = (1 - sq.x * 0.06) / breathe;
        const steps = 2, h = dt / steps;
        for (let s = 0; s < steps; s++) {
          for (let i = 0; i < N; i++) {
            const th = (i / N) * TAU;
            const w = 1 + 0.035 * Math.sin(th * 3 + t * 2.1) + 0.025 * Math.sin(th * 5 - t * 3.3);
            let bx = Math.cos(th) * r * w, by = Math.sin(th) * r * w;
            let u = bx * ca + by * sa, v = -bx * sa + by * ca;
            u *= 1 + st * 0.8; v *= 1 - st * 0.42;
            if (u < 0) u *= 1 + st * 0.9;
            bx = (u * ca - v * sa) * sx; by = (u * sa + v * ca) * sy;
            const p = pts[i], a = pts[(i + N - 1) % N], b = pts[(i + 1) % N];
            p.vx += ((a.x + b.x) / 2 - p.x) * 30 * h;
            p.vy += ((a.y + b.y) / 2 - p.y) * 30 * h;
            spring(p, m.x + bx, m.y + by, 90, 6.5, h);
          }
        }
        spring(nucleus, m.x - m.vx * 0.03, m.y - m.vy * 0.03 + r * 0.08, 22, 3.2, dt);
        spring(spec, m.x - r * 0.5, m.y - r * 0.62, 60, 6, dt);
        for (const b of bubbles) {
          const a = b.base + Math.sin(t * 0.35 + b.ph) * 0.5;
          spring(b, m.x + Math.cos(a) * b.d * r, m.y + Math.sin(a) * b.d * r * 0.9 + Math.sin(t + b.ph) * r * 0.05, b.k, 3, dt);
        }
        let cx = 0, cy = 0;
        for (const p of pts) { cx += p.x; cy += p.y; }
        face.update(dt, env, cx / N, cy / N, m);
      },
      draw(ctx) {
        let cx = 0, cy = 0;
        for (const p of pts) { cx += p.x; cy += p.y; }
        cx /= N; cy /= N;

        const halo = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 2.6);
        halo.addColorStop(0, 'rgba(70,255,190,0.16)');
        halo.addColorStop(1, 'rgba(70,255,190,0)');
        ctx.fillStyle = halo;
        ctx.fillRect(cx - r * 3, cy - r * 3, r * 6, r * 6);

        const sh = ctx.createRadialGradient(cx, cy + r * 1.08, 0, cx, cy + r * 1.08, r * 0.95);
        sh.addColorStop(0, 'rgba(0,10,8,0.55)'); sh.addColorStop(1, 'rgba(0,10,8,0)');
        ctx.save(); ctx.translate(cx, cy + r * 1.08); ctx.scale(1, 0.22); ctx.translate(-cx, -(cy + r * 1.08));
        ctx.fillStyle = sh; ctx.fillRect(cx - r, cy, r * 2, r * 2.2); ctx.restore();

        Roamie.blobPath(ctx, pts);
        const g = ctx.createRadialGradient(cx, cy + r * 0.5, r * 0.05, cx, cy, r * 1.3);
        g.addColorStop(0, '#c4ffea');
        g.addColorStop(0.3, '#4fe6b8');
        g.addColorStop(0.68, '#15a882');
        g.addColorStop(1, '#05463b');
        ctx.fillStyle = g;
        ctx.fill();
        const top = ctx.createRadialGradient(cx - r * 0.4, cy - r * 0.55, 0, cx - r * 0.4, cy - r * 0.55, r * 1.1);
        top.addColorStop(0, 'rgba(235,255,248,0.45)'); top.addColorStop(1, 'rgba(235,255,248,0)');
        ctx.fillStyle = top; ctx.fill();

        ctx.save();
        ctx.clip();
        const ng = ctx.createRadialGradient(nucleus.x, nucleus.y, 0, nucleus.x, nucleus.y, r * 0.55);
        ng.addColorStop(0, 'rgba(4,70,58,0.55)');
        ng.addColorStop(1, 'rgba(4,70,58,0)');
        ctx.fillStyle = ng;
        ctx.fillRect(cx - r * 2, cy - r * 2, r * 4, r * 4);
        for (const b of bubbles) {
          const br = b.s * r;
          ctx.strokeStyle = 'rgba(230,255,247,0.5)'; ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.arc(b.x, b.y, br, 0, TAU); ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,0.75)';
          ctx.beginPath(); ctx.arc(b.x - br * 0.35, b.y - br * 0.35, br * 0.28, 0, TAU); ctx.fill();
        }
        Roamie.blobPath(ctx, pts);
        ctx.lineWidth = r * 0.22;
        ctx.strokeStyle = 'rgba(2,40,34,0.28)';
        ctx.stroke();
        ctx.restore();

        Roamie.blobPath(ctx, pts);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(200,255,236,0.6)';
        ctx.stroke();

        ctx.save();
        ctx.translate(spec.x, spec.y);
        ctx.rotate(-0.6);
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.beginPath(); ctx.ellipse(0, 0, r * 0.2, r * 0.08, 0, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(r * 0.27, r * 0.05, r * 0.035, 0, TAU); ctx.fill();
        ctx.restore();

        const fx = cx + Math.cos(m.ang) * r * 0.14 * Math.min(1, m.speed / 120);
        const fy = cy + Math.sin(m.ang) * r * 0.1 * Math.min(1, m.speed / 120) - r * 0.05;
        const sx = 1 + m.stretch * 0.25, sy = 1 - m.stretch * 0.15;
        Roamie.drawEyesPro(ctx, face, fx, fy - r * 0.06, r * 0.46, {
          gap: r * 0.58, lid: '#3ad9aa', lash: '#03332a', socket: 'rgba(2,48,38,0.32)', rim: 'rgba(2,40,32,0.35)',
          iris: ['#fff2bd', '#f0a02c', '#3e1600'], brow: 'rgba(3,60,48,0.7)', tilt: 0.1, relax: 0.88, irisSize: 0.84, sx, sy,
        });
        Roamie.drawMouthPro(ctx, face, fx, fy + r * 0.34, r * 0.34, { ink: '#03332a', inner: '#06231d' });
      },
    };
  },
});
