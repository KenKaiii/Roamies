// Nebula: ~900 particles flocking around an invisible core. Motion smears the swarm into a comet.
Roamie.register({
  id: 'nebula',
  label: 'Nebula',
  bg: 'radial-gradient(120% 90% at 50% 45%, #140a22 0%, #05030a 75%)',
  create(env) {
    const { TAU, clamp, rand } = Roamie;
    const m = new Roamie.Mover(env, { speed: 120, accel: 2.4 });
    const face = new Roamie.Face();
    const sq = new Roamie.Spring(140, 7);
    const N = 900;
    const P = new Float32Array(N * 6); // x y vx vy hueMix phase
    let R = 60, t = 0, burst = 0;
    const stars = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), s: rand(0.4, 1.4), p: rand(0, TAU) }));
    for (let i = 0; i < N; i++) { P[i * 6] = m.x; P[i * 6 + 1] = m.y; P[i * 6 + 4] = Math.random(); P[i * 6 + 5] = rand(0, TAU); }
    return {
      mover: m, face, P,
      resize(env) { R = clamp(Roamie.unit(env) * 0.2, 40, 200); m.radius = R * 0.8; },
      boop() { sq.kick(10); burst = 1; },
      bonk() { burst = 1.4; },
      update(dt, env) {
        t += dt;
        m.update(dt, env);
        sq.update(dt);
        burst = Math.max(0, burst - dt * 1.5);
        for (let i = 0; i < N; i++) {
          const o = i * 6;
          const ph = P[o + 5], orbit = 0.25 + (i % 7) / 7 * 0.85;
          const a = ph + t * (0.9 + (i % 5) * 0.12) * (i % 2 ? 1 : -1);
          const rr = R * orbit * (1 + burst * 1.4) * (1 + sq.x * 0.03);
          const tx = m.x + Math.cos(a) * rr, ty = m.y + Math.sin(a) * rr * 0.85;
          const k = 6 + (i % 9);
          P[o + 2] += ((tx - P[o]) * k - P[o + 2] * 2.2) * dt;
          P[o + 3] += ((ty - P[o + 1]) * k - P[o + 3] * 2.2) * dt;
          P[o] += P[o + 2] * dt; P[o + 1] += P[o + 3] * dt;
        }
        face.update(dt, env, m.x, m.y, m);
      },
      draw(ctx, env) {
        if (!env.transparent) for (const s of stars) {
          ctx.fillStyle = `rgba(220,200,255,${0.25 + 0.25 * Math.sin(t * 1.5 + s.p)})`;
          ctx.fillRect(s.x * env.w, s.y * env.h, s.s, s.s);
        }
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        const core = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, R * 1.4);
        core.addColorStop(0, 'rgba(255,170,220,0.35)');
        core.addColorStop(0.4, 'rgba(140,80,255,0.15)');
        core.addColorStop(1, 'rgba(40,20,120,0)');
        ctx.fillStyle = core; ctx.fillRect(m.x - R * 1.5, m.y - R * 1.5, R * 3, R * 3);
        for (let i = 0; i < N; i++) {
          const o = i * 6, x = P[o], y = P[o + 1], vx = P[o + 2], vy = P[o + 3], h = P[o + 4];
          const sp = Math.hypot(vx, vy);
          const r = h < 0.33 ? 255 : h < 0.66 ? 150 : 90, g = h < 0.33 ? 120 : h < 0.66 ? 100 : 200, b = h < 0.33 ? 200 : 255;
          ctx.strokeStyle = `rgba(${r},${g},${b},${clamp(0.25 + sp / 900, 0.25, 0.8)})`;
          ctx.lineWidth = 1 + (i % 3) * 0.6;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - vx * 0.035, y - vy * 0.035); ctx.stroke();
        }
        ctx.restore();
        const fx = m.x + Math.cos(m.ang) * R * 0.1 * Math.min(1, m.speed / 120), fy = m.y - R * 0.05;
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        Roamie.drawVisorEyes(ctx, face, fx, fy, R * 0.34, { gap: R * 0.5, color: '#ff7ad9', core: '#fff4fd' });
        ctx.restore();
      },
    };
  },
});
