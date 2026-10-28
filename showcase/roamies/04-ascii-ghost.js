// ASCII ghost: a wavy sheet of glyphs. The hem ripples with motion, and its wake leaves fading characters.
Roamie.register({
  id: 'ascii-ghost',
  label: 'ASCII ghost',
  bg: 'radial-gradient(130% 90% at 50% 40%, #0b1324 0%, #04060c 75%)',
  create(env) {
    const { clamp, rand, TAU } = Roamie;
    const m = new Roamie.Mover(env, { speed: 85, accel: 1.8, curiosity: 0.55 });
    const face = new Roamie.Face();
    const sq = new Roamie.Spring(120, 6);
    const GLY = ' `.,:;~-=+*%#&@';
    let R = 50, cw = 8, ch = 13, cols = 0, rows = 0, t = 0;
    let lean = 0, hemPhase = 0;
    const wisps = [];
    return {
      mover: m, face,
      resize(env) {
        const S = Roamie.unit(env);
        R = clamp(S * 0.22, 36, 190); m.radius = R;
        cw = Math.max(6.5, S / 62); ch = cw * 1.55;
        cols = Math.ceil(env.w / cw); rows = Math.ceil(env.h / ch);
      },
      boop() { sq.kick(8); for (let i = 0; i < 14; i++) wisps.push({ x: m.x + rand(-R, R), y: m.y + rand(-R, R), vx: rand(-60, 60), vy: rand(-120, -30), life: 1, c: '*+.'[i % 3] }); },
      bonk() { sq.kick(14); },
      update(dt, env) {
        t += dt;
        m.update(dt, env);
        sq.update(dt);
        lean = Roamie.damp(lean, clamp(m.vx / 220, -1, 1), 4, dt);
        hemPhase += dt * (3 + m.speed / 40);
        if (m.speed > 30 && Math.random() < dt * 30) {
          wisps.push({ x: m.x + rand(-R * 0.6, R * 0.6), y: m.y + R * rand(0.6, 1.1), vx: -m.vx * 0.2 + rand(-15, 15), vy: -m.vy * 0.2 + rand(-20, 10), life: 1, c: GLY[(Math.random() * 6 + 2) | 0] });
        }
        for (let i = wisps.length - 1; i >= 0; i--) {
          const w = wisps[i]; w.life -= dt * 0.9; w.x += w.vx * dt; w.y += w.vy * dt;
          if (w.life <= 0) wisps.splice(i, 1);
        }
        face.update(dt, env, m.x, m.y - R * 0.25, m);
      },
      draw(ctx, env) {
        const font = `${ch * 0.92}px ui-monospace, SFMono-Regular, Menlo, monospace`;
        ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const bob = Math.sin(t * 2.1) * R * 0.08;
        const sx = 1 + sq.x * 0.05 + m.stretch * 0.25, sy = 1 - sq.x * 0.05 - m.stretch * 0.1;
        const cx = m.x, cy = m.y + bob;
        const hw = R * sx, top = cy - R * 1.05 * sy, hemBase = cy + R * 0.95 * sy;
        const eyeY = cy - R * 0.25, eyeDX = R * 0.38;
        const ex = cx + face.lookX * R * 0.12 + lean * R * 0.15;
        const buckets = [[], [], [], [], []];
        const r0 = Math.max(0, Math.floor((top - R * 0.2) / ch)), r1 = Math.min(rows, Math.ceil((hemBase + R * 0.6) / ch));
        const c0 = Math.max(0, Math.floor((cx - hw * 1.6) / cw)), c1 = Math.min(cols, Math.ceil((cx + hw * 1.6) / cw));
        for (let r = r0; r < r1; r++) {
          const y = (r + 0.5) * ch;
          const v = (y - top) / (hemBase - top);
          const shear = lean * R * 0.55 * clamp(v, 0, 1.4) ** 1.6;
          for (let c = c0; c < c1; c++) {
            const x = (c + 0.5) * cw;
            const u = (x - cx - shear) / hw;
            let inside;
            if (v < 0.45) {
              const dy = (0.45 - v) / 0.45;
              inside = u * u + dy * dy < 1;
            } else {
              const flare = 1 + (v - 0.45) * 0.25;
              const hem = 1 + 0.16 * Math.sin(u * 7 - hemPhase) + 0.06 * Math.sin(u * 13 + hemPhase * 1.3);
              inside = Math.abs(u) < flare && v < hem;
            }
            if (!inside) continue;
            const dEye = Math.min(Math.hypot((x - (ex - eyeDX)) / (R * 0.17), (y - eyeY) / (R * 0.22 * Math.max(0.12, face.open))), Math.hypot((x - (ex + eyeDX)) / (R * 0.17), (y - eyeY) / (R * 0.22 * Math.max(0.12, face.open))));
            if (dEye < 1 && face.happy < 0.5 && face.dizzy < 0.5) continue;
            const mouthY = cy + R * 0.18, mw = face.wide > 0.5 ? 0.16 : 0.1;
            if (Math.hypot((x - ex) / (R * mw * 1.4), (y - mouthY) / (R * (face.wide > 0.5 ? 0.2 : 0.07))) < 1 && face.happy < 0.5) continue;
            const edge = Math.min(1 - Math.abs(u), v < 0.45 ? 1 - Math.hypot(u, (0.45 - v) / 0.45) : 1);
            const n = Roamie.noise(c * 0.5, r * 0.5 - t * 2.4, t);
            const dens = clamp(edge * 2.4 + n * 0.35 + 0.25 - Math.max(0, v - 0.7) * 1.2, 0, 0.999);
            const gi = 1 + Math.floor(dens * (GLY.length - 1));
            buckets[Math.min(4, Math.floor(dens * 5))].push(x, y, GLY[gi]);
          }
        }
        const COL = ['rgba(120,160,255,0.35)', 'rgba(150,185,255,0.55)', 'rgba(185,210,255,0.75)', 'rgba(220,234,255,0.9)', '#f2f7ff'];
        ctx.save();
        ctx.shadowColor = 'rgba(120,170,255,0.8)'; ctx.shadowBlur = ch * 0.7;
        buckets.forEach((L, i) => { ctx.fillStyle = COL[i]; for (let k = 0; k < L.length; k += 3) ctx.fillText(L[k + 2], L[k], L[k + 1]); });
        ctx.restore();
        for (const w of wisps) { ctx.fillStyle = `rgba(160,195,255,${w.life * 0.6})`; ctx.fillText(w.c, w.x, w.y); }
        if (face.happy > 0.5 || face.dizzy > 0.5) {
          ctx.save();
          ctx.fillStyle = '#04060c';
          ctx.font = `800 ${ch * 1.5}px ui-monospace, SFMono-Regular, Menlo, monospace`;
          const g = face.dizzy > 0.5 ? '@' : '^';
          ctx.fillText(g, ex - eyeDX, eyeY); ctx.fillText(g, ex + eyeDX, eyeY);
          ctx.fillText(face.dizzy > 0.5 ? '~' : 'v', ex, cy + R * 0.2);
          ctx.restore();
        }
        if (face.sleepy > 0.5) {
          ctx.fillStyle = 'rgba(200,220,255,0.7)';
          ctx.font = `700 ${ch}px ui-monospace, Menlo, monospace`;
          const z = (t * 0.6) % 1;
          ctx.fillText('z', cx + R * (0.8 + z * 0.5), top - z * R * 0.8);
          ctx.fillText('Z', cx + R * (1.1 + z * 0.4), top - R * 0.4 - z * R * 0.8);
        }
      },
    };
  },
});
