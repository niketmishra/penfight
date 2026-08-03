// Canvas renderer. Top-down desk, vector pens, camera with kill-cam zoom,
// fall animations, teeter drama, particles, aim ghost, screen shake.
// Drawn transforms chase physics transforms with a short exponential
// smoothing, which smooths fixed-step motion and softens online snaps.

import { tableById, tableHalf, edgeClearance } from "./tables.js";
import { createFx } from "./fx.js";

const MARGIN = 0.7;           // world units of floor visible around the table
const SMOOTH_TAU = 0.045;     // seconds, render chase time constant
const SNAP_TAU = 0.12;        // slower chase right after a snapshot correction

export function createRenderer(canvas) {
  const ctx = canvas.getContext("2d");
  const fx = createFx();
  let dpr = 1, cw = 0, ch = 0, scale = 1, ox = 0, oy = 0;
  let deskCache = null;
  let table = tableById("classroom");
  let holes = [];
  const drawn = new Map();     // uid -> {x, y, angle, tau}
  const falls = [];            // active fall animations, dt-driven
  let shakeMag = 0;
  let preview = null;
  let highlightUid = null;
  let highlightColor = "#ffd166";
  let onTeeter = null;
  const teetering = new Set();

  // Camera: world point at screen center offset + zoom, both eased.
  const cam = { cx: 0, cy: 0, zoom: 1, tx: 0, ty: 0, tzoom: 1, tau: 0.22 };
  let eScale = 1;              // scale * cam.zoom, the size of one world unit
  let flash = 0;               // kill-cam white flash

  const view = {
    toWorld(clientX, clientY) {
      const r = canvas.getBoundingClientRect();
      const px = (clientX - r.left) * (cw / r.width);
      const py = (clientY - r.top) * (ch / r.height);
      return {
        x: (px - ox) / eScale + cam.cx,
        y: (py - oy) / eScale + cam.cy
      };
    },
    toScreen(wx, wy) {
      return {
        x: ox + (wx - cam.cx) * eScale,
        y: oy + (wy - cam.cy) * eScale
      };
    },
    get pxPerUnit() { return eScale; }
  };

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const vw = window.visualViewport ? window.visualViewport.width : window.innerWidth;
    const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    canvas.style.width = vw + "px";
    canvas.style.height = vh + "px";
    cw = Math.round(vw * dpr);
    ch = Math.round(vh * dpr);
    canvas.width = cw;
    canvas.height = ch;
    fitView();
    deskCache = null;
  }

  function fitView() {
    const half = tableHalf(table);
    scale = Math.min(cw / (half.x * 2 + MARGIN * 2), ch / (half.y * 2 + MARGIN * 2));
    ox = cw / 2;
    oy = ch / 2;
    eScale = scale * cam.zoom;
  }

  function setTable(t, opts = {}) {
    table = t;
    holes = opts.holes || [];
    camHome(true);
    fitView();
    deskCache = null;
  }

  // ---------- camera api ----------

  function camFollow(x, y, zoom = 1, tau = 0.22) {
    // Clamp pan so the desk never drifts far off center.
    const half = tableHalf(table);
    cam.tx = Math.max(-half.x * 0.35, Math.min(half.x * 0.35, x * 0.5));
    cam.ty = Math.max(-half.y * 0.35, Math.min(half.y * 0.35, y * 0.5));
    cam.tzoom = zoom;
    cam.tau = tau;
  }

  function killCam(x, y) {
    camFollow(x * 1.4, y * 1.4, 1.35, 0.09);
    flash = 0.55;
  }

  function camHome(instant = false) {
    cam.tx = 0; cam.ty = 0; cam.tzoom = 1; cam.tau = 0.16;
    if (instant) { cam.cx = 0; cam.cy = 0; cam.zoom = 1; eScale = scale; }
  }

  function introPulse() {
    cam.zoom = 1.16;
    cam.cx = 0; cam.cy = 0;
    camHome();
  }

  // ---------- desk ----------

  function deskPath(g, inset = 0) {
    const half = tableHalf(table);
    if (table.shape === "round") {
      g.beginPath();
      g.arc(ox, oy, half.x * scale - inset, 0, Math.PI * 2);
      g.closePath();
    } else {
      rr(g, ox - half.x * scale + inset, oy - half.y * scale + inset,
        half.x * 2 * scale - inset * 2, half.y * 2 * scale - inset * 2, 8 * dpr);
    }
  }

  function baseToScreen(wx, wy) {
    return { x: ox + wx * scale, y: oy + wy * scale };
  }

  function buildDesk() {
    deskCache = document.createElement("canvas");
    deskCache.width = cw;
    deskCache.height = ch;
    const g = deskCache.getContext("2d");
    const th = table.theme;
    const half = tableHalf(table);
    const x0 = ox - half.x * scale, y0 = oy - half.y * scale;
    const tw = half.x * 2 * scale, tht = half.y * 2 * scale;

    g.fillStyle = th.floor;
    g.fillRect(0, 0, cw, ch);

    g.save();
    g.translate(6 * (dpr / 2), 12 * (dpr / 2));
    g.fillStyle = "rgba(0,0,0,0.55)";
    deskPath(g);
    g.fill();
    g.restore();

    const grad = g.createLinearGradient(x0, y0, x0 + tw, y0 + tht);
    grad.addColorStop(0, th.top[0]);
    grad.addColorStop(0.5, th.top[1]);
    grad.addColorStop(1, th.top[2]);
    g.fillStyle = grad;
    deskPath(g);
    g.fill();

    g.save();
    deskPath(g);
    g.clip();

    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

    if (th.planks > 1) {
      for (let i = 1; i < th.planks; i++) {
        const px = x0 + (tw * i) / th.planks;
        g.strokeStyle = "rgba(40,22,8,0.35)";
        g.lineWidth = 1.5 * dpr;
        g.beginPath(); g.moveTo(px, y0); g.lineTo(px, y0 + tht); g.stroke();
      }
    }
    if (table.seam) {
      g.strokeStyle = "rgba(20,10,2,0.55)";
      g.lineWidth = 3 * dpr;
      g.beginPath(); g.moveTo(ox, y0); g.lineTo(ox, y0 + tht); g.stroke();
    }
    if (th.grain) {
      for (let i = 0; i < 90; i++) {
        const gx = x0 + rand() * tw;
        const gy = y0 + rand() * tht;
        const len = (20 + rand() * 120) * dpr;
        g.strokeStyle = `rgba(${rand() > 0.5 ? "60,34,12" : "180,130,80"},${0.05 + rand() * 0.1})`;
        g.lineWidth = (0.5 + rand()) * dpr;
        g.beginPath();
        g.moveTo(gx, gy);
        g.quadraticCurveTo(gx + 4 * dpr, gy + len / 2, gx + rand() * 6 * dpr - 3 * dpr, gy + len);
        g.stroke();
      }
    }
    if (th.steel) {
      for (let i = 0; i < 26; i++) {
        g.strokeStyle = `rgba(255,255,255,${0.02 + rand() * 0.05})`;
        g.lineWidth = (0.6 + rand() * 1.2) * dpr;
        g.beginPath();
        g.arc(ox, oy, rand() * half.x * scale, rand() * Math.PI * 2, rand() * Math.PI * 2 + 1.2);
        g.stroke();
      }
    }
    if (th.glass) {
      const sheen = g.createLinearGradient(x0, y0, x0 + tw * 0.7, y0 + tht);
      sheen.addColorStop(0, "rgba(255,255,255,0.14)");
      sheen.addColorStop(0.35, "rgba(255,255,255,0.02)");
      sheen.addColorStop(1, "rgba(255,255,255,0.09)");
      g.fillStyle = sheen;
      g.fillRect(x0, y0, tw, tht);
    }
    if (th.paper) {
      g.save();
      g.translate(ox + tw * 0.16, oy - tht * 0.22);
      g.rotate(0.16);
      g.fillStyle = "rgba(240,236,220,0.9)";
      g.fillRect(-42 * dpr, -56 * dpr, 84 * dpr, 112 * dpr);
      g.strokeStyle = "rgba(90,90,110,0.5)";
      g.lineWidth = 1 * dpr;
      for (let i = 0; i < 9; i++) {
        g.beginPath();
        g.moveTo(-34 * dpr, -40 * dpr + i * 11 * dpr);
        g.lineTo(34 * dpr, -40 * dpr + i * 11 * dpr);
        g.stroke();
      }
      g.restore();
    }
    if (th.graffiti) {
      g.save();
      g.font = `${11 * dpr}px "Space Grotesk", sans-serif`;
      g.fillStyle = "rgba(30,14,4,0.5)";
      g.rotate(-0.06);
      g.fillText("AB + ?", x0 + tw * 0.18, y0 + tht * 0.3);
      g.fillText("2029 batch zindabad", x0 + tw * 0.08, y0 + tht * 0.82);
      g.restore();
    }
    if (th.scratches) {
      for (let i = 0; i < 12; i++) {
        const sx = x0 + rand() * tw, sy = y0 + rand() * tht;
        g.strokeStyle = "rgba(255,240,220,0.06)";
        g.lineWidth = 0.8 * dpr;
        g.beginPath();
        g.moveTo(sx, sy);
        g.lineTo(sx + (rand() - 0.5) * 60 * dpr, sy + (rand() - 0.5) * 60 * dpr);
        g.stroke();
      }
    }

    for (const h of holes) {
      const c = baseToScreen(h.x, h.y);
      const rp = h.r * scale;
      const hg = g.createRadialGradient(c.x, c.y, rp * 0.1, c.x, c.y, rp);
      hg.addColorStop(0, "#05060a");
      hg.addColorStop(0.75, "#0b0e18");
      hg.addColorStop(1, "#1c1206");
      g.fillStyle = hg;
      g.beginPath(); g.arc(c.x, c.y, rp, 0, Math.PI * 2); g.fill();
      g.strokeStyle = "rgba(255,220,170,0.25)";
      g.lineWidth = 1.5 * dpr;
      g.beginPath(); g.arc(c.x, c.y, rp, 0, Math.PI * 2); g.stroke();
    }

    g.restore();

    g.strokeStyle = th.edge;
    g.lineWidth = 3 * dpr;
    deskPath(g);
    g.stroke();
    g.strokeStyle = "rgba(255,220,170,0.18)";
    g.lineWidth = 1 * dpr;
    deskPath(g, 2 * dpr);
    g.stroke();
  }

  // ---------- per-frame ----------

  function chase(uid, x, y, angle, dt) {
    let d = drawn.get(uid);
    if (!d) { d = { x, y, angle, tau: SMOOTH_TAU }; drawn.set(uid, d); return d; }
    const k = 1 - Math.exp(-dt / d.tau);
    d.x += (x - d.x) * k;
    d.y += (y - d.y) * k;
    let da = angle - d.angle;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    d.angle += da * k;
    d.tau += (SMOOTH_TAU - d.tau) * k * 0.5;
    return d;
  }

  function draw(sim, dt, tNow, timeScale = 1) {
    if (!deskCache) buildDesk();

    // Ease the camera (real time, not sim time)
    const ck = 1 - Math.exp(-dt / cam.tau);
    cam.cx += (cam.tx - cam.cx) * ck;
    cam.cy += (cam.ty - cam.cy) * ck;
    cam.zoom += (cam.tzoom - cam.zoom) * ck;
    eScale = scale * cam.zoom;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    let shx = 0, shy = 0;
    if (shakeMag > 0.01) {
      shx = (Math.random() - 0.5) * shakeMag * dpr;
      shy = (Math.random() - 0.5) * shakeMag * dpr;
      shakeMag *= Math.exp(-dt / 0.09);
    } else shakeMag = 0;

    // Desk cache is base-space; draw it through the camera transform.
    ctx.setTransform(
      cam.zoom, 0, 0, cam.zoom,
      ox * (1 - cam.zoom) - cam.cx * scale * cam.zoom + shx,
      oy * (1 - cam.zoom) - cam.cy * scale * cam.zoom + shy
    );
    ctx.drawImage(deskCache, 0, 0);
    ctx.setTransform(1, 0, 0, 1, shx, shy);

    if (sim.zones) for (const z of sim.zones) drawZone(z);
    if (stormInset > 0) drawStorm(tNow);
    if (sim.props) for (const p of sim.props) drawProp(p);

    // Fall animations, under the live pens (progress on scaled time)
    for (let i = falls.length - 1; i >= 0; i--) {
      const f = falls[i];
      f.t += (dt * timeScale) / 0.6;
      if (f.t >= 1) { falls.splice(i, 1); continue; }
      const t = f.t;
      const x = f.x + f.vx * t * 0.24;
      const y = f.y + f.vy * t * 0.24 + t * t * 0.55;
      const a = f.angle + f.w * t * 0.35;
      drawPen(f.pen, x, y, a, 1 - t * 0.5, 1 - t, false);
    }

    // Live pens with teeter drama
    const seen = new Set();
    sim.eachPen((uid, data, x, y, angle, body) => {
      seen.add(uid);
      const d = chase(uid, x, y, angle, dt);
      const isHl = uid === highlightUid;
      if (isHl) drawHighlight(d.x, d.y, data.pen, tNow);

      let wobble = 0;
      const v = body.getLinearVelocity();
      const still = Math.hypot(v.x, v.y) < 0.12 && Math.abs(body.getAngularVelocity()) < 0.3;
      const clearance = edgeClearance(sim.table, x, y);
      if (still && clearance < (data.pen.length / 2) * 0.5) {
        if (!teetering.has(uid)) {
          teetering.add(uid);
          if (onTeeter) onTeeter({ uid, x, y, pen: data.pen, ownerId: data.ownerId });
        }
        wobble = Math.sin(tNow / 55) * 0.028 * (1 + Math.sin(tNow / 700) * 0.5);
      } else if (!still || clearance > data.pen.length * 0.6) {
        teetering.delete(uid);
      }

      const lift = sim.airborneLift ? sim.airborneLift(uid) : 0;
      drawPen(data.pen, d.x, d.y, d.angle + wobble, 1 + lift * 0.2, 1, true, lift * 0.35, data.sticker);
    });
    for (const uid of [...drawn.keys()]) if (!seen.has(uid)) { drawn.delete(uid); teetering.delete(uid); }

    fx.update(dt * (timeScale < 1 ? timeScale : 1));
    fx.draw(ctx, (wx, wy) => view.toScreen(wx, wy), eScale);

    if (preview) drawPreview(preview, tNow);

    if (flash > 0.01) {
      ctx.fillStyle = `rgba(255,244,214,${flash * 0.5})`;
      ctx.fillRect(0, 0, cw, ch);
      flash *= Math.exp(-dt / 0.1);
    } else flash = 0;
  }

  // ---------- desk clutter ----------

  function drawZone(z) {
    const s = view.toScreen(z.x, z.y);
    const r = z.r * eScale;
    ctx.save();
    if (z.kind === "ink") {
      ctx.fillStyle = "rgba(18,26,80,0.55)";
      for (const [dx, dy, k] of [[0, 0, 1], [0.55, 0.3, 0.45], [-0.5, 0.42, 0.38], [0.2, -0.55, 0.42]]) {
        ctx.beginPath();
        ctx.arc(s.x + dx * r, s.y + dy * r, r * k, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.beginPath();
      ctx.arc(s.x - r * 0.25, s.y - r * 0.3, r * 0.16, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = "rgba(235,200,120,0.32)";
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,240,190,0.4)";
      ctx.lineWidth = 1.5 * dpr;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawProp(p) {
    const s = view.toScreen(p.x, p.y);
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(p.angle || 0);
    const W = (p.w || p.r * 2) * eScale;
    const H = (p.h || p.r * 2) * eScale;
    // shared drop shadow
    ctx.fillStyle = "rgba(10,5,0,0.3)";
    if (p.shape === "circle") {
      ctx.beginPath(); ctx.arc(3 * dpr, 5 * dpr, (p.r * eScale), 0, Math.PI * 2); ctx.fill();
    } else {
      rr(ctx, -W / 2 + 3 * dpr, -H / 2 + 5 * dpr, W, H, 4 * dpr); ctx.fill();
    }
    if (p.kind === "eraser") {
      ctx.fillStyle = "#f2f2ee";
      rr(ctx, -W / 2, -H / 2, W, H, H * 0.2); ctx.fill();
      ctx.fillStyle = "#3d7bff";
      rr(ctx, -W / 2, -H / 2, W, H * 0.42, H * 0.2); ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.font = `${Math.round(H * 0.28)}px "Space Grotesk", sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("NATRAJ?", 0, H * 0.3);
    } else if (p.kind === "geometry") {
      const mg = ctx.createLinearGradient(0, -H / 2, 0, H / 2);
      mg.addColorStop(0, "#cdd6e2"); mg.addColorStop(0.5, "#9aa5b5"); mg.addColorStop(1, "#78828f");
      ctx.fillStyle = mg;
      rr(ctx, -W / 2, -H / 2, W, H, 5 * dpr); ctx.fill();
      ctx.strokeStyle = "rgba(40,48,60,0.7)";
      ctx.lineWidth = 1.5 * dpr;
      rr(ctx, -W / 2, -H / 2, W, H, 5 * dpr); ctx.stroke();
      ctx.fillStyle = "#525c68";
      rr(ctx, -W * 0.12, -H / 2, W * 0.24, H * 0.12, 2 * dpr); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.font = `${Math.round(H * 0.2)}px "Space Grotesk", sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("CAMLIN", 0, H * 0.12);
    } else if (p.kind === "book") {
      ctx.fillStyle = "#e8e2d0";
      rr(ctx, -W / 2 + 2 * dpr, -H / 2 + 2 * dpr, W, H, 3 * dpr); ctx.fill();
      ctx.fillStyle = "#b3402e";
      rr(ctx, -W / 2, -H / 2, W, H, 3 * dpr); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      rr(ctx, -W * 0.32, -H * 0.26, W * 0.64, H * 0.2, 2 * dpr); ctx.fill();
      ctx.fillStyle = "rgba(30,10,5,0.8)";
      ctx.font = `${Math.round(H * 0.14)}px "Space Grotesk", sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("MATHS 10", 0, -H * 0.1);
      ctx.fillStyle = "rgba(30,10,5,0.35)";
      ctx.fillRect(-W / 2, H * 0.28, W, 1.5 * dpr);
    } else if (p.kind === "sharpener") {
      const r = p.r * eScale;
      const mg = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.2, 0, 0, r);
      mg.addColorStop(0, "#e6ebf4"); mg.addColorStop(1, "#8b94a3");
      ctx.fillStyle = mg;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#2b2f38";
      rr(ctx, -r * 0.55, -r * 0.18, r * 1.1, r * 0.36, 2 * dpr); ctx.fill();
    }
    ctx.restore();
  }

  let stormInset = 0;
  function setStorm(inset) { stormInset = inset; }

  function drawStorm(tNow) {
    const half = tableHalf(table);
    ctx.save();
    ctx.strokeStyle = "rgba(250,250,245,0.75)";
    ctx.lineWidth = 2.5 * dpr;
    ctx.setLineDash([9 * dpr, 7 * dpr]);
    ctx.lineDashOffset = (tNow / 60) % (16 * dpr);
    if (table.shape === "round") {
      const c = view.toScreen(0, 0);
      ctx.beginPath();
      ctx.arc(c.x, c.y, (half.x - stormInset) * eScale, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      const a = view.toScreen(-half.x + stormInset, -half.y + stormInset);
      const b = view.toScreen(half.x - stormInset, half.y - stormInset);
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      // danger band outside the line
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255,84,112,0.09)";
      const o1 = view.toScreen(-half.x, -half.y);
      const o2 = view.toScreen(half.x, half.y);
      ctx.beginPath();
      ctx.rect(o1.x, o1.y, o2.x - o1.x, o2.y - o1.y);
      ctx.rect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.fill("evenodd");
    }
    ctx.restore();
  }

  function drawHighlight(x, y, pen, tNow) {
    const s = view.toScreen(x, y);
    const pulse = 1 + 0.06 * Math.sin(tNow / 220);
    const r = (pen.length / 2 + 0.35) * eScale * pulse;
    ctx.strokeStyle = highlightColor;
    ctx.globalAlpha = 0.5 + 0.25 * Math.sin(tNow / 220);
    ctx.lineWidth = 2.5 * dpr;
    ctx.setLineDash([8 * dpr, 7 * dpr]);
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, tNow / 900, tNow / 900 + Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  function drawPreview(p, tNow) {
    const s = view.toScreen(p.x, p.y);
    const len = (0.8 + p.power * 3.2) * eScale;
    ctx.save();
    ctx.strokeStyle = "rgba(255,209,102,0.85)";
    ctx.lineWidth = 3 * dpr;
    ctx.setLineDash([10 * dpr, 8 * dpr]);
    ctx.lineDashOffset = -(tNow / 30) % (18 * dpr);
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(s.x + p.dx * len, s.y + p.dy * len);
    ctx.stroke();
    ctx.setLineDash([]);
    const ex = s.x + p.dx * len, ey = s.y + p.dy * len;
    const aa = Math.atan2(p.dy, p.dx);
    ctx.fillStyle = "rgba(255,209,102,0.85)";
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - Math.cos(aa - 0.45) * 10 * dpr, ey - Math.sin(aa - 0.45) * 10 * dpr);
    ctx.lineTo(ex - Math.cos(aa + 0.45) * 10 * dpr, ey - Math.sin(aa + 0.45) * 10 * dpr);
    ctx.fill();
    if (Math.abs(p.off) > 0.35) {
      ctx.strokeStyle = "rgba(255,209,102,0.6)";
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      const dir = p.off > 0 ? 1 : -1;
      ctx.arc(s.x, s.y, 0.45 * eScale, aa + dir * 0.6, aa + dir * 2.2, dir < 0);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Little barrel decals, applied after the pen body.
  function drawSticker(sticker, L, W) {
    const cx = -L * 0.06;   // mid barrel
    ctx.save();
    ctx.translate(cx, 0);
    if (sticker === "flame") {
      ctx.fillStyle = "#ff7b24";
      for (const [dx, k] of [[-W * 0.5, 0.8], [0, 1], [W * 0.5, 0.7]]) {
        ctx.beginPath();
        ctx.moveTo(dx - W * 0.18, W * 0.3);
        ctx.quadraticCurveTo(dx - W * 0.2, -W * 0.4 * k, dx, -W * 0.55 * k);
        ctx.quadraticCurveTo(dx + W * 0.2, -W * 0.4 * k, dx + W * 0.18, W * 0.3);
        ctx.fill();
      }
    } else if (sticker === "star") {
      ctx.fillStyle = "#ffd166";
      starPath(ctx, 0, 0, W * 0.42, W * 0.18, 5);
      ctx.fill();
    } else if (sticker === "heart") {
      ctx.fillStyle = "#ff5470";
      ctx.beginPath();
      const s = W * 0.32;
      ctx.moveTo(0, s * 0.9);
      ctx.bezierCurveTo(-s * 1.4, -s * 0.3, -s * 0.5, -s * 1.2, 0, -s * 0.3);
      ctx.bezierCurveTo(s * 0.5, -s * 1.2, s * 1.4, -s * 0.3, 0, s * 0.9);
      ctx.fill();
    } else if (sticker === "tape") {
      ctx.fillStyle = "rgba(210,210,200,0.85)";
      ctx.fillRect(-W * 0.45, -W * 0.55, W * 0.9, W * 1.1);
      ctx.fillStyle = "rgba(160,160,150,0.5)";
      ctx.fillRect(-W * 0.45, -W * 0.55, W * 0.9, W * 0.14);
    } else if (sticker === "topper") {
      ctx.fillStyle = "#ffd166";
      ctx.fillRect(-W * 0.75, -W * 0.4, W * 1.5, W * 0.8);
      ctx.fillStyle = "#3a2c00";
      ctx.font = `bold ${W * 0.5}px "Space Grotesk", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("100", 0, W * 0.03);
    } else if (sticker === "skull") {
      ctx.fillStyle = "#f2f4fb";
      ctx.beginPath();
      ctx.arc(0, -W * 0.08, W * 0.34, Math.PI, 0);
      ctx.rect(-W * 0.34, -W * 0.08, W * 0.68, W * 0.3);
      ctx.fill();
      ctx.fillStyle = "#1d2026";
      ctx.beginPath();
      ctx.arc(-W * 0.14, -W * 0.1, W * 0.1, 0, Math.PI * 2);
      ctx.arc(W * 0.14, -W * 0.1, W * 0.1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Vector pen, local long axis along +x, drawn at world (x, y, angle).
  function drawPen(pen, x, y, angle, sizeK, alpha, shadow, lift = 0, sticker = null) {
    const s = view.toScreen(x, y);
    const L = pen.length * eScale * sizeK;
    const W = pen.dia * eScale * sizeK * 1.35;
    const r = pen.render;
    ctx.save();
    ctx.translate(s.x, s.y - lift * eScale);
    ctx.rotate(angle);
    ctx.globalAlpha = alpha;

    if (shadow) {
      ctx.save();
      ctx.rotate(-angle);
      ctx.translate((0.055 + lift * 0.7) * eScale, (0.1 + lift * 1.2) * eScale);
      ctx.rotate(angle);
      ctx.fillStyle = `rgba(10,5,0,${0.33 / (1 + lift * 2)})`;
      rr(ctx, -L / 2, -W / 2, L, W, W / 2);
      ctx.fill();
      ctx.restore();
    }

    const hl = L / 2;
    if (r.shape === "pencil") {
      const bodyLen = L * 0.78;
      ctx.fillStyle = r.body;
      ctx.fillRect(-hl + L * 0.14, -W / 2, bodyLen, W);
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.fillRect(-hl + L * 0.14, -W / 2, bodyLen, W * 0.22);
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.fillRect(-hl + L * 0.14, W / 2 - W * 0.22, bodyLen, W * 0.22);
      ctx.fillStyle = "#b9c0cc";
      ctx.fillRect(-hl + L * 0.05, -W / 2, L * 0.09, W);
      ctx.fillStyle = r.cap;
      rr(ctx, -hl, -W / 2, L * 0.07, W, W * 0.3);
      ctx.fill();
      ctx.fillStyle = r.tip;
      ctx.beginPath();
      ctx.moveTo(-hl + L * 0.92, -W / 2);
      ctx.lineTo(hl, 0);
      ctx.lineTo(-hl + L * 0.92, W / 2);
      ctx.fill();
      ctx.fillStyle = "#2b2b2b";
      ctx.beginPath();
      ctx.moveTo(hl - L * 0.035, -W * 0.14);
      ctx.lineTo(hl, 0);
      ctx.lineTo(hl - L * 0.035, W * 0.14);
      ctx.fill();
    } else {
      if (r.shape === "metal") {
        const mg = ctx.createLinearGradient(0, -W / 2, 0, W / 2);
        mg.addColorStop(0, "#e6ebf4");
        mg.addColorStop(0.45, r.body);
        mg.addColorStop(1, "#69707e");
        ctx.fillStyle = mg;
      } else {
        ctx.fillStyle = r.body;
      }
      rr(ctx, -hl + L * 0.06, -W / 2, L * 0.88, W, W / 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.28)";
      rr(ctx, -hl + L * 0.1, -W / 2 + W * 0.12, L * 0.8, W * 0.18, W * 0.09);
      ctx.fill();
      ctx.fillStyle = r.cap;
      rr(ctx, -hl, -W / 2, L * 0.3, W, W / 2);
      ctx.fill();
      if (r.clip) {
        ctx.fillStyle = shadeOf(r.cap);
        rr(ctx, -hl + L * 0.04, -W * 0.95, L * 0.2, W * 0.32, W * 0.12);
        ctx.fill();
      }
      ctx.fillStyle = r.tip;
      ctx.beginPath();
      ctx.moveTo(hl - L * 0.12, -W / 2);
      ctx.lineTo(hl, 0);
      ctx.lineTo(hl - L * 0.12, W / 2);
      ctx.fill();
      ctx.fillStyle = "#1d2026";
      ctx.beginPath();
      ctx.moveTo(hl - L * 0.03, -W * 0.12);
      ctx.lineTo(hl, 0);
      ctx.lineTo(hl - L * 0.03, W * 0.12);
      ctx.fill();
    }
    if (sticker && sticker !== "none") drawSticker(sticker, L, W);
    ctx.restore();
  }

  function starPath(g, cx, cy, outer, inner, points) {
    g.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
      const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath();
  }

  function addFall(ev, pen) {
    falls.push({ ...ev, pen, t: 0 });
    drawn.delete(ev.uid);
    teetering.delete(ev.uid);
  }

  function softenNextFrames() {
    for (const d of drawn.values()) d.tau = SNAP_TAU;
  }

  window.addEventListener("resize", resize);
  if (window.visualViewport) window.visualViewport.addEventListener("resize", resize);
  resize();

  return {
    view, resize, draw, addFall, softenNextFrames, setTable, setStorm, drawPenSprite: drawPen,
    fx, camFollow, camHome, killCam, introPulse,
    confettiBurst() { fx.confetti(cw, ch, dpr); },
    shake(mag) { shakeMag = Math.min(16, shakeMag + mag); },
    setPreview(p) { preview = p; },
    setHighlight(uid, color) { highlightUid = uid; if (color) highlightColor = color; },
    set teeterCb(cb) { onTeeter = cb; }
  };
}

function rr(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function shadeOf(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, ((n >> 16) & 255) - 40);
  const g = Math.max(0, ((n >> 8) & 255) - 40);
  const b = Math.max(0, (n & 255) - 40);
  return `rgb(${r},${g},${b})`;
}
