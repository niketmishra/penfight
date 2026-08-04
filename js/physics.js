// Planck.js world for the table. Top-down, zero gravity.
// Table friction is dry (constant deceleration) plus a light viscous term,
// applied manually each step so pens stop crisply like on a real desk.
// Spinning pens curve (Magnus): lateral accel = k * omega * perp(v).

import * as pl from "../vendor/planck.mjs";
import { tableById, tableContains, tableHalf, inHole } from "./tables.js";

// Kept for compatibility with view fitting; the classroom desk dimensions.
export const TABLE = { w: 6.0, h: 9.0 };
export const HALF = { x: TABLE.w / 2, y: TABLE.h / 2 };

// Tuning knobs. All feel lives here and in pens.js.
export const PHYS = {
  dt: 1 / 120,               // fixed physics step
  fricDecel: 4.8,            // dry linear friction, units/s^2
  linVisc: 0.35,             // viscous linear drag, 1/s
  massComp: [0.4, 0.6],      // impulse = J * (0.4 + 0.6 * mass): heavy pens playable, still slower
  angFricDecel: 7.0,         // dry angular friction, rad/s^2
  angVisc: 0.5,              // viscous angular drag, 1/s
  maxOmega: 42,              // sanity cap on spin, rad/s
  magnusK: 0.008,            // spin curve strength
  magnusCap: 6.0,            // max lateral accel from spin, units/s^2
  bandBreak: 4.5,            // momentum needed to snap through the rubber band
  bandRestN: 0.42,           // band bounce, normal component
  bandRestT: 0.85,           // band bounce, tangential component
  wallRest: 0.55,            // wooden frame bounce (compass box walls)
  wallRestT: 0.9,            // frame bounce, tangential component
  airborneImpulse: 2.3,      // tip hits above this launch the victim
  airborneImpulseHeavy: 1.5, // launcher pens (metal) need less
  airborneTime: 0.42,        // seconds of flight
  mountGap: 0.42,            // landing this close to another pen mounts it
  settleLin: 0.06,           // below this speed a pen counts as still
  settleAng: 0.15,
  settleHold: 0.5,           // must stay still this long, seconds
  simCap: 8.0,               // hard cap on one turn's sim time, seconds
  hitImpulseMin: 0.55        // contacts above this fire hit events (sound, shake)
};

// The one impulse formula. Heavy pens get partial compensation so every pen
// is playable, but they still launch slower and travel shorter per swipe.
export function flickImpulse(pen, J) {
  return J * (PHYS.massComp[0] + PHYS.massComp[1] * pen.mass) * (pen.flickMult || 1);
}

// Reflect a pen that ran into the rubber band. Returns the bounced velocity
// and a position nudged back inside; shared by the live sim and the ghost
// trajectory so the preview never lies about the band either.
export function bandReflect(table, x, y, vx, vy, restN = PHYS.bandRestN, restT = PHYS.bandRestT) {
  let nx = 0, ny = 0, cx = x, cy = y;
  if (table.shape === "round") {
    const d = Math.hypot(x, y) || 0.001;
    nx = -x / d; ny = -y / d;
    const inR = table.r - 0.05;
    cx = (x / d) * inR; cy = (y / d) * inR;
  } else {
    const hx = table.w / 2, hy = table.h / 2;
    if (Math.abs(x) > hx) { nx = -Math.sign(x); cx = Math.sign(x) * (hx - 0.05); }
    if (Math.abs(y) > hy) { ny = -Math.sign(y); cy = Math.sign(y) * (hy - 0.05); }
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl; ny /= nl;
  }
  const vn = vx * nx + vy * ny;           // toward-inside component (negative when leaving)
  const vnx = vn * nx, vny = vn * ny;
  const vtx = vx - vnx, vty = vy - vny;
  return {
    x: cx, y: cy,
    vx: vtx * restT - vnx * restN,
    vy: vty * restT - vny * restN
  };
}

export function createSim({ table = tableById("classroom"), holes = [], zones = [], props = [], band = false, walls = false } = {}) {
  const world = new pl.World({ gravity: new pl.Vec2(0, 0) });
  const bodies = new Map();     // uid -> pen body
  const statics = [];           // furniture bodies (never in snapshots)
  const half = tableHalf(table);
  const airborne = new Map();   // uid -> {t, total}
  const mountPairs = new Set(); // "a|b" pairs excluded from collision
  let pendingHits = [];
  let pendingEvents = [];
  let stillTime = 0;
  let simTime = 0;

  const pairKey = (a, b) => (a < b ? a + "|" + b : b + "|" + a);

  // Airborne pens sail over everything on the desk, except the wooden frame:
  // nothing flies out of a compass box.
  world.on("pre-solve", contact => {
    const udA = contact.getFixtureA().getBody().getUserData() || {};
    const udB = contact.getFixtureB().getBody().getUserData() || {};
    if ((udA.uid && airborne.has(udA.uid)) || (udB.uid && airborne.has(udB.uid))) {
      if (udA.kind !== "wall" && udB.kind !== "wall") {
        contact.setEnabled(false);
        return;
      }
      return;
    }
    if (udA.uid && udB.uid && mountPairs.has(pairKey(udA.uid, udB.uid))) {
      contact.setEnabled(false);
    }
  });

  world.on("post-solve", (contact, impulse) => {
    let max = 0;
    for (const n of impulse.normalImpulses) max = Math.max(max, n);
    if (max < PHYS.hitImpulseMin) return;
    const bA = contact.getFixtureA().getBody();
    const bB = contact.getFixtureB().getBody();
    const wm = contact.getWorldManifold(null);
    const p = wm && wm.points.length ? wm.points[0] : bA.getPosition();
    const a = hitSide(bA, p), b = hitSide(bB, p);
    pendingHits.push({ type: "hit", impulse: max, x: p.x, y: p.y, a, b });

    // Hard tip hits launch the victim airborne (chadhai setup).
    const [fast, slow] = a.speed >= b.speed ? [a, b] : [b, a];
    if (!slow.uid || slow.furniture || !fast.uid) return;
    const victimBody = bodies.get(slow.uid);
    if (!victimBody) return;
    const victimPen = victimBody.getUserData().pen;
    if (victimPen.airborneImmune) return;
    const striker = fast.uid ? bodies.get(fast.uid) : null;
    const strikerPen = striker ? striker.getUserData().pen : null;
    const threshold = strikerPen && strikerPen.launcher ? PHYS.airborneImpulseHeavy : PHYS.airborneImpulse;
    if (slow.nearTip && max > threshold && !airborne.has(slow.uid)) {
      airborne.set(slow.uid, { t: PHYS.airborneTime, total: PHYS.airborneTime });
      pendingEvents.push({ type: "airborne", uid: slow.uid, x: p.x, y: p.y });
    }
  });

  function hitSide(body, worldPt) {
    const ud = body.getUserData() || {};
    const v = body.getLinearVelocity();
    const side = {
      uid: ud.uid ?? null,
      penId: ud.penId ?? null,
      furniture: Boolean(ud.furniture),
      mass: ud.pen ? ud.pen.mass : Infinity,
      speed: Math.hypot(v.x, v.y),
      nearTip: false
    };
    if (ud.pen) {
      const lp = body.getLocalPoint(new pl.Vec2(worldPt.x, worldPt.y));
      side.nearTip = Math.abs(lp.x) > (ud.pen.length / 2) * 0.62;
    }
    return side;
  }

  function addPen(pen, { uid, ownerId, x, y, angle, sticker, team }) {
    const hl = pen.length / 2;
    const r = pen.dia / 2;
    const body = world.createBody({
      type: "dynamic",
      position: new pl.Vec2(x, y),
      angle,
      bullet: true,
      linearDamping: 0,
      angularDamping: 0
    });
    // Capsule: central box plus a circle at each end. Long axis is local x.
    // Planck sums per-fixture masses, so the divisor must count BOTH circles
    // for the body mass to land exactly on pen.mass.
    const area = 2 * (hl - r) * pen.dia + Math.PI * r * r * 2;
    const density = (pen.mass * (pen.massMult || 1)) / area;
    const opts = { density, friction: pen.friction, restitution: pen.restitution };
    body.createFixture(new pl.Box(hl - r, r), opts);
    body.createFixture(new pl.Circle(new pl.Vec2(hl - r, 0), r), opts);
    body.createFixture(new pl.Circle(new pl.Vec2(-(hl - r), 0), r), opts);
    body.setUserData({ uid, ownerId, penId: pen.id, pen, sticker: sticker || null, team: team ?? null });
    bodies.set(uid, body);
    stillTime = 0;
    return body;
  }

  function removePen(uid) {
    const b = bodies.get(uid);
    if (b) { world.destroyBody(b); bodies.delete(uid); }
    airborne.delete(uid);
    for (const key of [...mountPairs]) {
      if (key.split("|").includes(uid)) mountPairs.delete(key);
    }
  }

  function addProp(prop) {
    const body = world.createBody({
      position: new pl.Vec2(prop.x, prop.y),
      angle: prop.angle || 0
    });
    const opts = { friction: prop.friction ?? 0.4, restitution: prop.restitution ?? 0.3 };
    if (prop.shape === "circle") body.createFixture(new pl.Circle(prop.r), opts);
    else body.createFixture(new pl.Box(prop.w / 2, prop.h / 2), opts);
    body.setUserData({ furniture: true, kind: prop.kind, prop });
    statics.push(body);
    return body;
  }
  for (const prop of props) addProp(prop);

  // Compass box: a wooden frame just outside the playing surface. Real static
  // bodies, so pens carom off them instead of falling; only holes eliminate.
  if (walls) {
    const wallOpts = { friction: 0.12, restitution: PHYS.wallRest };
    const thick = 0.3;
    const mk = fixture => {
      const body = world.createBody({ position: new pl.Vec2(0, 0) });
      body.createFixture(fixture, wallOpts);
      body.setUserData({ furniture: true, kind: "wall" });
      statics.push(body);
    };
    if (table.shape === "round") {
      const r = table.r + thick / 2;
      const verts = [];
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        verts.push(new pl.Vec2(Math.cos(a) * r, Math.sin(a) * r));
      }
      mk(new pl.Chain(verts, true));
    } else {
      const hx = half.x, hy = half.y, t = thick / 2;
      const side = (w, h, x, y) => {
        const body = world.createBody({ position: new pl.Vec2(x, y) });
        body.createFixture(new pl.Box(w, h), wallOpts);
        body.setUserData({ furniture: true, kind: "wall" });
        statics.push(body);
      };
      side(t, hy + thick, hx + t, 0);
      side(t, hy + thick, -hx - t, 0);
      side(hx + thick, t, 0, hy + t);
      side(hx + thick, t, 0, -hy - t);
    }
  }

  // params: { dx, dy, J, off } with (dx, dy) normalized, off along the pen's
  // long axis from its center. Offset flicks produce torque automatically.
  function applyFlick(uid, params) {
    const body = bodies.get(uid);
    if (!body) return false;
    const pen = body.getUserData().pen;
    const off = Math.max(-1, Math.min(1, params.off || 0)) * (pen.length / 2) * 0.9;
    const axis = body.getWorldVector(new pl.Vec2(1, 0));
    const pos = body.getPosition();
    const pt = new pl.Vec2(pos.x + axis.x * off, pos.y + axis.y * off);
    const J = flickImpulse(pen, params.J);
    body.applyLinearImpulse(new pl.Vec2(params.dx * J, params.dy * J), pt, true);
    stillTime = 0;
    simTime = 0;
    return true;
  }

  function frictionMultAt(x, y, pen) {
    let mult = table.frictionMult || 1;
    for (const z of zones) {
      if (pen.zoneImmune) break;
      const dx = x - z.x, dy = y - z.y;
      if (dx * dx + dy * dy <= z.r * z.r) mult *= z.frictionMult;
    }
    return mult;
  }

  // One fixed step. Returns events: hits and falls.
  function step() {
    const dt = PHYS.dt;
    pendingHits = [];

    for (const body of bodies.values()) {
      const d = body.getUserData().pen;
      const pos = body.getPosition();
      const zoneMult = frictionMultAt(pos.x, pos.y, d);
      const v = body.getLinearVelocity();
      let vx = v.x, vy = v.y;
      let w = body.getAngularVelocity();
      w = Math.max(-PHYS.maxOmega, Math.min(PHYS.maxOmega, w));

      // Magnus: spin bends the path. perp(v) = (-vy, vx).
      const sp0 = Math.hypot(vx, vy);
      const mk = PHYS.magnusK * (d.magnusMult || 1);
      if (mk && Math.abs(w) > 0.5 && sp0 > 0.4) {
        let ax = -mk * w * vy;
        let ay = mk * w * vx;
        const am = Math.hypot(ax, ay);
        if (am > PHYS.magnusCap) { ax *= PHYS.magnusCap / am; ay *= PHYS.magnusCap / am; }
        vx += ax * dt;
        vy += ay * dt;
      }

      // Dry + viscous table friction, scaled by table surface and zones.
      const sp = Math.hypot(vx, vy);
      if (sp > 0) {
        const drop = (PHYS.fricDecel * d.linDampMult * zoneMult + PHYS.linVisc * sp) * dt;
        const k = Math.max(0, sp - drop) / sp;
        vx *= k; vy *= k;
      }
      body.setLinearVelocity(new pl.Vec2(vx, vy));

      const aw = Math.abs(w);
      if (aw > 0) {
        const dropA = (PHYS.angFricDecel * d.angDampMult * Math.max(0.6, zoneMult) + PHYS.angVisc * aw) * dt;
        body.setAngularVelocity(Math.sign(w) * Math.max(0, aw - dropA));
      } else {
        body.setAngularVelocity(w);
      }
    }

    world.step(dt, 8, 3);
    simTime += dt;

    // Airborne flight timers: on landing, an overlap becomes a mount.
    for (const [uid, air] of [...airborne.entries()]) {
      air.t -= dt;
      if (air.t > 0) continue;
      airborne.delete(uid);
      const body = bodies.get(uid);
      if (!body) continue;
      const p = body.getPosition();
      let under = null;
      for (const [ouid, other] of bodies.entries()) {
        if (ouid === uid) continue;
        const op = other.getPosition();
        if (Math.hypot(p.x - op.x, p.y - op.y) < PHYS.mountGap
          && !other.getUserData().pen.airborneImmune) { under = ouid; break; }
      }
      if (under) {
        mountPairs.add(pairKey(uid, under));
        pendingEvents.push({ type: "mount", rider: uid, under, x: p.x, y: p.y });
      } else {
        pendingEvents.push({ type: "land", uid, x: p.x, y: p.y });
      }
    }

    // Mounted pairs separate once they drift apart.
    for (const key of [...mountPairs]) {
      const [a, b] = key.split("|");
      const ba = bodies.get(a), bb = bodies.get(b);
      if (!ba || !bb) { mountPairs.delete(key); continue; }
      const pa = ba.getPosition(), pb = bb.getPosition();
      if (Math.hypot(pa.x - pb.x, pa.y - pb.y) > PHYS.mountGap * 2.2) mountPairs.delete(key);
    }

    const events = [...pendingHits, ...pendingEvents];
    pendingEvents = [];
    // A pen is gone the moment its center of mass leaves the surface or
    // drops into a hole. With the rubber band up, slow leavers get thrown
    // back in; only real momentum snaps through.
    for (const [uid, body] of [...bodies.entries()]) {
      const p = body.getPosition();
      const offTable = !tableContains(table, p.x, p.y);
      const hole = offTable ? null : inHole(holes, p.x, p.y);
      if (!offTable && !hole) continue;

      // Inside the wooden frame nothing leaves over the edge; a center that
      // still crosses (corner tunneling) gets shoved back onto the board.
      if (offTable && walls) {
        const v0 = body.getLinearVelocity();
        const r = bandReflect(table, p.x, p.y, v0.x, v0.y, PHYS.wallRest, PHYS.wallRestT);
        body.setTransform(new pl.Vec2(r.x, r.y), body.getAngle());
        body.setLinearVelocity(new pl.Vec2(r.vx, r.vy));
        stillTime = 0;
        continue;
      }

      const v = body.getLinearVelocity();
      const pen = body.getUserData().pen;
      const momentum = pen.mass * Math.hypot(v.x, v.y);
      if (offTable && band && momentum < PHYS.bandBreak && !airborne.has(uid)) {
        const r = bandReflect(table, p.x, p.y, v.x, v.y);
        body.setTransform(new pl.Vec2(r.x, r.y), body.getAngle());
        body.setLinearVelocity(new pl.Vec2(r.vx, r.vy));
        events.push({ type: "bandCatch", uid, x: r.x, y: r.y, ownerId: body.getUserData().ownerId });
        stillTime = 0;
        continue;
      }

      events.push({
        type: "fall", uid,
        cause: hole ? "hole" : "edge",
        hole,
        brokeBand: Boolean(offTable && band),
        ownerId: body.getUserData().ownerId,
        penId: body.getUserData().penId,
        sticker: body.getUserData().sticker,
        team: body.getUserData().team,
        x: p.x, y: p.y, angle: body.getAngle(),
        vx: v.x, vy: v.y, w: body.getAngularVelocity()
      });
      world.destroyBody(body);
      bodies.delete(uid);
    }

    if (allStill()) stillTime += dt; else stillTime = 0;
    return events;
  }

  function allStill() {
    if (airborne.size) return false;
    for (const body of bodies.values()) {
      const v = body.getLinearVelocity();
      if (Math.hypot(v.x, v.y) > PHYS.settleLin) return false;
      if (Math.abs(body.getAngularVelocity()) > PHYS.settleAng) return false;
    }
    return true;
  }

  // Forward-integrate the flick with the exact same drag + Magnus math,
  // ignoring collisions. Feeds the dotted aim trajectory, so what you see
  // is what the desk will do.
  function predictPath(uid, params, maxT = 4) {
    const body = bodies.get(uid);
    if (!body) return null;
    const pen = body.getUserData().pen;
    const effMass = pen.mass * (pen.massMult || 1);
    const J = flickImpulse(pen, params.J);
    const pos = body.getPosition();
    const a0 = body.getAngle();
    const off = Math.max(-1, Math.min(1, params.off || 0)) * (pen.length / 2) * 0.9;
    const rX = Math.cos(a0) * off, rY = Math.sin(a0) * off;
    let vx = params.dx * J / effMass, vy = params.dy * J / effMass;
    const I = effMass * pen.length * pen.length / 12;
    let w = (rX * params.dy * J - rY * params.dx * J) / I;
    w = Math.max(-PHYS.maxOmega, Math.min(PHYS.maxOmega, w));
    let x = pos.x, y = pos.y;
    let ang = a0;
    const dt = PHYS.dt;   // same step as the real sim so the ghost never lies
    const points = [];
    let exit = null;
    const hlPen = pen.length / 2, rPen = pen.dia / 2;
    for (let t = 0, i = 0; t < maxT; t += dt, i++) {
      const sp0 = Math.hypot(vx, vy);
      if (sp0 <= PHYS.settleLin) break;
      const mk = PHYS.magnusK * (pen.magnusMult || 1);
      if (mk && Math.abs(w) > 0.5 && sp0 > 0.4) {
        let ax = -mk * w * vy, ay = mk * w * vx;
        const am = Math.hypot(ax, ay);
        if (am > PHYS.magnusCap) { ax *= PHYS.magnusCap / am; ay *= PHYS.magnusCap / am; }
        vx += ax * dt; vy += ay * dt;
      }
      const zoneMult = frictionMultAt(x, y, pen);
      const sp = Math.hypot(vx, vy);
      const drop = (PHYS.fricDecel * pen.linDampMult * zoneMult + PHYS.linVisc * sp) * dt;
      const k = Math.max(0, sp - drop) / sp;
      vx *= k; vy *= k;
      const aw = Math.abs(w);
      if (aw > 0) {
        const dropA = (PHYS.angFricDecel * pen.angDampMult * Math.max(0.6, zoneMult) + PHYS.angVisc * aw) * dt;
        w = Math.sign(w) * Math.max(0, aw - dropA);
      }
      x += vx * dt; y += vy * dt;
      if (i % 6 === 0) points.push({ x, y });
      if (inHole(holes, x, y)) { exit = { x, y }; break; }
      if (walls) {
        // The real body bounces when its hull meets the wall, not its
        // center: shrink the table by the capsule's extent along each wall
        // normal (nose-first hits reach much further than side hits).
        ang += w * dt;
        if (table.shape === "round") {
          const d = Math.hypot(x, y) || 0.001;
          const ext = hlPen * Math.abs((Math.cos(ang) * x + Math.sin(ang) * y) / d) + rPen;
          const wt = { shape: "round", r: table.r - ext };
          if (!tableContains(wt, x, y)) {
            const rw = bandReflect(wt, x, y, vx, vy, PHYS.wallRest, PHYS.wallRestT);
            x = rw.x; y = rw.y; vx = rw.vx; vy = rw.vy;
          }
        } else {
          const ex = hlPen * Math.abs(Math.cos(ang)) + rPen;
          const ey = hlPen * Math.abs(Math.sin(ang)) + rPen;
          const wt = { shape: "rect", w: table.w - 2 * ex, h: table.h - 2 * ey };
          if (!tableContains(wt, x, y)) {
            const rw = bandReflect(wt, x, y, vx, vy, PHYS.wallRest, PHYS.wallRestT);
            x = rw.x; y = rw.y; vx = rw.vx; vy = rw.vy;
          }
        }
        continue;
      }
      if (!tableContains(table, x, y)) {
        const mom = pen.mass * Math.hypot(vx, vy);
        if (band && mom < PHYS.bandBreak) {
          const rr2 = bandReflect(table, x, y, vx, vy);
          x = rr2.x; y = rr2.y; vx = rr2.vx; vy = rr2.vy;
        } else {
          exit = { x, y };
          break;
        }
      }
    }
    return { points, end: { x, y }, exit };
  }

  // 0..1 flight arc for the renderer's lift and shadow separation.
  function airborneLift(uid) {
    const air = airborne.get(uid);
    if (!air) return 0;
    const k = 1 - air.t / air.total;          // 0 at launch, 1 at landing
    return Math.sin(k * Math.PI);             // parabolic-ish arc
  }

  function isSettled() {
    return stillTime >= PHYS.settleHold || simTime >= PHYS.simCap;
  }

  function snapshot() {
    const out = [];
    for (const [uid, body] of bodies.entries()) {
      const p = body.getPosition();
      out.push({ uid, x: round3(p.x), y: round3(p.y), angle: round3(body.getAngle()) });
    }
    return out;
  }

  // Snap bodies to an authoritative snapshot. Anything missing from it fell.
  function applySnapshot(states, fallenUids = []) {
    for (const uid of fallenUids) removePen(uid);
    for (const s of states) {
      const body = bodies.get(s.uid);
      if (!body) continue;
      body.setTransform(new pl.Vec2(s.x, s.y), s.angle);
      body.setLinearVelocity(new pl.Vec2(0, 0));
      body.setAngularVelocity(0);
    }
    stillTime = PHYS.settleHold;
  }

  function eachPen(cb) {
    for (const [uid, body] of bodies.entries()) {
      const p = body.getPosition();
      cb(uid, body.getUserData(), p.x, p.y, body.getAngle(), body);
    }
  }

  return {
    world, bodies, statics, table, holes, zones, props, half, band, walls,
    addPen, removePen, addProp, applyFlick, step, airborneLift, predictPath,
    isSettled, snapshot, applySnapshot, eachPen,
    resetSimClock() { simTime = 0; stillTime = 0; },
    getBody(uid) { return bodies.get(uid); }
  };
}

function round3(n) { return Math.round(n * 1000) / 1000; }
