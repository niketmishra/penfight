// Match controller. Owns the sim and the turn machine, shared by practice
// (autoAdvance true, bots drive their own turns) and online (autoAdvance
// false, room.js drives turns from host messages).

import { createSim, HALF, PHYS } from "./physics.js";
import { penById } from "./pens.js";

export function genLayout(players, rand = Math.random) {
  // Pens in a ring around the center, tangential-ish, with jitter.
  const n = players.length;
  const R = 2.05 + Math.min(0.5, n * 0.07);
  return players.map((p, i) => {
    const theta = (i / n) * Math.PI * 2 + Math.PI / 2 + (rand() - 0.5) * 0.25;
    const r = R + (rand() - 0.5) * 0.5;
    return {
      ownerId: p.id,
      penId: p.penId,
      x: Math.cos(theta) * r * (HALF.x / HALF.y) * 1.35,
      y: Math.sin(theta) * r,
      angle: theta + Math.PI / 2 + (rand() - 0.5) * 0.9
    };
  });
}

export function createMatch({ players, autoAdvance = true }) {
  const sim = createSim();
  const listeners = {};
  const state = {
    phase: "idle",            // idle | aiming | sim | over
    turnIdx: -1,
    currentId: null,
    order: [],
    fallenThisTurn: [],
    winnerId: null
  };
  const alive = new Map(players.map(p => [p.id, true]));
  const byId = new Map(players.map(p => [p.id, p]));

  function on(ev, cb) { (listeners[ev] = listeners[ev] || []).push(cb); }
  function emit(ev, data) { for (const cb of listeners[ev] || []) cb(data); }

  function start(layout, order) {
    const lay = layout || genLayout(players);
    for (const spot of lay) {
      sim.addPen(penById(spot.penId), {
        uid: spot.ownerId, ownerId: spot.ownerId,
        x: spot.x, y: spot.y, angle: spot.angle
      });
    }
    state.order = order || players.map(p => p.id);
    state.layout = lay;
    emit("start", { layout: lay, order: state.order });
    if (autoAdvance) advanceTurn();
  }

  function aliveIds() { return state.order.filter(id => alive.get(id)); }

  function nextAliveAfter(id, skip = new Set()) {
    const ord = state.order;
    const from = ord.indexOf(id);
    for (let k = 1; k <= ord.length; k++) {
      const cand = ord[(from + k) % ord.length];
      if (alive.get(cand) && !skip.has(cand)) return cand;
    }
    return null;
  }

  function setTurn(playerId, meta = {}) {
    if (state.phase === "over") return;
    state.turnIdx = meta.turnIdx != null ? meta.turnIdx : state.turnIdx + 1;
    state.currentId = playerId;
    state.phase = "aiming";
    state.fallenThisTurn = [];
    sim.resetSimClock();
    emit("turn", { playerId, turnIdx: state.turnIdx, player: byId.get(playerId), ...meta });
  }

  function advanceTurn() {
    const ids = aliveIds();
    if (ids.length <= 1) return finish(ids[0] || lastFallen());
    const next = state.currentId == null
      ? state.order.find(id => alive.get(id))
      : nextAliveAfter(state.currentId);
    setTurn(next);
  }

  function applyFlick(playerId, params) {
    if (state.phase !== "aiming" || playerId !== state.currentId) return false;
    if (!sim.applyFlick(playerId, params)) return false;
    state.phase = "sim";
    emit("flick", { playerId, params });
    return true;
  }

  let lastFall = null;
  function lastFallen() { return lastFall; }

  // Step physics with an accumulator. Returns true while anything is active.
  let acc = 0;
  function update(dtRaw) {
    acc = Math.min(acc + dtRaw, 0.25);
    while (acc >= PHYS.dt) {
      acc -= PHYS.dt;
      const events = sim.step();
      for (const ev of events) {
        if (ev.type === "hit") emit("hit", ev);
        else if (ev.type === "fall") {
          alive.set(ev.ownerId, false);
          lastFall = ev.ownerId;
          state.fallenThisTurn.push(ev.ownerId);
          emit("fall", { ...ev, player: byId.get(ev.ownerId) });
        }
      }
      if (state.phase === "sim" && sim.isSettled()) {
        state.phase = "settled";
        const result = {
          turnIdx: state.turnIdx,
          strikerId: state.currentId,
          finalStates: sim.snapshot(),
          fallen: [...state.fallenThisTurn],
          aliveCount: aliveIds().length
        };
        emit("settle", result);
        if (autoAdvance) {
          const ids = aliveIds();
          if (ids.length <= 1) finish(ids[0] || lastFallen());
          else advanceTurn();
        }
        break;
      }
    }
  }

  // Online reconcile: snap to the striker's authoritative result.
  function forceSettle(finalStates, fallenIds) {
    for (const id of fallenIds) {
      if (alive.get(id)) {
        alive.set(id, false);
        lastFall = id;
        const b = sim.getBody(id);
        if (b) {
          const p = b.getPosition();
          emit("fall", {
            type: "fall", uid: id, ownerId: id,
            penId: byId.get(id) ? byId.get(id).penId : null,
            x: p.x, y: p.y, angle: b.getAngle(), vx: 0, vy: 0.8, w: 2,
            player: byId.get(id)
          });
        }
      }
    }
    sim.applySnapshot(finalStates, fallenIds);
    if (state.phase === "sim") state.phase = "settled";
  }

  function finish(winnerId) {
    if (state.phase === "over") return;
    state.phase = "over";
    state.winnerId = winnerId;
    emit("over", { winnerId, winner: byId.get(winnerId) });
  }

  function markDead(id) { alive.set(id, false); }

  return {
    sim, players, byId, state, on,
    start, setTurn, advanceTurn, applyFlick, update, forceSettle, finish, markDead,
    aliveIds, nextAliveAfter,
    isAlive: id => Boolean(alive.get(id)),
    currentPlayer: () => byId.get(state.currentId)
  };
}
