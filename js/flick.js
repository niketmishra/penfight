// Flick input. Rest your palm on the glass, flick a finger through your pen.
//
// Pointer events (works for mouse and touch). A touch only becomes a flick
// candidate if it lands near the armed pen while aiming, so a resting palm or
// thumb elsewhere on the screen is ignored completely. A candidate fires only
// if it releases fast; a resting thumb never releases fast, so the flicking
// finger wins naturally.
//
// On release: direction = swipe velocity, impulse scales with finger speed
// (mass-independent, heavy pens genuinely need a faster flick), and the point
// where the swipe crossed the pen's long axis sets the contact offset, which
// turns into torque. Tip flicks spin, center flicks fly straight.

const ARM_EXTRA = 0.55;        // world units beyond pen half length
const SAMPLE_MS = 110;         // fit release velocity over this window
const MIN_FIRE = 5.0;          // world units/s, below this a release is aim-only
const MAX_SPEED = 40.0;        // world units/s, finger speed cap
const PREVIEW_MIN_DRAG = 0.12; // world units of travel before ghost shows
const DRAG_FULL = 3.0;         // drag distance for 100% power in aim mode
const CANCEL_DRAG = 0.35;      // release closer than this to the start = cancel
export const J_MAX = 10.5;     // impulse at max finger speed (before mass comp)
const POWER_CURVE = 0.85;      // concave: low swipes stay gentle and controllable

export function powerToJ(frac) {
  return J_MAX * Math.pow(Math.max(0, Math.min(1, frac)), POWER_CURVE);
}

export function createFlick(canvas, view) {
  const candidates = new Map();  // pointerId -> {samples: [{x, y, t}]}
  let armed = null;              // { body, pen }
  let onFire = null, onPreview = null;

  function arm(body, pen) { armed = { body, pen }; }
  function disarm() { armed = null; candidates.clear(); preview(null); }

  function preview(p) { if (onPreview) onPreview(p); }

  function penAxis() {
    const pos = armed.body.getPosition();
    const a = armed.body.getAngle();
    return { cx: pos.x, cy: pos.y, ax: Math.cos(a), ay: Math.sin(a), hl: armed.pen.length / 2 };
  }

  function down(e) {
    if (!armed) return;
    const w = view.toWorld(e.clientX, e.clientY);
    const { cx, cy, hl } = penAxis();
    const reach = (hl + ARM_EXTRA) * (armed.pen.armMult || 1);   // Lambu strikes from further
    if (Math.hypot(w.x - cx, w.y - cy) > reach) return;  // palm or stray touch
    candidates.set(e.pointerId, {
      origin: { x: w.x, y: w.y },
      samples: [{ x: w.x, y: w.y, t: performance.now() }]
    });
    e.preventDefault();
  }

  function move(e) {
    const rec = candidates.get(e.pointerId);
    if (!rec || !armed) return;
    e.preventDefault();
    const now = performance.now();
    const w = view.toWorld(e.clientX, e.clientY);
    rec.samples.push({ x: w.x, y: w.y, t: now });
    while (rec.samples.length > 2 && now - rec.samples[0].t > SAMPLE_MS) rec.samples.shift();

    const v = fitVelocity(rec.samples);
    const speed = Math.hypot(v.x, v.y);
    const dragDx = w.x - rec.origin.x, dragDy = w.y - rec.origin.y;
    const dragLen = Math.hypot(dragDx, dragDy);
    if (speed < MIN_FIRE && dragLen > PREVIEW_MIN_DRAG) {
      // Slow drag = carrom-style aiming: drag direction is the shot, drag
      // distance is the power, and the trajectory ghost shows the outcome.
      rec.aiming = true;
      const c = contact(rec);
      const power = Math.min(1, dragLen / DRAG_FULL);
      rec.aimParams = {
        dx: dragDx / (dragLen || 1), dy: dragDy / (dragLen || 1),
        J: powerToJ(power), off: c.off
      };
      preview({
        x: c.px, y: c.py,
        dx: rec.aimParams.dx, dy: rec.aimParams.dy,
        power,
        J: rec.aimParams.J,
        off: c.off,
        uid: armed.body.getUserData().uid
      });
    } else if (speed >= MIN_FIRE) {
      rec.aiming = false;
      preview(null);
    }
  }

  function up(e) {
    const rec = candidates.get(e.pointerId);
    candidates.delete(e.pointerId);
    preview(null);
    if (!rec || !armed) return;
    rec.samples.push({ ...rec.samples[rec.samples.length - 1] });
    const v = fitVelocity(rec.samples);
    const speed = Math.hypot(v.x, v.y);
    const a = armed;

    if (speed >= MIN_FIRE) {
      // Fast flick: fire from the swipe itself, the classic way.
      const c = contact(rec);
      const capped = Math.min(speed, MAX_SPEED);
      const params = {
        dx: v.x / speed, dy: v.y / speed,
        J: powerToJ(capped / MAX_SPEED),
        off: c.off
      };
      disarm();
      if (onFire) onFire(params, a);
      return;
    }

    // Aimed release: fire the shot the ghost was showing. A tiny drag back
    // toward the start cancels instead.
    const last = rec.samples[rec.samples.length - 1];
    const dragLen = Math.hypot(last.x - rec.origin.x, last.y - rec.origin.y);
    if (rec.aiming && rec.aimParams && dragLen > CANCEL_DRAG) {
      const params = rec.aimParams;
      disarm();
      if (onFire) onFire(params, a);
    }
  }

  // Where did the swipe cross the pen? Signed offset along the long axis,
  // -1..1 of half length. Fallback: closest axis point to the release.
  function contact(rec) {
    const { cx, cy, ax, ay, hl } = penAxis();
    const s = rec.samples;
    for (let i = s.length - 1; i > 0; i--) {
      const hit = segAxisIntersect(s[i - 1], s[i], cx, cy, ax, ay, hl);
      if (hit) return hit;
    }
    const last = s[s.length - 1];
    let d = (last.x - cx) * ax + (last.y - cy) * ay;
    d = Math.max(-hl, Math.min(hl, d));
    return { off: d / hl, px: cx + ax * d, py: cy + ay * d };
  }

  function segAxisIntersect(p1, p2, cx, cy, ax, ay, hl) {
    // Pen axis as a segment from -hl to +hl. Intersect with swipe segment.
    const rX = p2.x - p1.x, rY = p2.y - p1.y;
    const sX = ax * 2 * hl, sY = ay * 2 * hl;
    const oX = cx - ax * hl, oY = cy - ay * hl;
    const denom = rX * sY - rY * sX;
    if (Math.abs(denom) < 1e-9) return null;
    const t = ((oX - p1.x) * sY - (oY - p1.y) * sX) / denom;
    const u = ((oX - p1.x) * rY - (oY - p1.y) * rX) / denom;
    if (t < 0 || t > 1 || u < 0 || u > 1) return null;
    const px = p1.x + rX * t, py = p1.y + rY * t;
    return { off: u * 2 - 1, px, py };
  }

  // Least squares linear fit of x(t), y(t). Robust to one jittery event.
  function fitVelocity(samples) {
    const n = samples.length;
    if (n < 2) return { x: 0, y: 0 };
    const t0 = samples[0].t;
    let st = 0, stt = 0, sx = 0, sy = 0, stx = 0, sty = 0;
    for (const s of samples) {
      const t = (s.t - t0) / 1000;
      st += t; stt += t * t; sx += s.x; sy += s.y; stx += t * s.x; sty += t * s.y;
    }
    const denom = n * stt - st * st;
    if (Math.abs(denom) < 1e-9) {
      const a = samples[0], b = samples[n - 1];
      const dt = Math.max(1, b.t - a.t) / 1000;
      return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt };
    }
    return { x: (n * stx - st * sx) / denom, y: (n * sty - st * sy) / denom };
  }

  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", e => { candidates.delete(e.pointerId); preview(null); });

  return {
    arm, disarm,
    get armed() { return armed; },
    set fire(cb) { onFire = cb; },
    set previewCb(cb) { onPreview = cb; },
    destroy() {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
    }
  };
}
