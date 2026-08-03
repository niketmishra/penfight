// Boot and glue. Owns the render loop, the screen flow, and the wiring
// between match, flick input, bots or room session, and the HUD.

import { createRenderer } from "./render.js";
import { createFlick } from "./flick.js";
import { createMatch } from "./game.js";
import { attachBots, botRoster } from "./bots.js";
import { PENS, penById } from "./pens.js";
import * as sfx from "./sfx.js";
import * as ui from "./screens.js";
import { onlineConfigured } from "./net.js";
import { canonicalize, isValidCode } from "./code.js";

const $ = id => document.getElementById(id);

// ---------- identity + prefs ----------

const store = {
  get id() {
    let v = localStorage.getItem("pf_id");
    if (!v) { v = crypto.randomUUID(); localStorage.setItem("pf_id", v); }
    return v;
  },
  get name() { return localStorage.getItem("pf_name") || ""; },
  set name(v) { localStorage.setItem("pf_name", v); },
  get pen() { return localStorage.getItem("pf_pen") || PENS[0].id; },
  set pen(v) { localStorage.setItem("pf_pen", v); },
  get bots() { return Math.min(5, Math.max(1, Number(localStorage.getItem("pf_bots")) || 3)); },
  set bots(v) { localStorage.setItem("pf_bots", String(v)); }
};
const myId = store.id;

// ---------- core objects ----------

const canvas = $("table");
const renderer = createRenderer(canvas);
const flick = createFlick(canvas, renderer.view);

let match = null;
let session = null;          // online room session
let mode = null;             // "practice" | "online"
let pickerMode = null;       // "practice" | "create" | "join"
let pendingJoinCode = null;
let turnDeadline = null;
let botsCtl = null;

flick.previewCb = p => renderer.setPreview(p);

flick.fire = (params, armed) => {
  if (!match) return;
  sfx.whoosh(params.J / 20);
  if (mode === "online" && session) {
    const pre = match.sim.snapshot();
    if (match.applyFlick(myId, params)) {
      session.sendFlick(match.state.turnIdx, params, pre);
    }
  } else {
    match.applyFlick(myId, params);
  }
};

// ---------- render loop ----------

let lastT = performance.now();
function loop(tNow) {
  const dt = Math.min(0.1, (tNow - lastT) / 1000);
  lastT = tNow;
  if (match) {
    match.update(dt);
    renderer.draw(match.sim, dt, tNow);
  } else {
    renderer.draw(EMPTY_SIM, dt, tNow);
  }
  if (turnDeadline != null) {
    const left = (turnDeadline - Date.now()) / 1000;
    ui.setTimer(left / 20);
    if (left <= 0) turnDeadline = null;
  }
  requestAnimationFrame(loop);
}
const EMPTY_SIM = { eachPen() {} };
requestAnimationFrame(loop);

// ---------- match wiring (both modes) ----------

function wireMatch(m, players) {
  m.on("hit", ev => {
    const mass = 1.2;
    sfx.clack(ev.impulse, mass);
    renderer.shake(Math.min(10, ev.impulse * 1.6));
    sfx.vibrate(Math.min(60, Math.round(ev.impulse * 10)));
  });
  m.on("flick", ({ playerId }) => {
    if (playerId !== myId) sfx.whoosh(0.7);
    renderer.setHighlight(null);
    flick.disarm();
  });
  m.on("fall", ev => {
    renderer.addFall(ev, penById(ev.penId));
    sfx.fall();
    sfx.vibrate(80);
    const who = ev.player ? ev.player.name : "A pen";
    const pen = penById(ev.penId);
    ui.toast(`${who === myName() ? "Your" : who + "'s"} ${pen.name} fell off!`, ev.ownerId === myId);
    refreshChips(m, players);
  });
  m.on("turn", t => {
    refreshChips(m, players);
    const mine = t.playerId === myId;
    const p = m.byId.get(t.playerId);
    ui.setTurnBanner(mine ? "Your turn, flick!" : `${p ? p.name : "..."} is lining up`, mine);
    const seatIdx = players.findIndex(q => q.id === t.playerId);
    renderer.setHighlight(t.playerId, ui.chipColor(seatIdx < 0 ? 0 : seatIdx));
    if (mine) {
      const body = m.sim.getBody(myId);
      if (body) flick.arm(body, penById(m.byId.get(myId).penId));
    } else {
      flick.disarm();
    }
  });
}

function refreshChips(m, players) {
  ui.renderChips(players, m.state.currentId, id => m.isAlive(id));
}

function myName() { return store.name || "You"; }

// ---------- practice ----------

function startPractice() {
  cleanupMatch();
  mode = "practice";
  const me = { id: myId, name: myName(), penId: store.pen, isBot: false };
  const bots = botRoster(store.bots, store.pen, PENS);
  const players = [me, ...bots];
  players.forEach((p, i) => { p.seat = i; });
  match = createMatch({ players, autoAdvance: true });
  wireMatch(match, players);
  botsCtl = attachBots(match);
  match.on("over", ({ winner }) => {
    setTimeout(() => {
      renderer.setHighlight(null);
      flick.disarm();
      if (winner && winner.id === myId) {
        sfx.win();
        ui.showVictory("You win!", `Your ${penById(winner.penId).name} owns the desk.`, "🏆");
      } else {
        ui.showVictory(winner ? `${winner.name} wins` : "Nobody wins",
          winner ? `${winner.name}'s ${penById(winner.penId).name} is the last one standing.` : "Everyone fell off. Chaos.",
          "💀");
      }
    }, 900);
  });
  ui.show(null);
  ui.setTimer(null);
  $("emoji-bar").classList.add("hidden");
  match.start();
}

// ---------- online ----------

async function startOnline(kind, code) {
  cleanupMatch();
  mode = "online";
  const me = { playerId: myId, name: myName(), penId: store.pen };
  const { createRoomSession, joinRoomSession } = await import("./room.js");
  session = kind === "create"
    ? await createRoomSession(me)
    : await joinRoomSession(code, me);

  $("lobby-code").textContent = session.code;
  ui.show("s-lobby");
  ui.renderLobby(session.roster, myId, session.hostId);

  session.on("roster", players => {
    if (session.status === "lobby") ui.renderLobby(players, myId, session.hostId);
    else if (match) refreshChips(match, players);
  });
  session.on("host", () => {
    if (session.status === "lobby") ui.renderLobby(session.roster, myId, session.hostId);
  });
  session.on("start", ({ order, layout }) => beginOnlineMatch(order, layout));
  session.on("emoji", ({ emoji }) => ui.floatEmoji(emoji));
  session.on("turn", t => {
    if (!match) return;
    turnDeadline = t.deadlineTs;
    match.setTurn(t.playerId, { turnIdx: t.turnIdx });
  });
  session.on("flick", f => {
    if (!match) return;
    // Someone else's strike: seed their pre-flick state, then predict.
    match.sim.applySnapshot(f.preStates, []);
    match.sim.resetSimClock();
    match.applyFlick(f.from, { dx: f.dx, dy: f.dy, J: f.J, off: f.off });
  });
  session.on("settle", p => {
    if (!match || p.from === myId) return;
    match.forceSettle(p.finalStates, p.fallen);
    renderer.softenNextFrames();
    refreshChips(match, match.players);
  });
  session.on("over", ({ winnerId, winner }) => {
    turnDeadline = null;
    ui.setTimer(null);
    renderer.setHighlight(null);
    flick.disarm();
    setTimeout(() => {
      const pen = winner ? penById(winner.penId) : null;
      if (winnerId === myId) {
        sfx.win();
        ui.showVictory("You win!", pen ? `Your ${pen.name} owns the desk.` : "", "🏆");
      } else {
        ui.showVictory(`${winner ? winner.name : "Someone"} wins`,
          pen ? `Their ${pen.name} is the last one standing.` : "", "🥲");
      }
      $("btn-rematch").textContent = "Rematch";
      $("btn-rematch").disabled = false;
    }, 900);
  });
}

function beginOnlineMatch(order, layout) {
  const players = session.roster.map(p => ({ ...p, isBot: false }));
  match = createMatch({ players, autoAdvance: false });
  wireMatch(match, players);

  match.on("settle", r => {
    if (r.strikerId === myId) session.sendSettle(r);
  });

  ui.show(null);
  $("emoji-bar").classList.remove("hidden");
  ui.setTurnBanner("Game on!", false);
  const orderIdx = new Map(order.map((id, i) => [id, i]));
  players.sort((a, b) => (orderIdx.get(a.id) ?? 9) - (orderIdx.get(b.id) ?? 9));
  match.start(layout, order);
  refreshChips(match, players);
}

function cleanupMatch() {
  if (botsCtl) { botsCtl.cancel(); botsCtl = null; }
  if (session) { session.leave(); session = null; }
  match = null;
  turnDeadline = null;
  flick.disarm();
  renderer.setHighlight(null);
  ui.setTimer(null);
}

// ---------- screen flow ----------

$("btn-practice").addEventListener("click", () => openPicker("practice"));
$("btn-create").addEventListener("click", () => {
  if (!onlineConfigured) { $("online-hint").classList.remove("hidden"); return; }
  openPicker("create");
});
$("btn-join").addEventListener("click", () => {
  if (!onlineConfigured) { $("online-hint").classList.remove("hidden"); return; }
  $("join-error").classList.add("hidden");
  $("code-input").value = pendingJoinCode || "";
  ui.show("s-join");
});

function openPicker(kind) {
  pickerMode = kind;
  $("practice-opts").classList.toggle("hidden", kind !== "practice");
  $("bots-count").textContent = store.bots;
  $("name-input").value = store.name;
  ui.buildPicker(store.pen, pen => { store.pen = pen.id; });
  ui.show("s-picker");
}

$("bots-minus").addEventListener("click", () => {
  store.bots = Math.max(1, store.bots - 1);
  $("bots-count").textContent = store.bots;
});
$("bots-plus").addEventListener("click", () => {
  store.bots = Math.min(5, store.bots + 1);
  $("bots-count").textContent = store.bots;
});

$("picker-back").addEventListener("click", () => ui.show("s-home"));
$("picker-go").addEventListener("click", async () => {
  const name = $("name-input").value.trim();
  store.name = name || "Player";
  const btn = $("picker-go");
  if (pickerMode === "practice") { startPractice(); return; }
  btn.disabled = true;
  btn.textContent = "Connecting";
  try {
    await startOnline(pickerMode === "create" ? "create" : "join", pendingJoinCode);
  } catch (err) {
    ui.toast(err.message || "Could not connect", true);
    ui.show("s-home");
  } finally {
    btn.disabled = false;
    btn.textContent = "Let's go";
  }
});

$("join-back").addEventListener("click", () => ui.show("s-home"));
$("join-go").addEventListener("click", () => {
  const code = canonicalize($("code-input").value);
  if (!isValidCode(code)) {
    $("join-error").textContent = "That code does not look right, it is 6 letters";
    $("join-error").classList.remove("hidden");
    return;
  }
  pendingJoinCode = code;
  openPicker("join");
});
$("code-input").addEventListener("input", e => {
  e.target.value = canonicalize(e.target.value);
});

$("lobby-ready").addEventListener("click", () => {
  if (!session) return;
  const me = session.roster.find(p => p.id === myId);
  session.setReady(me ? !me.ready : true);
});
$("lobby-start").addEventListener("click", () => session && session.startGame());
$("lobby-leave").addEventListener("click", () => { cleanupMatch(); ui.show("s-home"); });
$("lobby-code").addEventListener("click", async () => {
  if (!session) return;
  const url = location.origin + location.pathname + "?join=" + session.code;
  const text = `Pen fight! Room code ${session.code}`;
  if (navigator.share) {
    try { await navigator.share({ title: "Pen Fight", text, url }); } catch { /* dismissed */ }
  } else if (navigator.clipboard) {
    await navigator.clipboard.writeText(text + " " + url);
    ui.toast("Code copied");
  }
});

$("btn-quit").addEventListener("click", () => { cleanupMatch(); ui.show("s-home"); });

$("btn-rematch").addEventListener("click", () => {
  if (mode === "practice") { startPractice(); return; }
  if (session) {
    session.voteRematch();
    $("btn-rematch").textContent = "Waiting for others";
    $("btn-rematch").disabled = true;
  }
});
$("btn-home").addEventListener("click", () => { cleanupMatch(); ui.show("s-home"); });

document.querySelectorAll(".emoji-btn").forEach(btn => {
  let lastSent = 0;
  btn.addEventListener("click", () => {
    const nowT = Date.now();
    if (nowT - lastSent < 1000 || !session) return;
    lastSent = nowT;
    ui.floatEmoji(btn.textContent);
    session.sendEmoji(btn.textContent);
  });
});

// ---------- boot ----------

document.addEventListener("pointerdown", function unlock() {
  sfx.init();
  document.removeEventListener("pointerdown", unlock);
});

// Invite links: ?join=CODE
const joinParam = new URLSearchParams(location.search).get("join");
if (joinParam && onlineConfigured) {
  pendingJoinCode = canonicalize(joinParam);
  $("code-input").value = pendingJoinCode;
  ui.show("s-join");
} else {
  ui.show("s-home");
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
