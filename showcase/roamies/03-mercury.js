// Liquid mercury: metaballs rendered as chrome. A low-res field is shaded with a fake environment map.
Roamie.register({
  id: 'mercury',
  label: 'Mercury',
  bg: 'radial-gradient(120% 80% at 50% 30%, #23262d 0%, #0b0c0f 75%)',
  create(env) {
    const { TAU, clamp, rand } = Roamie;
    const m = new Roamie.Mover(env, { speed: 135, accel: 3.2 });
    const face = new Roamie.Face();
    const sq = new Roamie.Spring(180, 9);
    const trail = Array.from({ length: 4 }, () => ({ x: m.x, y: m.y, vx: 0, vy: 0 }));
    const sats = Array.from({ length: 3 }, (_, i) => ({ a: (i / 3) * TAU, x: m.x, y: m.y, vx: 0, vy: 0, k: rand(18, 30) }));
    let R = 50, t = 0, S = 3;
    const off = document.createElement('canvas');
    const octx = off.getContext('2d');
    let img = null, gw = 0, gh = 0, side = 0;
    const spring = (p, tx, ty, k, c, dt) => {
      p.vx += ((tx - p.x) * k - p.vx * c) * dt; p.vy += ((ty - p.y) * k - p.vy * c) * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
    };
    return {
      mover: m, face,
      resize(env) {
        R = clamp(Roamie.unit(env) * 0.17, 32, 160);
        m.radius = R * 1.3;
        S = Roamie.unit(env) > 500 ? 2 : 1.5;
        gw = Math.ceil(env.w / S); gh = Math.ceil(env.h / S);
        side = Math.ceil((R * 10) / S) + 4;
        off.width = off.height = side;
        img = octx.createImageData(side, side);
      },
      boop() { sq.kick(10); for (const s of sats) { s.vx += rand(-800, 800); s.vy += rand(-800, 800); } },
      bonk() { sq.kick(16); for (const s of trail) { s.vx += rand(-600, 600); s.vy += rand(-600, 600); } },
      update(dt, env) {
        t += dt;
        m.update(dt, env);
        sq.update(dt);
        let px = m.x, py = m.y;
        trail.forEach((s, i) => { spring(s, px, py, 95 - i * 15, 10, dt); px = s.x; py = s.y; });
        sats.forEach((s, i) => {
          s.a = Math.PI * (0.5 + 0.38 * Math.sin(t * (0.7 + i * 0.25) + i * 2.1));
          const rr = R * (1.5 + 0.3 * Math.sin(t * 1.7 + i * 2));
          spring(s, m.x + Math.cos(s.a) * rr, m.y + Math.sin(s.a) * rr * 0.8, s.k, 4, dt);
        });
        face.update(dt, env, m.x, m.y, m);
      },
      draw(ctx, env) {
        if (!img) return;
        const balls = [{ x: m.x, y: m.y, r: R * (1 + sq.x * 0.012) }];
        trail.forEach((s, i) => balls.push({ x: s.x, y: s.y, r: R * (0.8 - i * 0.14) }));
        sats.forEach((s) => balls.push({ x: s.x, y: s.y, r: R * 0.26 }));
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        for (const b of balls) { b.r2 = b.r * b.r; x0 = Math.min(x0, b.x - R * 1.6); y0 = Math.min(y0, b.y - R * 1.6); x1 = Math.max(x1, b.x + R * 1.6); y1 = Math.max(y1, b.y + R * 1.6); }
        const gx0 = clamp(Math.floor(x0 / S), 0, gw), gx1 = clamp(Math.ceil(x1 / S), 0, gw);
        const gy0 = clamp(Math.floor(y0 / S), 0, gh), gy1 = Math.min(clamp(Math.ceil(y1 / S), 0, gh), gy0 + side);
        const gx1c = Math.min(gx1, gx0 + side);
        const d = img.data;
        d.fill(0);
        const lx = -0.45, ly = -0.6, lz = 0.66;
        const tw = Math.sin(t * 0.6) * 0.3;
        for (let gy = gy0; gy < gy1; gy++) {
          const y = gy * S;
          for (let gx = gx0; gx < gx1c; gx++) {
            const x = gx * S;
            let f = 0, nx = 0, ny = 0;
            for (let i = 0; i < balls.length; i++) {
              const b = balls[i], dx = x - b.x, dy = y - b.y, q = dx * dx + dy * dy + 1;
              const v = b.r2 / q; f += v;
              const g = (2 * v) / q; nx += dx * g; ny += dy * g;
            }
            if (f < 0.7) continue;
            const edge = clamp((f - 0.7) / 0.12, 0, 1);
            const gl = Math.hypot(nx, ny);
            let Nx = nx / (gl + 1e-6), Ny = ny / (gl + 1e-6);
            const flat = clamp(1 / (1 + gl * R * 0.55), 0, 1);
            Nx *= 1 - flat; Ny *= 1 - flat;
            const Nz = Math.sqrt(Math.max(0, 1 - Nx * Nx - Ny * Ny));
            // reflect view (0,0,1) -> sample a studio: dark floor, bright sky band, warm/cool rims
            const ry = Ny * 2 * Nz, rx = Nx * 2 * Nz, rz = 2 * Nz * Nz - 1;
            const sky = clamp(-ry * 1.4 + 0.25 + tw * rx, 0, 1);
            const band = Math.exp(-((ry + 0.35 + Math.sin(rx * 3 + t) * 0.06) ** 2) * 40);
            const floor = clamp(ry * 1.2, 0, 1);
            const spec = Math.pow(clamp(Nx * lx + Ny * ly + Nz * lz, 0, 1), 60);
            const rim = Math.pow(1 - Nz, 3);
            let r = 30 + sky * 150 + band * 200 + spec * 255 - floor * 20;
            let g = 33 + sky * 160 + band * 205 + spec * 255 - floor * 18;
            let b = 40 + sky * 185 + band * 210 + spec * 255 - floor * 10;
            const warm = clamp(0.5 + rx * 1.5, 0, 1);
            r += rim * (40 + 120 * warm); g += rim * (120 - 30 * warm); b += rim * (230 - 180 * warm);
            const o = ((gy - gy0) * side + (gx - gx0)) * 4;
            d[o] = clamp(r, 0, 255); d[o + 1] = clamp(g, 0, 255); d[o + 2] = clamp(b, 0, 255); d[o + 3] = edge * 255;
          }
        }
        octx.putImageData(img, 0, 0);
        const sh = ctx.createRadialGradient(m.x, m.y + R * 1.25, 0, m.x, m.y + R * 1.25, R * 1.6);
        sh.addColorStop(0, 'rgba(0,0,0,0.5)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = sh;
        ctx.save(); ctx.translate(m.x, m.y + R * 1.25); ctx.scale(1, 0.3); ctx.translate(-m.x, -(m.y + R * 1.25));
        ctx.fillRect(m.x - R * 2, m.y, R * 4, R * 3); ctx.restore();
        ctx.imageSmoothingEnabled = true;
        const bw = gx1c - gx0, bh = gy1 - gy0;
        if (bw > 0 && bh > 0) ctx.drawImage(off, 0, 0, bw, bh, gx0 * S, gy0 * S, bw * S, bh * S);
        const fx = m.x + Math.cos(m.ang) * R * 0.12 * Math.min(1, m.speed / 120), fy = m.y - R * 0.08;
        const vx = m.x + face.lookX * R * 0.28, vy = m.y - R * 0.02 + face.lookY * R * 0.2;
        const vw = R * 0.82 * (1 - Math.abs(face.lookX) * 0.18), vh = R * 0.46;
        ctx.save();
        ctx.translate(vx, vy);
        ctx.beginPath(); ctx.ellipse(0, 0, vw, vh, 0, 0, Math.PI * 2);
        const vg = ctx.createLinearGradient(0, -vh, 0, vh);
        vg.addColorStop(0, '#11151c'); vg.addColorStop(0.55, '#050608'); vg.addColorStop(1, '#0c1016');
        ctx.fillStyle = vg; ctx.fill();
        ctx.lineWidth = Math.max(1.5, R * 0.03); ctx.strokeStyle = 'rgba(210,225,255,0.55)'; ctx.stroke();
        ctx.save(); ctx.clip();
        ctx.fillStyle = 'rgba(160,240,255,0.04)';
        for (let y = -vh; y < vh; y += Math.max(2, R * 0.045)) ctx.fillRect(-vw, y, vw * 2, 1);
        ctx.restore();
        Roamie.drawVisorEyes(ctx, face, 0, 0, R * 0.5, { gap: R * 0.68, color: '#59e9ff', core: '#effdff' });
        ctx.beginPath(); ctx.ellipse(0, 0, vw, vh, 0, Math.PI * 1.08, Math.PI * 1.62);
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = R * 0.05; ctx.lineCap = 'round'; ctx.stroke();
        ctx.restore();
      },
    };
  },
});
