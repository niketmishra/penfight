// Planck.js world for the table. Top-down, zero gravity.
// Table friction is dry (constant deceleration) plus a light viscous term,
// applied manually each step so pens stop crisply like on a real desk.

import * as pl from "../vendor/planck.mjs";

export const TABLE = { w: 6.0, h: 9.0 };   // world units, portrait
export const HALF = { x: TABLE.w / 2, y: TABLE.h / 2 };

// Tuning knobs. All feel lives here and in pens.js.
export const PHYS = {
  dt: 1 / 120,               // fixed physics step
  fricDecel: 3.4,            // dry linear friction, units/s^2
  linVisc: 0.28,             // viscous linear drag, 1/s
  angFricDecel: 7.0,         // dry angular friction, rad/s^2
  angVisc: 0.5,              // viscous angular drag, 1/s
  maxOmega: 42,              // sanity cap on spin, rad/s
  settleLin: 0.06,           // below this speed a pen counts as still
  settleAng: 0.15,
  settleHold: 0.5,           // must stay still this long, seconds
  simCap: 8.0,               // hard cap on one turn's sim time, seconds
  hitImpulseMin: 0.55        // contacts above this fire hit events (sound, shake)
};

export function createSim() {
  const world = new pl.World({ gravity: new pl.Vec2(0, 0) });
  const bodies = new Map();   // uid -> body
  let pendingHits = [];
  let stillTime = 0;
  let simTime = 0;

  world.on("post-solve", (contact, impulse) => {
    let max = 0;
    for (const n of impulse.normalImpulses) max = Math.max(max, n);
    if (max < PHYS.hitImpulseMin) return;
    const wm = contact.getWorldManifold(null);
    const p = wm && wm.points.length ? wm.points[0] : contact.getFixtureA().getBody().getPosition();
    pendingHits.push({ type: "hit", impulse: max, x: p.x, y: p.y });
  });

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
    const density = pen.mass / area;
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
    body.applyLinearImpulse(new pl.Vec2(params.dx * params.J, params.dy * params.J), pt, true);
    stillTime = 0;
    simTime = 0;
    return true;
  }

  // One fixed step. Returns events: hits and falls.
  function step() {
    const dt = PHYS.dt;
    pendingHits = [];

    for (const body of bodies.values()) {
      const d = body.getUserData().pen;
      const v = body.getLinearVelocity();
      const sp = Math.hypot(v.x, v.y);
      if (sp > 0) {
        const drop = (PHYS.fricDecel * d.linDampMult + PHYS.linVisc * sp) * dt;
        const k = Math.max(0, sp - drop) / sp;
        body.setLinearVelocity(new pl.Vec2(v.x * k, v.y * k));
      }
      let w = body.getAngularVelocity();
      w = Math.max(-PHYS.maxOmega, Math.min(PHYS.maxOmega, w));
      const aw = Math.abs(w);
      if (aw > 0) {
        const dropA = (PHYS.angFricDecel * d.angDampMult + PHYS.angVisc * aw) * dt;
        body.setAngularVelocity(Math.sign(w) * Math.max(0, aw - dropA));
      }
    }

    world.step(dt, 8, 3);
    simTime += dt;

    const events = pendingHits;
    // A pen is off the table the moment its center of mass leaves the rect.
    for (const [uid, body] of [...bodies.entries()]) {
      const p = body.getPosition();
      if (Math.abs(p.x) > HALF.x || Math.abs(p.y) > HALF.y) {
        const v = body.getLinearVelocity();
        events.push({
          type: "fall", uid,
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
    for (const body of bodies.values()) {
      const v = body.getLinearVelocity();
      if (Math.hypot(v.x, v.y) > PHYS.settleLin) return false;
      if (Math.abs(body.getAngularVelocity()) > PHYS.settleAng) return false;
    }
    return true;
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
    world, bodies, addPen, removePen, applyFlick, step,
    isSettled, snapshot, applySnapshot, eachPen,
    resetSimClock() { simTime = 0; stillTime = 0; },
    getBody(uid) { return bodies.get(uid); }
  };
}

function round3(n) { return Math.round(n * 1000) / 1000; }
