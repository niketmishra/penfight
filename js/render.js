// Canvas renderer. Top-down desk, vector pens, fall animations, aim ghost,
// screen shake. Drawn transforms chase physics transforms with a short
// exponential smoothing, which both smooths fixed-step motion and softens
// authoritative snap corrections in online play.

import { tableById, tableHalf } from "./tables.js";

const MARGIN = 0.7;           // world units of floor visible around the table
const SMOOTH_TAU = 0.045;     // seconds, render chase time constant
const SNAP_TAU = 0.12;        // slower chase right after a snapshot correction

export function createRenderer(canvas) {
  const ctx = canvas.getContext("2d");
  let dpr = 1, cw = 0, ch = 0, scale = 1, ox = 0, oy = 0;
  let deskCache = null;
  let table = tableById("classroom");
  let holes = [];
  const drawn = new Map();     // uid -> {x, y, angle, tau}
  const falls = [];            // active fall animations
  let shakeMag = 0;
  let preview = null;
  let highlightUid = null;
  let highlightColor = "#ffd166";

  const view = {
    toWorld(clientX, clientY) {
      const r = canvas.getBoundingClientRect();
      const px = (clientX - r.left) * (cw / r.width);
      const py = (clientY - r.top) * (ch / r.height);
      return { x: (px - ox) / scale, y: (py - oy) / scale };
    },
    toScreen(wx, wy) { return { x: ox + wx * scale, y: oy + wy * scale }; },
    get pxPerUnit() { return scale; }
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
  }

  function setTable(t, opts = {}) {
    table = t;
    holes = opts.holes || [];
    fitView();
    deskCache = null;
  }

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

  function buildDesk() {
    deskCache = document.createElement("canvas");
    deskCache.width = cw;
    deskCache.height = ch;
    const g = deskCache.getContext("2d");
    const th = table.theme;
    const half = tableHalf(table);
    const x0 = ox - half.x * scale, y0 = oy - half.y * scale;
    const tw = half.x * 2 * scale, tht = half.y * 2 * scale;

    // Floor
    g.fillStyle = th.floor;
    g.fillRect(0, 0, cw, ch);

    // Drop shadow under the desk
    g.save();
    g.translate(6 * (dpr / 2), 12 * (dpr / 2));
    g.fillStyle = "rgba(0,0,0,0.55)";
    deskPath(g);
    g.fill();
    g.restore();

    // Desk top
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
      // Brushed circular sheen
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
      // A forgotten question paper under the fight
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

    // Inkwell holes (Compass Box mode)
    for (const h of holes) {
      const c = view.toScreen(h.x, h.y);
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

    // Edge bevel
    g.strokeStyle = th.edge;
    g.lineWidth = 3 * dpr;
    deskPath(g);
    g.stroke();
    g.strokeStyle = "rgba(255,220,170,0.18)";
    g.lineWidth = 1 * dpr;
    deskPath(g, 2 * dpr);
    g.stroke();
  }

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
    d.tau += (SMOOTH_TAU - d.tau) * k * 0.5;   // relax back to fast chase
    return d;
  }

  function draw(sim, dt, tNow) {
    if (!deskCache) buildDesk();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    if (shakeMag > 0.01) {
      ctx.translate((Math.random() - 0.5) * shakeMag * dpr, (Math.random() - 0.5) * shakeMag * dpr);
      shakeMag *= Math.exp(-dt / 0.09);
    } else shakeMag = 0;

    ctx.drawImage(deskCache, 0, 0);

    // Fall animations, under the live pens
    for (let i = falls.length - 1; i >= 0; i--) {
      const f = falls[i];
      const t = (tNow - f.t0) / 600;
      if (t >= 1) { falls.splice(i, 1); continue; }
      const decay = Math.exp(-t * 2.2);
      const x = f.x + f.vx * t * 0.4;
      const y = f.y + f.vy * t * 0.4 + t * t * 0.55;   // slight gravity sell
      const a = f.angle + f.w * t * 0.35;
      drawPen(f.pen, x, y, a, 1 - t * 0.5, 1 - t, false);
    }

    // Live pens
    const seen = new Set();
    sim.eachPen((uid, data, x, y, angle) => {
      seen.add(uid);
      const d = chase(uid, x, y, angle, dt);
      const isHl = uid === highlightUid;
      if (isHl) drawHighlight(d.x, d.y, data.pen, tNow);
      drawPen(data.pen, d.x, d.y, d.angle, 1, 1, true);
    });
    for (const uid of [...drawn.keys()]) if (!seen.has(uid)) drawn.delete(uid);

    if (preview) drawPreview(preview, tNow);
  }

  function drawHighlight(x, y, pen, tNow) {
    const s = view.toScreen(x, y);
    const pulse = 1 + 0.06 * Math.sin(tNow / 220);
    const r = (pen.length / 2 + 0.35) * scale * pulse;
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
    const len = (0.8 + p.power * 3.2) * scale;
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
    // Arrowhead
    const ex = s.x + p.dx * len, ey = s.y + p.dy * len;
    const aa = Math.atan2(p.dy, p.dx);
    ctx.fillStyle = "rgba(255,209,102,0.85)";
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - Math.cos(aa - 0.45) * 10 * dpr, ey - Math.sin(aa - 0.45) * 10 * dpr);
    ctx.lineTo(ex - Math.cos(aa + 0.45) * 10 * dpr, ey - Math.sin(aa + 0.45) * 10 * dpr);
    ctx.fill();
    // Spin hint when hitting off center
    if (Math.abs(p.off) > 0.35) {
      ctx.strokeStyle = "rgba(255,209,102,0.6)";
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      const dir = p.off > 0 ? 1 : -1;
      ctx.arc(s.x, s.y, 0.45 * scale, aa + dir * 0.6, aa + dir * 2.2, dir < 0);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Vector pen, local long axis along +x, drawn at world (x, y, angle).
  function drawPen(pen, x, y, angle, sizeK, alpha, shadow) {
    const s = view.toScreen(x, y);
    const L = pen.length * scale * sizeK;
    const W = pen.dia * scale * sizeK * 1.35;   // slightly fat for readability
    const r = pen.render;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(angle);
    ctx.globalAlpha = alpha;

    if (shadow) {
      ctx.save();
      ctx.rotate(-angle);
      ctx.translate(0.055 * scale, 0.1 * scale);
      ctx.rotate(angle);
      ctx.fillStyle = "rgba(10,5,0,0.33)";
      rr(ctx, -L / 2, -W / 2, L, W, W / 2);
      ctx.fill();
      ctx.restore();
    }

    const hl = L / 2;
    if (r.shape === "pencil") {
      // Hexagonal pencil: flat body, ferrule and eraser at back, wood cone tip.
      const bodyLen = L * 0.78;
      ctx.fillStyle = r.body;
      ctx.fillRect(-hl + L * 0.14, -W / 2, bodyLen, W);
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.fillRect(-hl + L * 0.14, -W / 2, bodyLen, W * 0.22);
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.fillRect(-hl + L * 0.14, W / 2 - W * 0.22, bodyLen, W * 0.22);
      // Ferrule + eraser
      ctx.fillStyle = "#b9c0cc";
      ctx.fillRect(-hl + L * 0.05, -W / 2, L * 0.09, W);
      ctx.fillStyle = r.cap;
      rr(ctx, -hl, -W / 2, L * 0.07, W, W * 0.3);
      ctx.fill();
      // Sharpened tip
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
      // Barrel
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
      // Barrel sheen
      ctx.fillStyle = "rgba(255,255,255,0.28)";
      rr(ctx, -hl + L * 0.1, -W / 2 + W * 0.12, L * 0.8, W * 0.18, W * 0.09);
      ctx.fill();
      // Cap end (back)
      ctx.fillStyle = r.cap;
      rr(ctx, -hl, -W / 2, L * 0.3, W, W / 2);
      ctx.fill();
      if (r.clip) {
        ctx.fillStyle = shadeOf(r.cap);
        rr(ctx, -hl + L * 0.04, -W * 0.95, L * 0.2, W * 0.32, W * 0.12);
        ctx.fill();
      }
      // Tip cone (front)
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
    ctx.restore();
  }

  function addFall(ev, pen) {
    falls.push({ ...ev, pen, t0: performance.now() });
    drawn.delete(ev.uid);
  }

  // After an authoritative snapshot, let drawn pens glide to their new spots.
  function softenNextFrames() {
    for (const d of drawn.values()) d.tau = SNAP_TAU;
  }

  window.addEventListener("resize", resize);
  if (window.visualViewport) window.visualViewport.addEventListener("resize", resize);
  resize();

  return {
    view, resize, draw, addFall, softenNextFrames, setTable, drawPenSprite: drawPen,
    shake(mag) { shakeMag = Math.min(16, shakeMag + mag); },
    setPreview(p) { preview = p; },
    setHighlight(uid, color) { highlightUid = uid; if (color) highlightColor = color; }
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
