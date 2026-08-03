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
  fricDecel: 3.4,            // dry linear friction, units/s^2
  linVisc: 0.28,             // viscous linear drag, 1/s
  angFricDecel: 7.0,         // dry angular friction, rad/s^2
  angVisc: 0.5,              // viscous angular drag, 1/s
  maxOmega: 42,              // sanity cap on spin, rad/s
  magnusK: 0.008,            // spin curve strength
  magnusCap: 6.0,            // max lateral accel from spin, units/s^2
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

export function createSim({ table = tableById("classroom"), holes = [], zones = [], props = [] } = {}) {
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

  // Airborne pens sail over everything on the desk.
  world.on("pre-solve", contact => {
    const udA = contact.getFixtureA().getBody().getUserData() || {};
    const udB = contact.getFixtureB().getBody().getUserData() || {};
    if ((udA.uid && airborne.has(udA.uid)) || (udB.uid && airborne.has(udB.uid))) {
      contact.setEnabled(false);
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

  function addPen(pen, { uid, ownerId, x, y, angle }) {
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
    const area = 2 * (hl - r) * pen.dia + Math.PI * r * r;
    const density = (pen.mass * (pen.massMult || 1)) / area;
    const opts = { density, friction: pen.friction, restitution: pen.restitution };
    body.createFixture(new pl.Box(hl - r, r), opts);
    body.createFixture(new pl.Circle(new pl.Vec2(hl - r, 0), r), opts);
    body.createFixture(new pl.Circle(new pl.Vec2(-(hl - r), 0), r), opts);
    body.setUserData({ uid, ownerId, penId: pen.id, pen });
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
    const J = params.J * (pen.flickMult || 1);
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
    // drops into a hole.
    for (const [uid, body] of [...bodies.entries()]) {
      const p = body.getPosition();
      const offTable = !tableContains(table, p.x, p.y);
      const hole = offTable ? null : inHole(holes, p.x, p.y);
      if (offTable || hole) {
        const v = body.getLinearVelocity();
        events.push({
          type: "fall", uid,
          cause: hole ? "hole" : "edge",
          hole,
          ownerId: body.getUserData().ownerId,
          penId: body.getUserData().penId,
          x: p.x, y: p.y, angle: body.getAngle(),
          vx: v.x, vy: v.y, w: body.getAngularVelocity()
        });
        world.destroyBody(body);
        bodies.delete(uid);
      }
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
    world, bodies, statics, table, holes, zones, props, half,
    addPen, removePen, addProp, applyFlick, step, airborneLift,
    isSettled, snapshot, applySnapshot, eachPen,
    resetSimClock() { simTime = 0; stillTime = 0; },
    getBody(uid) { return bodies.get(uid); }
  };
}

function round3(n) { return Math.round(n * 1000) / 1000; }
