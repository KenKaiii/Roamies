// Soap bubble: a wobbly membrane with swirling thin-film colour. Boop it and it pops, then grows back.
Roamie.register({
  id: 'bubble',
  label: 'Soap bubble',
  bg: 'radial-gradient(120% 90% at 50% 30%, #1d1a24 0%, #08070b 72%)',
  create(env) {
    const { TAU, clamp, rand } = Roamie;
    const N = 48;
    const m = new Roamie.Mover(env, { speed: 65, accel: 1.2, curiosity: 0.3, margin: 0.25 });
    const face = new Roamie.Face();
    const pts = Array.from({ length: N }, () => ({ x: m.x, y: m.y, vx: 0, vy: 0 }));
    const drops = [];
    let r = 60, t = 0, grow = 1, popped = 0;
    return {
      mover: m, face,
      resize(env) {
        r = clamp(Roamie.unit(env) * 0.25, 44, 220); m.radius = r * 0.9;
        pts.forEach((p, i) => { const th = (i / N) * TAU; p.x = m.x + Math.cos(th) * r; p.y = m.y + Math.sin(th) * r; });
      },
      boop() {
        if (grow < 0.9) return;
        for (let i = 0; i < 70; i++) {
          const a = rand(0, TAU), rr = r * rand(0.85, 1.05), sp = rand(120, 520);
          drops.push({ x: m.x + Math.cos(a) * rr, y: m.y + Math.sin(a) * rr, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, h: rand(0, 360), s: rand(1, 3.2) });
        }
        grow = 0; popped = 0.35;
      },
      bonk() { for (const p of pts) { p.vx += rand(-300, 300); p.vy += rand(-300, 300); } },
      update(dt, env) {
        t += dt;
        m.update(dt, env);
        if (popped > 0) popped -= dt; else grow = Math.min(1, grow + dt * 0.7);
        const g = grow < 1 ? 1 - Math.pow(1 - grow, 3) : 1;
        const ca = Math.cos(m.ang), sa = Math.sin(m.ang), st = m.stretch;
        for (let s = 0; s < 2; s++) {
          const h = dt / 2;
          for (let i = 0; i < N; i++) {
            const th = (i / N) * TAU;
            const w = 1 + 0.03 * Math.sin(th * 2 + t * 1.3) + 0.02 * Math.sin(th * 3 - t * 1.9);
            let bx = Math.cos(th) * r * w * g, by = Math.sin(th) * r * w * g;
            let u = bx * ca + by * sa, v = -bx * sa + by * ca;
            u *= 1 + st * 0.5; v *= 1 - st * 0.25; if (u < 0) u *= 1 + st * 0.5;
            bx = u * ca - v * sa; by = u * sa + v * ca;
            const p = pts[i], a = pts[(i + N - 1) % N], b = pts[(i + 1) % N];
            p.vx += (((a.x + b.x) / 2 - p.x) * 26 + (m.x + bx - p.x) * 34 - p.vx * 3.2) * h;
            p.vy += (((a.y + b.y) / 2 - p.y) * 26 + (m.y + by - p.y) * 34 - p.vy * 3.2) * h;
            p.x += p.vx * h; p.y += p.vy * h;
          }
        }
        for (let i = drops.length - 1; i >= 0; i--) {
          const d = drops[i]; d.life -= dt * 1.3; d.vx *= 0.94; d.vy = d.vy * 0.94 + 18; d.x += d.vx * dt; d.y += d.vy * dt;
          if (d.life <= 0) drops.splice(i, 1);
        }
        face.update(dt, env, m.x, m.y, m);
      },
      draw(ctx) {
        for (const d of drops) {
          ctx.fillStyle = `hsla(${d.h},90%,75%,${d.life})`;
          ctx.beginPath(); ctx.arc(d.x, d.y, d.s * d.life + 0.5, 0, TAU); ctx.fill();
        }
        if (grow <= 0.02) return;
        const g = grow < 1 ? 1 - Math.pow(1 - grow, 3) : 1;
        const R = r * g;
        Roamie.blobPath(ctx, pts);
        const body = ctx.createRadialGradient(m.x, m.y, R * 0.2, m.x, m.y, R * 1.05);
        body.addColorStop(0, 'rgba(255,255,255,0.01)');
        body.addColorStop(0.75, 'rgba(190,210,255,0.06)');
        body.addColorStop(1, 'rgba(230,240,255,0.22)');
        ctx.fillStyle = body; ctx.fill();

        ctx.save();
        ctx.clip();
        ctx.globalCompositeOperation = 'screen';
        const film = ctx.createConicGradient(t * 0.6, m.x, m.y);
        ['#ff4fa0', '#ffd23f', '#3fffb0', '#38b6ff', '#a45bff', '#ff4fa0'].forEach((c, i, a) => film.addColorStop(i / (a.length - 1), c));
        for (let k = 0; k < 3; k++) {
          ctx.globalAlpha = 0.22 - k * 0.05;
          ctx.strokeStyle = film;
          ctx.lineWidth = R * (0.035 + k * 0.015);
          ctx.beginPath();
          for (let i = 0; i <= 60; i++) {
            const a = (i / 60) * TAU, rr = R * (0.6 + k * 0.12 + 0.12 * Math.sin(a * 3 + t * (1 + k * 0.4)));
            const x = m.x + Math.cos(a + t * 0.3 * (k % 2 ? -1 : 1)) * rr, y = m.y + Math.sin(a + t * 0.3 * (k % 2 ? -1 : 1)) * rr;
            i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          }
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        Roamie.blobPath(ctx, pts);
        ctx.strokeStyle = film; ctx.lineWidth = R * 0.22; ctx.globalAlpha = 0.5; ctx.stroke();
        ctx.lineWidth = R * 0.08; ctx.globalAlpha = 0.6; ctx.stroke();
        ctx.restore();

        Roamie.blobPath(ctx, pts);
        ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.2; ctx.stroke();
        ctx.save();
        ctx.translate(m.x - R * 0.42, m.y - R * 0.45); ctx.rotate(-0.75);
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath(); ctx.roundRect(-R * 0.2, -R * 0.05, R * 0.4, R * 0.1, R * 0.05); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.beginPath(); ctx.roundRect(-R * 0.08, R * 0.08, R * 0.16, R * 0.05, R * 0.025); ctx.fill();
        ctx.restore();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = R * 0.03; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(m.x, m.y, R * 0.86, Math.PI * 0.15, Math.PI * 0.42); ctx.stroke();

        ctx.save(); ctx.globalAlpha = g;
        Roamie.drawVisorEyes(ctx, face, m.x + Math.cos(m.ang) * R * 0.08 * Math.min(1, m.speed / 60), m.y - R * 0.05, R * 0.3, { gap: R * 0.46, color: '#cfe0ff', core: '#ffffff' });
        ctx.restore();
      },
    };
  },
});
