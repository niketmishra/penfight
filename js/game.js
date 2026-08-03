// Match controller. Owns the sim and the turn machine, shared by practice
// (autoAdvance true, bots drive their own turns) and online (autoAdvance
// false, room.js drives turns from host messages). Win decisions all go
// through modes.decideWinner; game state stays here, the rule lives there.

import { createSim, PHYS } from "./physics.js";
import { penById } from "./pens.js";
import { modeById, decideWinner } from "./modes.js";
import { tableById, tableHalf, holesFor, genProps, edgeClearance } from "./tables.js";

export function genLayout(players, table = tableById("classroom"), rand = Math.random) {
  // Pens in a ring around the center, tangential-ish, with jitter.
  const n = players.length;
  const half = tableHalf(table);
  const rx = half.x * 0.62, ry = half.y * 0.48;
  return players.map((p, i) => {
    const theta = (i / n) * Math.PI * 2 + Math.PI / 2 + (rand() - 0.5) * 0.25;
    const wobble = 1 + (rand() - 0.5) * 0.18;
    return {
      ownerId: p.id,
      penId: p.penId,
      x: Math.cos(theta) * rx * wobble,
      y: Math.sin(theta) * ry * wobble,
      angle: theta + Math.PI / 2 + (rand() - 0.5) * 0.9
    };
  });
}

export function createMatch({ players, autoAdvance = true, mode = "classic", tableId = "classroom", flickLimit = 0, props = null, zones = null, holes: holesOverride = null }) {
  const modeCfg = typeof mode === "string" ? modeById(mode) : mode;
  const table = tableById(tableId);
  const holes = holesOverride != null ? holesOverride : modeCfg.holes ? holesFor(table) : [];
  const clutter = props != null ? { props, zones: zones || [] }
    : modeCfg.targets ? { props: [], zones: [] }
    : genProps(table);
  const sim = createSim({ table, holes, props: clutter.props, zones: clutter.zones });
  const listeners = {};
  const state = {
    phase: "idle",            // idle | aiming | sim | settled | over
    turnIdx: -1,
    currentId: null,
    order: [],
    fallenThisTurn: [],
    skippedThisTurn: [],
    skipNext: new Set(),      // pens that miss their next turn (mounted)
    flicksUsed: 0,
    winnerId: null,
    winnerTeam: null
  };
  const alive = new Map(players.map(p => [p.id, true]));
  const byId = new Map(players.map(p => [p.id, p]));
  const targetUids = new Set();   // academy target pens, not owned by players

  function on(ev, cb) { (listeners[ev] = listeners[ev] || []).push(cb); }
  function emit(ev, data) { for (const cb of listeners[ev] || []) cb(data); }

  function start(layout, order) {
    const lay = layout || genLayout(players, table);
    for (const spot of lay) {
      const uid = spot.uid ?? spot.ownerId;
      const owner = byId.get(spot.ownerId);
      sim.addPen(penById(spot.penId), {
        uid, ownerId: spot.ownerId ?? null,
        x: spot.x, y: spot.y, angle: spot.angle,
        sticker: owner ? owner.sticker : null
      });
      if (spot.target) targetUids.add(uid);
    }
    state.order = order || players.map(p => p.id);
    state.layout = lay;
    emit("start", { layout: lay, order: state.order });
    if (autoAdvance) advanceTurn();
  }

  function aliveIds() { return state.order.filter(id => alive.get(id)); }

  function entries() {
    return players.map(p => ({ id: p.id, alive: Boolean(alive.get(p.id)), team: p.team }));
  }

  function verdict() {
    if (modeCfg.targets) {
      if (targetUids.size === 0) {
        return { over: true, winnerId: players[0].id, winnerTeam: null, won: true };
      }
      if (flickLimit && state.flicksUsed >= flickLimit) {
        return { over: true, winnerId: null, winnerTeam: null, won: false };
      }
      if (!alive.get(players[0].id)) {
        return { over: true, winnerId: null, winnerTeam: null, won: false };
      }
      return { over: false };
    }
    return decideWinner(entries(), modeCfg, { lastFallen: lastFall });
  }

  function setTurn(playerId, meta = {}) {
    if (state.phase === "over") return;
    state.turnIdx = meta.turnIdx != null ? meta.turnIdx : state.turnIdx + 1;
    state.currentId = playerId;
    state.phase = "aiming";
    state.fallenThisTurn = [];
    state.skippedThisTurn = [];
    sim.resetSimClock();
    emit("turn", { playerId, turnIdx: state.turnIdx, player: byId.get(playerId), ...meta });
  }

  // Pick the next alive seat after the current one, honoring skipNext:
  // a skipped pen is passed over exactly once, then plays normally.
  function pickNext() {
    const ord = state.order;
    if (!ord.length) return null;
    const from = state.currentId == null ? -1 : ord.indexOf(state.currentId);
    for (let k = 1; k <= ord.length * 2; k++) {
      const cand = ord[(from + k) % ord.length];
      if (!alive.get(cand)) continue;
      if (state.skipNext.has(cand)) {
        state.skipNext.delete(cand);
        emit("skipped", { playerId: cand, player: byId.get(cand) });
        continue;
      }
      return cand;
    }
    return null;
  }

  function advanceTurn() {
    const v = verdict();
    if (v.over) return finish(v);
    const next = pickNext();
    if (next == null) return finish(verdict());
    setTurn(next);
  }

  function applyFlick(playerId, params) {
    if (state.phase !== "aiming" || playerId !== state.currentId) return false;
    if (!sim.applyFlick(playerId, params)) return false;
    state.phase = "sim";
    state.flicksUsed += 1;
    emit("flick", { playerId, params });
    return true;
  }

  let lastFall = null;

  // Step physics with an accumulator. dtRaw may be time-dilated by the
  // caller (kill cam): all internal timers run on sim time, so that is safe.
  let acc = 0;
  function update(dtRaw) {
    acc = Math.min(acc + dtRaw, 0.25);
    while (acc >= PHYS.dt) {
      acc -= PHYS.dt;
      const events = sim.step();
      for (const ev of events) {
        if (ev.type === "hit") emit("hit", ev);
        else if (ev.type === "fall") handleFall(ev);
        else if (ev.type === "airborne") emit("airborne", { ...ev, player: byId.get(ev.uid) });
        else if (ev.type === "land") emit("land", ev);
        else if (ev.type === "mount") {
          markSkip(ev.under);
          emit("mount", {
            ...ev,
            riderPlayer: byId.get(ev.rider),
            underPlayer: byId.get(ev.under)
          });
        }
      }
      if (state.phase === "sim" && sim.isSettled()) {
        applyStorm();
        state.phase = "settled";
        const v = verdict();
        const result = {
          turnIdx: state.turnIdx,
          strikerId: state.currentId,
          finalStates: sim.snapshot(),
          fallen: [...state.fallenThisTurn],
          skipped: [...state.skippedThisTurn],
          aliveCount: aliveIds().length,
          gameOver: v.over,
          winnerId: v.over ? v.winnerId : null,
          winnerTeam: v.over ? v.winnerTeam : null
        };
        emit("settle", result);
        if (autoAdvance) {
          if (v.over) finish(v);
          else advanceTurn();
        }
        break;
      }
    }
  }

  // Chalk-line storm: the safe zone shrinks as the match drags on.
  // Pure function of turnIdx, so online clients agree without messages.
  function stormInset(turnIdx) {
    if (!modeCfg.storm) return 0;
    const start = players.length * 3 + 2;
    const half = tableHalf(table);
    const cap = Math.min(half.x, half.y) - 1.1;
    return Math.min(cap, Math.max(0, turnIdx - start) * 0.22);
  }

  function applyStorm() {
    const base = stormInset(state.turnIdx);
    if (base <= 0) return;
    for (const [uid, body] of [...sim.bodies.entries()]) {
      const pen = body.getUserData().pen;
      const eff = stormInset(state.turnIdx - (pen.stormGrace || 0) * 4);
      if (eff <= 0) continue;
      const p = body.getPosition();
      if (edgeClearance(table, p.x, p.y) < eff) {
        const ev = {
          type: "fall", uid, cause: "storm",
          ownerId: body.getUserData().ownerId,
          penId: body.getUserData().penId,
          x: p.x, y: p.y, angle: body.getAngle(), vx: 0, vy: 0.6, w: 3
        };
        sim.removePen(uid);
        handleFall(ev);
      }
    }
  }

  function handleFall(ev) {
    if (targetUids.has(ev.uid)) {
      targetUids.delete(ev.uid);
      emit("fall", { ...ev, target: true, player: null });
      state.fallenThisTurn.push(ev.uid);
      return;
    }
    if (byId.has(ev.ownerId)) {
      alive.set(ev.ownerId, false);
      lastFall = ev.ownerId;
      state.fallenThisTurn.push(ev.ownerId);
    }
    emit("fall", { ...ev, player: byId.get(ev.ownerId) });
  }

  // A mounted pen misses its next turn. Recorded during sim, shipped in the
  // settle result so online clients and host agree.
  function markSkip(uid) {
    if (byId.has(uid) && alive.get(uid)) {
      state.skipNext.add(uid);
      if (!state.skippedThisTurn.includes(uid)) state.skippedThisTurn.push(uid);
    }
  }

  // Online reconcile: snap to the striker's authoritative result.
  function forceSettle(finalStates, fallenIds, skippedIds = []) {
    for (const id of fallenIds) {
      if (byId.has(id) ? alive.get(id) : sim.getBody(id)) {
        const b = sim.getBody(id);
        if (byId.has(id)) { alive.set(id, false); lastFall = id; }
        targetUids.delete(id);
        if (b) {
          const p = b.getPosition();
          emit("fall", {
            type: "fall", uid: id, ownerId: id, cause: "edge",
            penId: b.getUserData().penId,
            x: p.x, y: p.y, angle: b.getAngle(), vx: 0, vy: 0.8, w: 2,
            player: byId.get(id)
          });
        }
      }
    }
    for (const id of skippedIds) markSkip(id);
    sim.applySnapshot(finalStates, fallenIds);
    if (state.phase === "sim") state.phase = "settled";
  }

  function finish(v) {
    if (state.phase === "over") return;
    state.phase = "over";
    state.winnerId = v.winnerId ?? null;
    state.winnerTeam = v.winnerTeam ?? null;
    emit("over", {
      winnerId: state.winnerId,
      winnerTeam: state.winnerTeam,
      winner: byId.get(state.winnerId),
      won: v.won
    });
  }

  function markDead(id) { alive.set(id, false); }

  return {
    sim, players, byId, state, on, mode: modeCfg, table, holes,
    props: clutter.props, zones: clutter.zones,
    start, setTurn, advanceTurn, applyFlick, update, forceSettle, finish,
    markDead, markSkip, stormInset,
    aliveIds, targetsLeft: () => targetUids.size,
    isAlive: id => Boolean(alive.get(id)),
    currentPlayer: () => byId.get(state.currentId)
  };
}
