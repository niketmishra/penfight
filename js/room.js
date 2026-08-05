// Online room session. Host is authoritative for the roster and turn flow,
// the striker is authoritative for physics. All live state is broadcast and
// presence; the rooms table is only a rendezvous.

import { EV, valid } from "./protocol.js";
import { genCode } from "./code.js";
import { insertRoom, fetchRoom, setRoomStatus, openChannel } from "./net.js";
import { genLayout } from "./game.js";
import { modeById, decideWinner, teamOfSeat } from "./modes.js";
import { tableById, genProps } from "./tables.js";

const TURN_SECONDS = 20;
const PLACEMENT_MS = 15000;      // pen placement window at round start
const SETTLE_GRACE_MS = 15000;   // striker crashed mid-sim (covers one kill cam)
const LEAVE_GRACE_MS = 10000;    // refresh window before a player counts as gone
const MAX_PLAYERS = 6;

export async function createRoomSession(me) {
  let code = null;
  for (let i = 0; i < 3; i++) {
    const c = genCode();
    const err = await insertRoom(c);   // host_id comes from the auth session
    if (!err) { code = c; break; }
    if (err.code !== "23505") throw new Error(err.message);   // not a dup key
  }
  if (!code) throw new Error("Could not find a free room code, try again");
  return connect(code, me, true);
}

export async function joinRoomSession(code, me) {
  const room = await fetchRoom(code);
  if (!room) throw new Error("No room with that code");
  if (room.status !== "lobby") throw new Error("That game already started");
  return connect(code, me, false);
}

async function connect(code, me, amCreator) {
  const listeners = {};
  const s = {
    code,
    playerId: me.playerId,
    hostId: amCreator ? me.playerId : null,
    seq: 0,
    players: [],              // [{id, name, penId, seat, ready, connected, alive}]
    status: "lobby",
    modeId: me.modeId || "classic",
    tableId: me.tableId || "classroom",
    band: me.band !== false,
    match: null,
    on(ev, cb) { (listeners[ev] = listeners[ev] || []).push(cb); },
    get isHost() { return s.hostId === s.playerId; },
    get roster() { return s.players; },
    get mode() { return modeById(s.modeId); }
  };
  const emit = (ev, data) => { for (const cb of listeners[ev] || []) cb(data); };

  function teamOf(p) { return s.mode.teams ? teamOfSeat(p.seat) : undefined; }

  function rosterEntries() {
    return s.players.map(p => ({
      id: p.id, alive: Boolean(p.alive), connected: p.connected !== false, team: teamOf(p)
    }));
  }

  let lastFallenId = null;
  const pendingSkips = new Set();

  function roomVerdict({ requireConnected = false } = {}) {
    return decideWinner(rosterEntries(), s.mode, { lastFallen: lastFallenId, requireConnected });
  }

  function announceGameOver(v) {
    const winnerId = v.winnerId || (s.players[0] && s.players[0].id);
    if (!winnerId) return;
    send(EV.GAME_OVER, { winnerId, winnerTeam: v.winnerTeam ?? null });
    onGameOver(winnerId, v.winnerTeam ?? null);
  }

  const channel = await openChannel(code, me.playerId);
  const graceTimers = new Map();
  let hostWatchTimer = null;
  let turnTimer = null;
  let settleWatch = null;
  let lastTurn = { turnIdx: -1, playerId: null };
  let rematchVotes = new Set();
  let seatOrder = null;        // stable seating; the first shot rotates through it
  let roundNo = 0;
  const placeDone = new Set();
  let roundOpened = false;
  let startTimer = null;

  // First turn of a round fires exactly once: early when everyone is done
  // placing, or from the fallback clock.
  function openRound() {
    if (roundOpened || !s.isHost || s.status !== "playing") return;
    roundOpened = true;
    clearTimeout(startTimer);
    hostNextTurn();
  }

  function send(event, payload) {
    channel.send({ type: "broadcast", event, payload: { from: s.playerId, ...payload } });
  }

  // ---- roster helpers (host) ----

  function findP(id) { return s.players.find(p => p.id === id); }

  function broadcastRoster() {
    s.seq += 1;
    send(EV.ROSTER, { seq: s.seq, hostId: s.hostId, players: s.players, status: s.status });
    emit("roster", s.players);
  }

  function hostAdd(p) {
    const existing = findP(p.id);
    if (existing) {
      Object.assign(existing, { name: p.name, penId: p.penId, sticker: p.sticker || null, connected: true });
    } else {
      if (s.status !== "lobby" || s.players.length >= MAX_PLAYERS) return;
      s.players.push({
        id: p.id, name: p.name, penId: p.penId, sticker: p.sticker || null,
        seat: s.players.length, ready: p.id === s.hostId,
        connected: true, alive: true
      });
    }
    broadcastRoster();
  }

  // ---- presence ----

  channel.on("presence", { event: "sync" }, () => {
    const here = new Set(Object.keys(channel.presenceState()));
    for (const p of s.players) {
      if (here.has(p.id)) {
        clearTimeout(graceTimers.get(p.id));
        graceTimers.delete(p.id);
        if (!p.connected) { p.connected = true; if (s.isHost) broadcastRoster(); }
      } else if (p.connected && !graceTimers.has(p.id)) {
        graceTimers.set(p.id, setTimeout(() => playerGone(p.id), LEAVE_GRACE_MS));
      }
    }
    watchHost(here);
    emit("presence", here);
  });

  function playerGone(id) {
    const p = findP(id);
    if (!p) return;
    p.connected = false;
    if (s.isHost) {
      broadcastRoster();
      if (s.status === "playing") {
        const v = roomVerdict({ requireConnected: true });
        if (v.over) {
          announceGameOver(v);
        } else if (lastTurn.playerId === id) {
          hostNextTurn();   // it was their turn, move on
        }
      }
    }
  }

  // Host migration: if the host is absent past grace, the connected player
  // with the lowest id self-promotes. Everyone computes the same rule.
  function watchHost(here) {
    clearTimeout(hostWatchTimer);
    if (!s.hostId || here.has(s.hostId)) return;
    hostWatchTimer = setTimeout(() => {
      const nowHere = new Set(Object.keys(channel.presenceState()));
      if (s.hostId && nowHere.has(s.hostId)) return;
      const candidates = s.players.filter(p => nowHere.has(p.id)).map(p => p.id).sort();
      if (candidates[0] === s.playerId) {
        s.hostId = s.playerId;
        send(EV.HOST_CHANGE, { newHostId: s.playerId });
        broadcastRoster();
        if (s.status === "playing") hostResumeClock();
        emit("host", s.hostId);
      }
    }, LEAVE_GRACE_MS);
  }

  // ---- broadcast handlers ----

  function handle(event, payload) {
    if (!valid(event, payload)) return;
    const from = payload.from;
    switch (event) {
      case EV.HELLO:
        if (s.isHost) hostAdd({ id: from, name: payload.name, penId: payload.penId, sticker: payload.sticker });
        break;
      case EV.ROSTER:
        if (payload.seq <= s.seq && s.players.length) return;   // stale
        s.seq = payload.seq;
        s.hostId = payload.hostId;
        s.players = payload.players;
        if (payload.status) s.status = payload.status;
        emit("roster", s.players);
        break;
      case EV.PEN_PICK: {
        if (s.isHost) {
          const p = findP(from);
          if (p && s.status === "lobby") { p.penId = payload.penId; broadcastRoster(); }
        }
        break;
      }
      case EV.READY: {
        if (s.isHost) {
          const p = findP(from);
          if (p) { p.ready = payload.ready; broadcastRoster(); }
        }
        break;
      }
      case EV.START:
        if (from !== s.hostId) return;
        s.status = "playing";
        if (payload.mode) s.modeId = payload.mode;
        if (payload.tableId) s.tableId = payload.tableId;
        if (payload.band !== undefined) s.band = payload.band;
        placeDone.clear();
        roundOpened = false;
        rematchVotes = new Set();
        lastFallenId = null;
        pendingSkips.clear();
        // Turn numbering restarts every round; without this reset the replay
        // guard on TURN_START would drop the whole next round's turns.
        lastTurn = { turnIdx: -1, playerId: null };
        for (const p of s.players) p.alive = true;
        emit("start", payload);
        break;
      case EV.TURN_START:
        if (from !== s.hostId || payload.turnIdx <= lastTurn.turnIdx) return;
        lastTurn = { turnIdx: payload.turnIdx, playerId: payload.playerId };
        clearTimeout(settleWatch);
        emit("turn", payload);
        if (s.isHost) hostArmTurnTimeout(payload);
        break;
      case EV.FLICK:
        if (from !== lastTurn.playerId) return;
        emit("flick", payload);
        if (s.isHost) {
          clearTimeout(turnTimer);
          settleWatch = setTimeout(hostNextTurn, SETTLE_GRACE_MS);
        }
        break;
      case EV.SETTLE: {
        if (from !== lastTurn.playerId) return;
        clearTimeout(settleWatch);
        applySettleToRoster(payload.fallen, payload.skipped || [], payload.finalStates);
        emit("settle", payload);
        if (s.isHost) {
          const v = roomVerdict();
          if (v.over) announceGameOver(v);
          else setTimeout(hostNextTurn, 900);
        }
        break;
      }
      case EV.GAME_OVER:
        onGameOver(payload.winnerId, payload.winnerTeam ?? null);
        break;
      case EV.REMATCH:
        rematchVotes.add(from);
        emit("rematch_vote", { from, votes: rematchVotes.size });
        if (s.isHost) hostMaybeRematch();
        break;
      case EV.HOST_CHANGE:
        s.hostId = payload.newHostId;
        emit("host", s.hostId);
        break;
      case EV.PLACE:
        if (typeof payload.x === "number") {
          emit("place", { from, x: payload.x, y: payload.y, angle: payload.angle });
        }
        if (payload.done === true && s.isHost) {
          placeDone.add(from);
          const waiting = s.players.filter(p => p.connected && !placeDone.has(p.id));
          if (!waiting.length) openRound();
        }
        break;
      case EV.EMOJI:
        emit("emoji", { from, emoji: payload.emoji });
        break;
    }
  }

  for (const ev of Object.values(EV)) {
    channel.on("broadcast", { event: ev }, ({ payload }) => handle(ev, payload));
  }

  function onGameOver(winnerId, winnerTeam = null) {
    if (s.status !== "playing") return;
    s.status = "done";
    clearTimeout(turnTimer);
    clearTimeout(settleWatch);
    if (s.isHost) setRoomStatus(code, "done").catch(() => {});
    emit("over", { winnerId, winnerTeam, winner: findP(winnerId) });
  }

  // Shared bookkeeping for a turn's outcome, host and striker paths alike.
  // finalStates is the full authoritative board: a roster player absent from
  // it is dead even if the fallen list from an earlier lost settle never
  // said so. Keeps the roster self-healing like the physics.
  function applySettleToRoster(fallen, skipped, finalStates = null) {
    const dead = new Set(fallen);
    if (finalStates) {
      const present = new Set(finalStates.map(s => s.uid));
      for (const p of s.players) {
        if (p.alive && !present.has(p.id)) dead.add(p.id);
      }
    }
    for (const id of dead) {
      const p = findP(id);
      if (p && p.alive) { p.alive = false; lastFallenId = id; }
    }
    for (const id of skipped) pendingSkips.add(id);
  }

  // ---- host turn clock ----

  function hostArmTurnTimeout(turn) {
    clearTimeout(turnTimer);
    const ms = Math.max(1000, turn.deadlineTs - Date.now());
    turnTimer = setTimeout(() => {
      // No flick in time: skip them.
      if (lastTurn.turnIdx === turn.turnIdx) hostNextTurn();
    }, ms);
  }

  function hostNextTurn() {
    if (!s.isHost || s.status !== "playing") return;
    const v = roomVerdict();
    if (v.over) { announceGameOver(v); return; }
    const eligible = s.players.filter(p => p.alive && p.connected);
    if (!eligible.length) return;
    const seats = s.players.filter(p => p.alive).sort((a, b) => a.seat - b.seat);
    const curIdx = seats.findIndex(p => p.id === lastTurn.playerId);
    let next = null;
    for (let k = 1; k <= seats.length * 2; k++) {
      const cand = seats[(curIdx + k) % seats.length];
      if (!cand.connected) continue;
      if (pendingSkips.has(cand.id)) { pendingSkips.delete(cand.id); continue; }  // mounted: misses this one
      next = cand; break;
    }
    if (!next) next = eligible[0];
    const payload = {
      turnIdx: lastTurn.turnIdx + 1,
      playerId: next.id,
      deadlineTs: Date.now() + TURN_SECONDS * 1000
    };
    lastTurn = { turnIdx: payload.turnIdx, playerId: payload.playerId };
    send(EV.TURN_START, payload);
    emit("turn", payload);
    hostArmTurnTimeout(payload);
  }

  function hostResumeClock() {
    // New host after migration mid-game: give the current striker a fresh clock.
    if (s.status === "playing") hostNextTurn();
  }

  function hostMaybeRematch() {
    const connected = s.players.filter(p => p.connected);
    if (connected.length >= 2 && connected.every(p => rematchVotes.has(p.id))) {
      for (const p of s.players) { p.alive = true; p.ready = true; }
      s.players = s.players.filter(p => p.connected);
      s.players.forEach((p, i) => { p.seat = i; });
      s.status = "lobby";
      startGame();
    }
  }

  // ---- public api ----

  s.setReady = ready => {
    if (s.isHost) { const p = findP(s.playerId); if (p) { p.ready = ready; broadcastRoster(); } }
    else send(EV.READY, { ready });
  };

  s.pickPen = penId => {
    if (s.isHost) { const p = findP(s.playerId); if (p) { p.penId = penId; broadcastRoster(); } }
    else send(EV.PEN_PICK, { penId });
  };

  function startGame() {
    if (!s.isHost || s.players.length < 2) return;
    if (s.mode.teams && s.players.length < 4) return;   // 2v2 minimum
    // Seating is shuffled once, then the first shot rotates one seat per
    // round. Reshuffling every round would let the same player open several
    // rounds running; the host opening every round would be worse still.
    const ids = s.players.map(p => p.id);
    if (!seatOrder || seatOrder.length !== ids.length || !ids.every(i => seatOrder.includes(i))) {
      seatOrder = [...ids];
      shuffle(seatOrder);
      roundNo = 0;
    }
    const off = roundNo % seatOrder.length;
    const order = [...seatOrder.slice(off), ...seatOrder.slice(0, off)];
    roundNo += 1;
    const table = tableById(s.tableId);
    const layout = genLayout(
      s.players.map(p => ({ id: p.id, penId: p.penId })),
      table
    );
    const clutter = s.mode.targets ? { props: [], zones: [] } : genProps(table);
    s.status = "playing";
    rematchVotes = new Set();
    for (const p of s.players) p.alive = true;
    lastFallenId = null;
    pendingSkips.clear();
    lastTurn = { turnIdx: -1, playerId: null };
    setRoomStatus(code, "playing").catch(() => {});
    const payload = {
      order, layout, mode: s.modeId, tableId: s.tableId,
      props: clutter.props, zones: clutter.zones
    };
    send(EV.START, payload);
    emit("start", payload);
    setTimeout(hostNextTurn, PLACEMENT_MS + 1500);   // placement window first
  }
  s.startGame = startGame;

  s.sendFlick = (turnIdx, params, preStates) => {
    send(EV.FLICK, { turnIdx, ...params, preStates });
  };
  s.sendSettle = result => {
    applySettleToRoster(result.fallen, result.skipped || [], result.finalStates);
    send(EV.SETTLE, {
      turnIdx: result.turnIdx,
      finalStates: result.finalStates,
      fallen: result.fallen,
      skipped: result.skipped || []
    });
    const v = roomVerdict();
    if (s.isHost) {
      if (v.over) announceGameOver(v);
      else setTimeout(hostNextTurn, 900);
    } else if (v.over) {
      announceGameOver(v);
    }
  };
  s.sendEmoji = emoji => send(EV.EMOJI, { emoji });
  s.sendPlace = (x, y, angle) => send(EV.PLACE, { x, y, angle });
  s.sendPlaceDone = (x, y, angle) => {
    send(EV.PLACE, { x, y, angle, done: true });
    if (s.isHost) {
      placeDone.add(s.playerId);
      const waiting = s.players.filter(p => p.connected && !placeDone.has(p.id));
      if (!waiting.length) openRound();
    }
  };
  s.voteRematch = () => {
    rematchVotes.add(s.playerId);
    send(EV.REMATCH, {});
    if (s.isHost) hostMaybeRematch();
  };

  s.leave = () => {
    clearTimeout(turnTimer);
    clearTimeout(settleWatch);
    clearTimeout(hostWatchTimer);
    for (const t of graceTimers.values()) clearTimeout(t);
    channel.unsubscribe();
  };

  // ---- subscribe ----

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Could not reach the room service")), 10000);
    channel.subscribe(async status => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timeout);
        await channel.track({ playerId: s.playerId, name: me.name });
        if (amCreator) hostAdd({ id: s.playerId, name: me.name, penId: me.penId, sticker: me.sticker });
        else send(EV.HELLO, { name: me.name, penId: me.penId, sticker: me.sticker || null });
        resolve();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(timeout);
        reject(new Error("Room connection failed"));
      }
    });
  });

  return s;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
