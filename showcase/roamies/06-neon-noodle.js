// Neon noodle: a verlet rope with a head. The body whips and coils behind it, drawn as a glowing gas tube.
Roamie.register({
  id: 'neon-noodle',
  label: 'Neon noodle',
  bg: 'radial-gradient(120% 90% at 50% 50%, #1a0a14 0%, #070306 75%)',
  create(env) {
    const { TAU, clamp, rand } = Roamie;
    const m = new Roamie.Mover(env, { speed: 150, accel: 3, curiosity: 0.5, restMin: 0.4, restMax: 1.6 });
    const face = new Roamie.Face();
    const N = 28;
    const pts = Array.from({ length: N }, () => ({ x: m.x, y: m.y, px: m.x, py: m.y }));
    let seg = 10, W = 16, t = 0, flash = 0;
    const sparks = [];
    return {
      mover: m, face,
      resize(env) {
        const S = Roamie.unit(env);
        seg = clamp(S * 0.022, 6, 22); W = clamp(S * 0.04, 9, 36); m.radius = W * 1.6;
        pts.forEach((p, i) => { p.x = p.px = m.x - i * seg; p.y = p.py = m.y; });
      },
      boop() { flash = 1; for (let i = 0; i < 24; i++) { const a = rand(0, TAU), s = rand(80, 320); sparks.push({ x: m.x, y: m.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1 }); } },
      bonk() { flash = 1; },
      update(dt, env) {
        t += dt;
        m.update(dt, env);
        flash = Math.max(0, flash - dt * 2.2);
        const wig = Math.sin(t * 9) * W * 0.5 * clamp(m.speed / 150, 0, 1);
        const head = pts[0];
        head.x = m.x + Math.cos(m.ang + Math.PI / 2) * wig * 0.3;
        head.y = m.y + Math.sin(m.ang + Math.PI / 2) * wig * 0.3;
        for (let i = 1; i < N; i++) {
          const p = pts[i];
          const vx = (p.x - p.px) * 0.94, vy = (p.y - p.py) * 0.94;
          p.px = p.x; p.py = p.y;
          p.x += vx; p.y += vy + Math.sin(t * 2 + i * 0.5) * 0.04;
        }
        for (let it = 0; it < 6; it++) {
          for (let i = 1; i < N; i++) {
            const a = pts[i - 1], b = pts[i];
            const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, diff = (d - seg) / d;
            if (i === 1) { b.x -= dx * diff; b.y -= dy * diff; }
            else { a.x += dx * diff * 0.5; a.y += dy * diff * 0.5; b.x -= dx * diff * 0.5; b.y -= dy * diff * 0.5; }
          }
          for (const p of pts) { p.x = clamp(p.x, 4, env.w - 4); p.y = clamp(p.y, 4, env.h - 4); }
        }
        for (let i = sparks.length - 1; i >= 0; i--) {
          const s = sparks[i]; s.life -= dt * 1.6; s.vx *= 0.96; s.vy *= 0.96; s.x += s.vx * dt; s.y += s.vy * dt;
          if (s.life <= 0) sparks.splice(i, 1);
        }
        face.update(dt, env, m.x, m.y, m);
      },
      draw(ctx) {
        const path = () => {
          ctx.beginPath(); ctx.moveTo(pts[N - 1].x, pts[N - 1].y);
          for (let i = N - 2; i > 0; i--) { const p = pts[i], q = pts[i - 1]; ctx.quadraticCurveTo(p.x, p.y, (p.x + q.x) / 2, (p.y + q.y) / 2); }
          ctx.lineTo(pts[0].x, pts[0].y);
        };
        ctx.save();
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.globalCompositeOperation = 'lighter';
        const hueA = `rgba(255,60,140,`, hueB = `rgba(255,190,90,`;
        path(); ctx.strokeStyle = hueA + (0.08 + flash * 0.1) + ')'; ctx.lineWidth = W * 3.4; ctx.stroke();
        path(); ctx.strokeStyle = hueA + (0.18 + flash * 0.2) + ')'; ctx.lineWidth = W * 1.9; ctx.stroke();
        const g = ctx.createLinearGradient(pts[N - 1].x, pts[N - 1].y, pts[0].x, pts[0].y);
        g.addColorStop(0, hueB + '0.9)'); g.addColorStop(1, hueA + '1)');
        path(); ctx.strokeStyle = g; ctx.lineWidth = W; ctx.stroke();
        path(); ctx.strokeStyle = 'rgba(255,240,245,0.9)'; ctx.lineWidth = W * 0.28; ctx.stroke();
        for (const s of sparks) { ctx.fillStyle = hueB + s.life + ')'; ctx.beginPath(); ctx.arc(s.x, s.y, 1.5 + s.life * 1.5, 0, TAU); ctx.fill(); }
        ctx.restore();
        const h = pts[0], n = pts[1];
        const ang = Math.atan2(h.y - n.y, h.x - n.x);
        ctx.save();
        ctx.translate(h.x, h.y); ctx.rotate(ang);
        ctx.shadowColor = 'rgba(255,60,140,0.9)'; ctx.shadowBlur = W;
        ctx.fillStyle = '#ff4d94';
        ctx.beginPath(); ctx.ellipse(W * 0.3, 0, W * 1.25, W * 1.05, 0, 0, TAU); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255,235,240,0.95)';
        ctx.beginPath(); ctx.ellipse(W * 0.3, 0, W * 0.9, W * 0.72, 0, 0, TAU); ctx.fill();
        ctx.restore();
        const upright = Math.abs(((ang + Math.PI) % TAU + TAU) % TAU - Math.PI) > Math.PI / 2 ? ang + Math.PI : ang;
        const fx = h.x + Math.cos(ang) * W * 0.35, fy = h.y + Math.sin(ang) * W * 0.35;
        Roamie.drawEyesPro(ctx, face, fx, fy - W * 0.1, W * 0.78, {
          gap: W * 0.9, lid: '#ffe3ec', lash: '#5a0f2c', socket: 'rgba(120,10,60,0.4)', rim: 'rgba(90,10,40,0.35)',
          iris: ['#ffe0f0', '#ff3d8b', '#4a0020'], tilt: 0.18, relax: 0.85, angle: upright * 0.2,
        });
        Roamie.drawMouthPro(ctx, face, fx, fy + W * 0.5, W * 0.55, { ink: '#5a0f2c', inner: '#3a0016', tongue: '#ff6a9a', rest: false });
      },
    };
  },
});
