// Particles. Pooled, capped, all drawn on the game canvas after the pens.
// World-space bursts (dust, sparks, ink) and screen-space confetti.

const MAX_PARTS = 260;

export function createFx() {
  const parts = [];

  function push(p) {
    if (parts.length >= MAX_PARTS) parts.shift();
    parts.push(p);
  }

  // Impact dust + sparks at a world point. Strength ~ contact impulse.
  function burst(x, y, strength, kind = "dust") {
    const n = Math.min(14, Math.round(3 + strength * 3));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (0.4 + Math.random() * 1.4) * Math.min(2.2, 0.5 + strength * 0.35);
      push({
        kind, world: true,
        x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 1, decay: 1.8 + Math.random() * 1.6,
        size: kind === "spark" ? 0.03 + Math.random() * 0.03 : 0.05 + Math.random() * 0.07
      });
    }
  }

  function inkSplat(x, y, strength) {
    const n = Math.min(10, Math.round(2 + strength * 2));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.3 + Math.random() * 1.1;
      push({
        kind: "ink", world: true,
        x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 1, decay: 0.9 + Math.random() * 0.7,
        size: 0.04 + Math.random() * 0.08
      });
    }
  }

  // Victory confetti, screen space, spawned across the top.
  function confetti(cw, ch, dpr) {
    for (let i = 0; i < 90; i++) {
      push({
        kind: "confetti", world: false,
        x: Math.random() * cw, y: -20 * dpr - Math.random() * ch * 0.3,
        vx: (Math.random() - 0.5) * 60 * dpr, vy: (120 + Math.random() * 160) * dpr,
        sway: Math.random() * Math.PI * 2,
        life: 1, decay: 0.16 + Math.random() * 0.1,
        size: (3 + Math.random() * 4) * dpr,
        hue: Math.floor(Math.random() * 360)
      });
    }
  }

  function update(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= p.decay * dt;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      if (p.world) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 1 - 2.4 * dt;
        p.vy *= 1 - 2.4 * dt;
      } else {
        p.sway += dt * 5;
        p.x += p.vx * dt + Math.sin(p.sway) * 40 * dt;
        p.y += p.vy * dt;
      }
    }
  }

  function draw(ctx, toScreen, eScale) {
    for (const p of parts) {
      const a = Math.max(0, Math.min(1, p.life));
      if (p.kind === "confetti") {
        ctx.fillStyle = `hsla(${p.hue},90%,60%,${a})`;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.sway);
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
        continue;
      }
      const s = toScreen(p.x, p.y);
      const r = p.size * eScale * (p.kind === "dust" ? 1 + (1 - p.life) * 1.6 : 1);
      if (p.kind === "dust") ctx.fillStyle = `rgba(190,150,105,${a * 0.5})`;
      else if (p.kind === "spark") ctx.fillStyle = `rgba(255,225,150,${a})`;
      else if (p.kind === "ink") ctx.fillStyle = `rgba(24,32,90,${a * 0.85})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  return { burst, inkSplat, confetti, update, draw, get count() { return parts.length; } };
}
