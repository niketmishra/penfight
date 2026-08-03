// Boot and glue. Owns the render loop, the screen flow, and the wiring
// between match, flick input, bots or room session, and the HUD.

import { createRenderer } from "./render.js";
import { createFlick } from "./flick.js";
import { createMatch } from "./game.js";
import { attachBots, botRoster, placeBots } from "./bots.js";
import { PENS, penById } from "./pens.js";
import * as sfx from "./sfx.js";
import * as ui from "./screens.js";
import { onlineConfigured } from "./net.js";
import { canonicalize, isValidCode } from "./code.js";
import { ICONS, icon } from "./icons.js";
import { MODES, modeById, teamOfSeat, TEAM_NAMES } from "./modes.js";
import { TABLES, tableById } from "./tables.js";
import { commentate } from "./commentary.js";
import { LEVELS, starsFor, levelUnlocked } from "./levels.js";
import { dayNumber, dailySetup, dailyScore, dailyShareText, mulberry32 } from "./daily.js";
import {
  save, persist, setAcademyStars, setDailyBest, bumpStat,
  addXp, levelFor, playerLevel, STICKERS, XP
} from "./progress.js";
import { setLanguage } from "./commentary.js";
import { createSeries } from "./series.js";

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
  set bots(v) { localStorage.setItem("pf_bots", String(v)); },
  get diff() { return localStorage.getItem("pf_diff") || "normal"; },
  set diff(v) { localStorage.setItem("pf_diff", v); }
};
const myId = store.id;
const mySticker = () => save.settings.sticker || null;

// ---------- core objects ----------

const canvas = $("table");
const renderer = createRenderer(canvas);
const flick = createFlick(canvas, renderer.view);

let match = null;
let session = null;          // online room session
let mode = null;             // "practice" | "online" | "pass"
let pickerMode = null;       // "practice" | "create" | "join"
let pendingJoinCode = null;
let turnDeadline = null;
let botsCtl = null;

// What the player chose on the mode screen.
const flow = { kind: null, modeId: "classic", tableId: "classroom", teamSize: 4 };
let passNames = ["", ""];
let lastPassNames = null;

// The Daav: betting series state for FFA versus modes.
let series = null;
let seriesRoster = null;
let seriesKind = null;       // "practice" | "pass" | "online"

function seriesEligible(modeId) {
  const m = modeById(modeId);
  return !m.teams && !m.solo;
}

flick.previewCb = p => {
  if (p && match && p.uid != null && p.J != null) {
    p.path = match.sim.predictPath(p.uid, { dx: p.dx, dy: p.dy, J: p.J, off: p.off });
  }
  renderer.setPreview(p);
};

flick.fire = params => {
  if (!match) return;
  sfx.whoosh(params.J / 20);
  if (mode === "online" && session) {
    const pre = match.sim.snapshot();
    if (match.applyFlick(myId, params)) {
      session.sendFlick(match.state.turnIdx, params, pre);
    }
  } else {
    const shooter = mode === "pass" ? match.state.currentId : myId;
    match.applyFlick(shooter, params);
  }
};

// ---------- render loop ----------

let timeScale = 1;            // kill cam dips this to 0.3
let slowMoTimer = null;

function enterSlowMo(ms) {
  timeScale = 0.3;
  clearTimeout(slowMoTimer);
  slowMoTimer = setTimeout(() => {
    timeScale = 1;
    renderer.camHome();
  }, ms);
}

let lastT = performance.now();
function loop(tNow) {
  const dt = Math.min(0.1, (tNow - lastT) / 1000);
  lastT = tNow;
  if (match) {
    match.update(dt * timeScale);
    renderer.draw(match.sim, dt, tNow, timeScale);
  } else {
    renderer.draw(EMPTY_SIM, dt, tNow, 1);
  }
  if (turnDeadline != null) {
    const left = (turnDeadline - Date.now()) / 1000;
    ui.setTimer(left / 20);
    if (left <= 0) turnDeadline = null;
  }
  requestAnimationFrame(loop);
}
const EMPTY_SIM = { eachPen() {}, table: null };
requestAnimationFrame(loop);

// ---------- placement phase ----------

const placement = { active: false, playerId: null, deadline: 0, timer: null, seq: [], online: false };
let placeDrag = null;
let lastPlaceSend = 0;

function startPlacing(playerId, ms, { online = false } = {}) {
  if (!match) return;
  placement.active = true;
  placement.playerId = playerId;
  placement.online = online;
  placement.deadline = Date.now() + ms;
  clearTimeout(placement.timer);
  placement.timer = setTimeout(finishPlacing, ms);
  renderer.setPlacement({ zone: match.zoneFor(playerId), deadlineTs: placement.deadline });
  renderer.setHighlight(playerId, "#f2b135");
  const p = match.byId.get(playerId);
  ui.setTurnBanner(playerId === myId ? "Place your pen!" : `${p ? p.name : ""}, place your pen`, true);
}

function finishPlacing() {
  clearTimeout(placement.timer);
  placeDrag = null;
  if (placement.seq.length) {
    const next = placement.seq.shift();
    const np = match ? match.byId.get(next) : null;
    if (np) {
      ui.showPassOverlay(np.name, "Place your pen, then get ready");
      placement.pendingId = next;
      return;
    }
  }
  placement.active = false;
  placement.playerId = null;
  renderer.setPlacement(null);
  if (match && !placement.online) match.endPlacement();
  if (match && placement.online) match.endPlacement();   // stop accepting; host clock starts turns
}

canvas.addEventListener("pointerdown", e => {
  if (!placement.active || !match || placement.playerId == null) return;
  const pid = placement.playerId;
  if (placement.online === false && pid !== myId && mode !== "pass") return;
  const b = match.sim.getBody(pid);
  if (!b) return;
  const w = renderer.view.toWorld(e.clientX, e.clientY);
  const pos = b.getPosition();
  const d = Math.hypot(w.x - pos.x, w.y - pos.y);
  const hl = penById(match.byId.get(pid).penId).length / 2;
  if (d <= hl * 1.0) placeDrag = { mode: "move", pid };
  else if (d <= hl + 0.85) placeDrag = { mode: "rotate", pid };
  else {
    const zone = match.zoneFor(pid);
    if (zone && Math.hypot(w.x - zone.cx, w.y - zone.cy) <= zone.r) placeDrag = { mode: "move", pid };
  }
});
canvas.addEventListener("pointermove", e => {
  if (!placeDrag || !placement.active || !match) return;
  const b = match.sim.getBody(placeDrag.pid);
  if (!b) return;
  const w = renderer.view.toWorld(e.clientX, e.clientY);
  const pos = b.getPosition();
  if (placeDrag.mode === "move") {
    match.place(placeDrag.pid, w.x, w.y, b.getAngle());
  } else {
    match.place(placeDrag.pid, pos.x, pos.y, Math.atan2(w.y - pos.y, w.x - pos.x));
  }
  if (session && Date.now() - lastPlaceSend > 250) {
    lastPlaceSend = Date.now();
    const p2 = b.getPosition();
    session.sendPlace(p2.x, p2.y, b.getAngle());
  }
});
canvas.addEventListener("pointerup", () => {
  if (placeDrag && session && match) {
    const b = match.sim.getBody(placeDrag.pid);
    if (b) {
      const p = b.getPosition();
      session.sendPlace(p.x, p.y, b.getAngle());
    }
  }
  placeDrag = null;
});

// ---------- match wiring (both modes) ----------

function matName(penId) {
  const shape = penById(penId).render.shape;
  return shape === "metal" ? "metal" : shape === "pencil" ? "wood" : "plastic";
}

function wireMatch(m, players, opts = {}) {
  let killCamTurn = -1;
  let lastTeeterAt = 0;
  const killsBy = new Map();   // striker uid -> KOs this round (garam pen)
  renderer.clearGaram();

  m.on("hit", ev => {
    const loud = ev.a.speed > ev.b.speed ? ev.a : ev.b;
    const mat = ev.a.penId && matName(ev.a.penId) === "metal" ? "metal"
      : ev.b.penId && matName(ev.b.penId) === "metal" ? "metal"
      : ev.a.penId && matName(ev.a.penId) === "wood" ? "wood"
      : ev.b.penId && matName(ev.b.penId) === "wood" ? "wood" : "plastic";
    sfx.clack(ev.impulse, mat);
    if (!save.settings.reduceMotion) renderer.shake(Math.min(10, ev.impulse * 1.6));
    renderer.fx.burst(ev.x, ev.y, ev.impulse, ev.impulse > 3 ? "spark" : "dust");
    sfx.vibrate(Math.min(60, Math.round(ev.impulse * 10)));
    if (ev.impulse > 4.2 && loud.speed > 8) ui.comment(commentate("bigHit"));
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
    renderer.fx.inkSplat(ev.x, ev.y, 2.2);

    // Kill cam: once per turn, only while the sim is actually running.
    if (m.state.phase === "sim" && m.state.turnIdx !== killCamTurn && !save.settings.reduceMotion) {
      killCamTurn = m.state.turnIdx;
      renderer.killCam(ev.x, ev.y);
      sfx.whoomp();
      enterSlowMo(700);
    }

    const striker = m.state.currentId;
    if (ev.player && striker && ev.ownerId !== striker && ev.cause !== "storm") {
      const n = (killsBy.get(striker) || 0) + 1;
      killsBy.set(striker, n);
      if (n === 2) {
        renderer.setGaram(striker, true);
        const sp = m.byId.get(striker);
        ui.comment(`GARAM PEN! ${sp ? sp.name : ""} is on fire`);
      }
    }
    const who = ev.player ? ev.player.name : null;
    if (who) {
      const self = ev.ownerId === m.state.currentId;
      const evName = ev.cause === "storm" ? "stormKill"
        : ev.cause === "hole" ? "holeKill"
        : self ? "selfKill"
        : m.state.fallenThisTurn.length >= 2 ? "multiKill" : "kill";
      ui.comment(commentate(evName, { name: who }));
      ui.toast(`${who === myName() ? "Your" : who + "'s"} ${penById(ev.penId).name} ${ev.cause === "hole" ? "sank in the inkwell" : "fell off"}!`, ev.ownerId === myId);
    }
    refreshChips(m, players);
  });

  m.on("skipped", ({ player }) => {
    if (player) {
      ui.comment(commentate("skip", { name: player.name }));
      ui.toast(`${player.name} is pinned, turn skipped`);
    }
  });

  m.on("airborne", ev => {
    sfx.whoosh(1.2);
    renderer.fx.burst(ev.x, ev.y, 2.5, "spark");
  });
  m.on("land", ev => {
    renderer.fx.burst(ev.x, ev.y, 2, "dust");
    sfx.vibrate(30);
  });
  m.on("mount", ev => {
    sfx.clack(4, "plastic");
    sfx.vibrate(70);
    renderer.fx.burst(ev.x, ev.y, 3, "dust");
    ui.comment(commentate("mount", { name: ev.underPlayer ? ev.underPlayer.name : "" }));
  });

  let stormAnnounced = false;

  m.on("turn", t => {
    refreshChips(m, players);
    renderer.camHome();
    timeScale = 1;
    if (placement.active) {   // host clock beat the local placement timer
      clearTimeout(placement.timer);
      placement.active = false;
      placement.seq = [];
      renderer.setPlacement(null);
    }
    const inset = m.stormInset(m.state.turnIdx);
    renderer.setStorm(inset);
    if (inset > 0 && !stormAnnounced) {
      stormAnnounced = true;
      ui.comment(commentate("storm"));
    }
    const p = m.byId.get(t.playerId);
    const seatIdx = players.findIndex(q => q.id === t.playerId);
    const hlColor = p && p.team != null ? undefined : ui.chipColor(seatIdx < 0 ? 0 : seatIdx);
    renderer.setHighlight(t.playerId, hlColor);
    if (opts.passPlay) {
      flick.disarm();
      ui.setTurnBanner(`${p ? p.name : "..."}'s turn`, true);
      ui.showPassOverlay(p ? p.name : "", p ? penById(p.penId).name : "");
    } else {
      const mine = t.playerId === myId;
      ui.setTurnBanner(mine ? "Your turn, flick!" : `${p ? p.name : "..."} is lining up`, mine);
      if (mine) {
        const body = m.sim.getBody(myId);
        if (body) flick.arm(body, penById(m.byId.get(myId).penId));
      } else {
        flick.disarm();
      }
    }
  });

  renderer.teeterCb = ev => {
    const nowT = Date.now();
    if (nowT - lastTeeterAt < 3500) return;
    lastTeeterAt = nowT;
    sfx.oooh();
    ui.comment(commentate("teeter", { name: ev.ownerId && m.byId.get(ev.ownerId) ? m.byId.get(ev.ownerId).name : "" }));
  };

  // Lifetime stats + XP (pass-and-play hotseat and academy award elsewhere)
  const xpTally = { kos: 0, selfKo: false, mounts: 0 };
  m.on("fall", ev => {
    if (!m.byId.has(ev.ownerId)) return;
    if (ev.ownerId !== myId && m.state.currentId === myId) xpTally.kos += 1;
    if (ev.ownerId === myId && m.state.currentId === myId && ev.cause !== "storm") xpTally.selfKo = true;
    if (ev.cause === "hole" && m.state.currentId === myId && ev.ownerId !== myId) bumpStat("holeSinks");
  });
  m.on("mount", ev => { if (ev.rider === myId) xpTally.mounts += 1; });
  m.on("over", ({ winnerId, winnerTeam }) => {
    if (!["practice", "online", "daily"].includes(mode)) return;
    const me = m.byId.get(myId);
    if (!me) return;
    const before = playerLevel();
    const iWon = winnerId === myId || (winnerTeam != null && me.team === winnerTeam);
    bumpStat("matches");
    if (iWon) bumpStat("wins");
    bumpStat("kos", xpTally.kos);
    if (xpTally.selfKo) bumpStat("selfKos");
    bumpStat("mounts", xpTally.mounts);
    let gain = XP.match + xpTally.kos * XP.ko + xpTally.mounts * XP.mount + (iWon ? XP.win : 0);
    if (mode === "daily") gain += XP.daily;
    addXp(gain);
    setTimeout(() => {
      ui.toast(`+${gain} XP`);
      const after = playerLevel();
      if (after > before) ui.comment(`LEVEL UP! Ab aap Level ${after} ho`);
    }, 1700);
  });

  m.on("start", () => refreshChips(m, players));
  m.on("placing", () => refreshChips(m, players));

  // Match intro ceremony
  sfx.bell();
  sfx.ambience(true);
  renderer.introPulse();
  ui.comment(commentate("start"));
  m.on("over", ({ winnerId, winnerTeam }) => {
    sfx.ambience(false);
    renderer.camHome();
    renderer.setStorm(0);
    timeScale = 1;
    const me = m.byId.get(myId);
    const iWon = winnerId === myId || (winnerTeam != null && me && me.team === winnerTeam);
    if (iWon) renderer.confettiBurst();
    ui.comment(commentate("win"));
  });
}

function refreshChips(m, players) {
  ui.renderChips(players, m.state.currentId, id => m.isAlive(id));
}

function myName() { return store.name || "You"; }

// ---------- practice ----------

function localVictory({ winner, winnerTeam, myTeam }) {
  renderer.setHighlight(null);
  flick.disarm();
  if (winnerTeam != null) {
    const won = myTeam != null && winnerTeam === myTeam;
    if (won) sfx.win();
    ui.showVictory(`${TEAM_NAMES[winnerTeam]} wins!`,
      winner ? `${winner.name}'s bench cleared the desk.` : "",
      won ? "trophy" : "skull");
  } else if (winner && winner.id === myId) {
    sfx.win();
    ui.showVictory("You win!", `Your ${penById(winner.penId).name} owns the desk.`, "trophy");
  } else {
    ui.showVictory(winner ? `${winner.name} wins` : "Nobody wins",
      winner ? `${winner.name}'s ${penById(winner.penId).name} is the last one standing.` : "Everyone fell off. Chaos.",
      winner && winner.id !== myId && !winner.isBot ? "trophy" : "skull");
  }
}

function startPractice() {
  const modeCfg = modeById(flow.modeId);
  const me = { id: myId, name: myName(), penId: store.pen, isBot: false, sticker: mySticker() };
  const botCount = modeCfg.teams ? flow.teamSize - 1 : store.bots;
  const diff = save.stats.matches < 3 ? "easy" : store.diff;   // mercy matches
  const bots = botRoster(botCount, store.pen, PENS, Math.random, diff);
  seriesRoster = [me, ...bots];
  seriesRoster.forEach((p, i) => {
    p.seat = i;
    if (modeCfg.teams) p.team = teamOfSeat(i);
  });
  series = seriesEligible(flow.modeId) ? createSeries(seriesRoster.map(p => p.id)) : null;
  seriesKind = "practice";
  startPracticeRound();
}

function startPracticeRound() {
  cleanupMatch({ keepSeries: true });
  maybeTutorial();
  mode = "practice";
  const modeCfg = modeById(flow.modeId);
  let players = seriesRoster;
  let anteInfo = null;
  if (series) {
    anteInfo = series.anteAll();
    players = seriesRoster.filter(p => anteInfo.participants.includes(p.id));
    seriesRoster.forEach(p => { p.balance = series.balance(p.id); });
  }
  match = createMatch({ players, autoAdvance: true, mode: flow.modeId, tableId: flow.tableId });
  renderer.setTable(match.table, { holes: match.holes });
  wireMatch(match, players);
  botsCtl = attachBots(match);
  match.on("placing", () => {
    placeBots(match);
    startPlacing(myId, 15000);
  });
  if (anteInfo) {
    setTimeout(() => ui.comment(`Round ${series.roundNumber} · Daav ₹${anteInfo.stake}`), 1300);
  }
  const myTeam = modeCfg.teams ? teamOfSeat(0) : null;
  match.on("over", ({ winner, winnerTeam }) => {
    setTimeout(() => {
      renderer.setHighlight(null);
      flick.disarm();
      if (series) showRoundPayout();
      else localVictory({ winner, winnerTeam, myTeam });
    }, 1100);
  });
  ui.show(null);
  ui.setTimer(null);
  $("emoji-bar").classList.add("hidden");
  match.start(undefined, undefined, { placement: true });
}

// Settle the round's money and show the standings table.
function showRoundPayout(opts = {}) {
  const positions = match.positionsFinal();
  const deltas = series.settle(positions);
  const meBroke = series.balance(myId) <= 0;
  const localKind = seriesKind !== "online";
  const done = series.over() || (seriesKind === "practice" && meBroke);
  const rows = series.standings().map(s => {
    const p = seriesRoster.find(q => q.id === s.id);
    return {
      name: p ? p.name : "?", balance: s.balance,
      delta: deltas[s.id] ?? 0, isMe: s.id === myId, out: s.balance <= 0
    };
  });
  const anyBroke = series.solvent().length < seriesRoster.length;
  const onlineDone = seriesKind === "online" && anyBroke;
  if (done || onlineDone) {
    const w = seriesRoster.find(q => q.id === series.winnerId());
    const iWonSeries = series.winnerId() === myId;
    if (iWonSeries) { sfx.win(); renderer.confettiBurst(); addXp(XP.win); }
    ui.showPayout({
      title: iWonSeries ? "Poora desk aapka!" : meBroke ? "Kangal! Series over" : `${w ? w.name : "?"} took the money`,
      sub: `Series over · ${series.roundIdx} round${series.roundIdx === 1 ? "" : "s"} played`,
      rows, showContinue: false
    });
  } else {
    ui.showPayout({
      title: `Round ${series.roundIdx} results`,
      sub: `Next: Round ${series.roundNumber} · Daav ₹${series.stake()}`,
      rows,
      continueLabel: opts.hostWaits ? "Waiting for host" : "Next round",
      showContinue: !opts.hideContinue
    });
    if (opts.hostWaits) $("payout-continue").disabled = true;
    else $("payout-continue").disabled = false;
  }
}

function startPassPlay(names) {
  lastPassNames = [...names];
  const modeCfg = modeById(flow.modeId);
  const pens = [...PENS];
  shuffleArr(pens);
  seriesRoster = names.map((nm, i) => ({
    id: "local-" + i,
    name: (nm || "").trim() || "Player " + (i + 1),
    penId: pens[i % pens.length].id,
    isBot: false,
    seat: i,
    team: modeCfg.teams ? teamOfSeat(i) : undefined
  }));
  series = seriesEligible(flow.modeId) ? createSeries(seriesRoster.map(p => p.id)) : null;
  seriesKind = "pass";
  startPassRound();
}

function startPassRound() {
  cleanupMatch({ keepSeries: true });
  maybeTutorial();
  mode = "pass";
  const modeCfg = modeById(flow.modeId);
  let players = seriesRoster;
  let anteInfo = null;
  if (series) {
    anteInfo = series.anteAll();
    players = seriesRoster.filter(p => anteInfo.participants.includes(p.id));
    seriesRoster.forEach(p => { p.balance = series.balance(p.id); });
  }
  match = createMatch({ players, autoAdvance: true, mode: flow.modeId, tableId: flow.tableId });
  renderer.setTable(match.table, { holes: match.holes });
  wireMatch(match, players, { passPlay: true });
  match.on("over", ({ winner, winnerTeam }) => {
    ui.hidePassOverlay();
    setTimeout(() => {
      renderer.setHighlight(null);
      flick.disarm();
      if (series) showRoundPayout();
      else localVictory({ winner, winnerTeam, myTeam: null });
    }, 1100);
  });
  match.on("placing", () => {
    // Everyone places in seat order, phone passes down the bench.
    placement.seq = players.map(p => p.id);
    placement.online = false;
    const first = placement.seq.shift();
    placement.pendingId = first;
    const fp = match.byId.get(first);
    ui.showPassOverlay(fp.name, "Place your pen, then get ready");
  });
  if (anteInfo) {
    setTimeout(() => ui.comment(`Round ${series.roundNumber} · Daav ₹${anteInfo.stake}`), 1300);
  }
  ui.show(null);
  ui.setTimer(null);
  $("emoji-bar").classList.add("hidden");
  match.start(undefined, undefined, { placement: true });
}

function shuffleArr(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// ---------- trick shot academy ----------

let currentLevel = null;
let academyNextAction = null;

function openAcademy() {
  cleanupMatch();
  ui.buildAcademyGrid(LEVELS, save.academy, id => levelUnlocked(id, save.academy), startLevel);
  ui.show("s-academy");
}

function buildLevelLayout(lv, penId) {
  return [
    { ownerId: myId, penId, x: lv.player.x, y: lv.player.y, angle: lv.player.angle },
    ...lv.targets.map((t, i) => ({
      uid: "target-" + i, ownerId: null, penId: t.penId,
      x: t.x, y: t.y, angle: t.angle, target: true
    }))
  ];
}

function startLevel(lv) {
  cleanupMatch();
  maybeTutorial();
  mode = "academy";
  currentLevel = lv;
  const penId = lv.pen || store.pen;
  const players = [{ id: myId, name: myName(), penId, isBot: false, seat: 0, sticker: mySticker() }];
  match = createMatch({
    players, autoAdvance: true, mode: "academy",
    tableId: lv.tableId || "classroom", flickLimit: lv.flickLimit,
    props: lv.props || [], zones: lv.zones || [], holes: lv.holes || []
  });
  renderer.setTable(match.table, { holes: match.holes });
  wireMatch(match, players);
  const banner = () => ui.setTurnBanner(
    `${lv.name} · ${Math.max(0, lv.flickLimit - match.state.flicksUsed)} flicks`, true);
  match.on("turn", banner);
  match.on("flick", banner);
  match.on("over", ({ won }) => {
    setTimeout(() => {
      renderer.setHighlight(null);
      flick.disarm();
      if (won) {
        const stars = starsFor(lv, match.state.flicksUsed);
        const prevStars = save.academy[lv.id] || 0;
        setAcademyStars(lv.id, stars);
        if (stars > prevStars) addXp((stars - prevStars) * XP.academyStar);
        sfx.win();
        renderer.confettiBurst();
        ui.showVictory(`${lv.name} clear!`,
          `${"★".repeat(stars)}${"☆".repeat(3 - stars)} in ${match.state.flicksUsed} flick${match.state.flicksUsed === 1 ? "" : "s"}`,
          "target");
        const next = LEVELS.find(l => l.id === lv.id + 1);
        if (next) {
          $("btn-rematch").textContent = "Next level";
          academyNextAction = () => startLevel(next);
        } else {
          $("btn-rematch").textContent = "Back to Academy";
          academyNextAction = openAcademy;
        }
      } else {
        ui.showVictory("Out of flicks", lv.hint, "skull");
        $("btn-rematch").textContent = "Retry";
        academyNextAction = () => startLevel(lv);
      }
    }, 700);
  });
  ui.show(null);
  ui.setTimer(null);
  $("emoji-bar").classList.add("hidden");
  match.start(buildLevelLayout(lv, penId), [myId]);
}

// ---------- daily bawaal ----------

let lastDaily = null;

function startDaily() {
  cleanupMatch();
  maybeTutorial();
  mode = "daily";
  const day = dayNumber();
  const setup = dailySetup(day, myId, myName());
  setup.players[0].sticker = mySticker();
  const players = setup.players;
  match = createMatch({
    players, autoAdvance: true, mode: "daily",
    tableId: setup.tableId, props: setup.props, zones: setup.zones
  });
  renderer.setTable(match.table, { holes: match.holes });
  wireMatch(match, players);
  botsCtl = attachBots(match);
  ui.toast(`Aaj ka pen: ${penById(setup.penOfDay).name}`);
  const tally = { kos: 0, turnsSurvived: 0, mounts: 0, won: false };
  match.on("turn", t => { if (t.playerId === myId) tally.turnsSurvived += 1; });
  match.on("fall", ev => {
    if (ev.ownerId && ev.ownerId !== myId && match.state.currentId === myId
      && match.byId.has(ev.ownerId)) tally.kos += 1;
  });
  match.on("mount", ev => { if (ev.rider === myId) tally.mounts += 1; });
  match.on("placing", () => {
    placeBots(match, mulberry32(day * 31 + 7));   // same bot placements for everyone
    startPlacing(myId, 15000);
  });
  match.on("over", ({ winnerId }) => {
    tally.won = winnerId === myId;
    const score = dailyScore(tally);
    const best = setDailyBest(day, score);
    bumpStat("dailyPlays");
    lastDaily = { day, score, best, tally };
    setTimeout(() => {
      renderer.setHighlight(null);
      flick.disarm();
      if (tally.won) sfx.win();
      ui.showVictory(`Daily Bawaal #${day}`,
        `Score ${score.toLocaleString("en-IN")} · Best ${best.toLocaleString("en-IN")}`,
        tally.won ? "trophy" : "skull");
      $("btn-share").classList.remove("hidden");
      $("btn-rematch").textContent = "Play again";
    }, 900);
  });
  ui.show(null);
  ui.setTimer(null);
  $("emoji-bar").classList.add("hidden");
  match.start(setup.layout, players.map(p => p.id), { placement: true });
}

// ---------- online ----------

async function startOnline(kind, code) {
  cleanupMatch();
  mode = "online";
  const me = {
    playerId: myId, name: myName(), penId: store.pen, sticker: mySticker(),
    modeId: kind === "create" ? flow.modeId : undefined,
    tableId: kind === "create" ? flow.tableId : undefined
  };
  const { createRoomSession, joinRoomSession } = await import("./room.js");
  session = kind === "create"
    ? await createRoomSession(me)
    : await joinRoomSession(code, me);

  $("lobby-code").textContent = session.code;
  ui.show("s-lobby");
  const lobbyOpts = () => {
    const m = modeById(session.modeId);
    return {
      minPlayers: m.teams ? 4 : m.minPlayers || 2,
      subtitle: `${m.icon} ${m.name} · ${tableById(session.tableId).name}`
    };
  };
  ui.renderLobby(session.roster, myId, session.hostId, lobbyOpts());

  session.on("roster", players => {
    if (session.status === "lobby") ui.renderLobby(players, myId, session.hostId, lobbyOpts());
    else if (match) refreshChips(match, players);
  });
  session.on("host", () => {
    if (session.status === "lobby") ui.renderLobby(session.roster, myId, session.hostId, lobbyOpts());
  });
  session.on("start", payload => beginOnlineMatch(payload));
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
    match.forceSettle(p.finalStates, p.fallen, p.skipped || []);
    renderer.softenNextFrames();
    refreshChips(match, match.players);
  });
  session.on("place", p => {
    if (match && p.from !== myId) match.place(p.from, p.x, p.y, p.angle);
  });
  session.on("over", ({ winnerId, winnerTeam, winner }) => {
    turnDeadline = null;
    ui.setTimer(null);
    renderer.setHighlight(null);
    flick.disarm();
    if (series && match) {
      setTimeout(() => showRoundPayout({ hostWaits: !session.isHost }), 1100);
      return;
    }
    setTimeout(() => {
      const pen = winner ? penById(winner.penId) : null;
      const mode = modeById(session.modeId);
      if (mode.teams && winnerTeam != null) {
        const myTeam = teamOfSeat((session.roster.find(p => p.id === myId) || {}).seat || 0);
        if (winnerTeam === myTeam) {
          sfx.win();
          ui.showVictory(`${TEAM_NAMES[winnerTeam]} wins!`, "Your bench owns the desk.", "trophy");
        } else {
          ui.showVictory(`${TEAM_NAMES[winnerTeam]} wins`, "Their bench cleared yours out.", "skull");
        }
      } else if (winnerId === myId) {
        sfx.win();
        ui.showVictory("You win!", pen ? `Your ${pen.name} owns the desk.` : "", "trophy");
      } else {
        ui.showVictory(`${winner ? winner.name : "Someone"} wins`,
          pen ? `Their ${pen.name} is the last one standing.` : "", "skull");
      }
      $("btn-rematch").textContent = "Rematch";
      $("btn-rematch").disabled = false;
    }, 900);
  });
}

function beginOnlineMatch({ order, layout, props = [], zones = [] }) {
  const mode = modeById(session.modeId);
  const players = session.roster.map(p => ({
    ...p, isBot: false,
    team: mode.teams ? teamOfSeat(p.seat) : undefined
  }));
  // The Daav rides along: every client derives identical balances from the
  // shared round results. A bankruptcy ends the online series.
  if (seriesEligible(session.modeId)) {
    const ids = players.map(p => p.id).sort().join("|");
    if (!series || seriesKind !== "online" || series.rosterKey !== ids || series.over()
      || series.solvent().length < players.length) {
      series = createSeries(players.map(p => p.id));
      series.rosterKey = ids;
      seriesKind = "online";
    }
    seriesRoster = players;
    const ante = series.anteAll();
    players.forEach(p => { p.balance = series.balance(p.id); });
    setTimeout(() => ui.comment(`Round ${series.roundNumber} · Daav ₹${ante.stake}`), 1300);
  }
  match = createMatch({
    players, autoAdvance: false,
    mode: session.modeId, tableId: session.tableId,
    props, zones
  });
  renderer.setTable(match.table, { holes: match.holes });
  wireMatch(match, players);

  match.on("settle", r => {
    if (r.strikerId === myId) session.sendSettle(r);
  });

  match.on("placing", () => startPlacing(myId, 15000, { online: true }));
  ui.show(null);
  $("emoji-bar").classList.remove("hidden");
  ui.setTurnBanner("Game on!", false);
  const orderIdx = new Map(order.map((id, i) => [id, i]));
  players.sort((a, b) => (orderIdx.get(a.id) ?? 9) - (orderIdx.get(b.id) ?? 9));
  match.start(layout, order, { placement: true });
  refreshChips(match, players);
}

function cleanupMatch(opts = {}) {
  if (botsCtl) { botsCtl.cancel(); botsCtl = null; }
  if (session && !opts.keepSession) { session.leave(); session = null; }
  if (!opts.keepSeries) { series = null; seriesRoster = null; seriesKind = null; }
  clearTimeout(placement.timer);
  placement.active = false;
  placement.seq = [];
  placement.pendingId = null;
  renderer.setPlacement(null);
  clearTimeout(demoTimer);
  match = null;
  mode = null;
  turnDeadline = null;
  timeScale = 1;
  flick.disarm();
  renderer.setHighlight(null);
  renderer.setStorm(0);
  renderer.camHome();
  sfx.ambience(false);
  ui.setTimer(null);
}

// ---------- attract mode: bots play behind the home screen ----------

let demoTimer = null;

function startDemo() {
  if (session || (match && mode !== "demo")) return;
  clearTimeout(demoTimer);
  mode = "demo";
  const bots = botRoster(3 + Math.floor(Math.random() * 3), null, PENS);
  bots.forEach((p, i) => { p.seat = i; });
  match = createMatch({
    players: bots, autoAdvance: true,
    mode: { ...modeById("classic"), storm: false }
  });
  renderer.setTable(match.table, { holes: match.holes });
  renderer.setHighlight(null);
  match.on("fall", ev => renderer.addFall(ev, penById(ev.penId)));
  match.on("hit", ev => renderer.fx.burst(ev.x, ev.y, Math.min(2, ev.impulse), "dust"));
  botsCtl = attachBots(match);
  match.on("over", () => {
    demoTimer = setTimeout(() => {
      if (mode === "demo") { match = null; startDemo(); }
    }, 2200);
  });
  match.start();
}

function updateHomeMeta() {
  const lv = levelFor(save.xp);
  const pct = Math.round((lv.into / lv.need) * 100);
  $("home-meta").innerHTML = `<span class="level-chip"><b>Lv ${lv.level}</b>` +
    `<span class="xp-track"><span class="xp-fill" style="display:block;height:100%;width:${pct}%"></span></span>` +
    `${save.stats.wins} wins · ${save.stats.academyStars}\u2605</span>`;
}

function goHome() {
  cleanupMatch();
  updateHomeMeta();
  ui.show("s-home");
  startDemo();
}

// ---------- tutorial + settings ----------

function maybeTutorial() {
  if (!save.seenTutorial) $("tutorial-overlay").classList.remove("hidden");
}
$("tutorial-close").addEventListener("click", () => {
  $("tutorial-overlay").classList.add("hidden");
  save.seenTutorial = true;
  persist();
});

$("btn-settings").addEventListener("click", () => {
  $("set-sound").checked = save.settings.sound;
  $("set-lang").checked = save.settings.lang !== "en";
  $("set-motion").checked = save.settings.reduceMotion;
  $("set-stats").textContent =
    `Matches ${save.stats.matches} · Wins ${save.stats.wins} · KOs ${save.stats.kos} · Self-KOs ${save.stats.selfKos} · Chadhai ${save.stats.mounts}`;
  $("settings-overlay").classList.remove("hidden");
});
$("settings-close").addEventListener("click", () => $("settings-overlay").classList.add("hidden"));
$("set-sound").addEventListener("change", e => {
  save.settings.sound = e.target.checked;
  persist();
  sfx.setMuted(!save.settings.sound);
});
$("set-lang").addEventListener("change", e => {
  save.settings.lang = e.target.checked ? "hi" : "en";
  persist();
  setLanguage(save.settings.lang);
});
$("set-motion").addEventListener("change", e => {
  save.settings.reduceMotion = e.target.checked;
  persist();
});

// ---------- screen flow ----------

$("btn-practice").addEventListener("click", () => openModeSelect("practice"));
$("btn-pass").addEventListener("click", () => openModeSelect("pass"));
$("btn-create").addEventListener("click", () => {
  if (!onlineConfigured) { $("online-hint").classList.remove("hidden"); return; }
  openModeSelect("create");
});
$("btn-join").addEventListener("click", () => {
  if (!onlineConfigured) { $("online-hint").classList.remove("hidden"); return; }
  $("join-error").classList.add("hidden");
  $("code-input").value = pendingJoinCode || "";
  ui.show("s-join");
});

// ---------- mode select ----------

function openModeSelect(kind) {
  flow.kind = kind;
  const lvl = playerLevel();
  const list = MODES.filter(m => !m.solo);
  const locked = id => (list.find(m => m.id === id) || {}).unlock > lvl;
  if (!list.some(m => m.id === flow.modeId) || locked(flow.modeId)) flow.modeId = "classic";
  if ((tableById(flow.tableId).unlock || 0) > lvl) flow.tableId = "classroom";
  ui.buildModeCards(list, flow.modeId, m => { flow.modeId = m.id; syncModeRows(); }, lvl);
  ui.buildTableChips(TABLES, flow.tableId, t => { flow.tableId = t.id; }, lvl);
  $("mode-title").textContent =
    kind === "create" ? "Set the room rules" :
    kind === "pass" ? "One phone, full bench" : "Pick your battle";
  syncModeRows();
  ui.show("s-mode");
}

function syncModeRows() {
  const m = modeById(flow.modeId);
  $("teamsize-row").classList.toggle("hidden", !(m.teams && flow.kind !== "create"));
}

document.querySelectorAll(".size-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".size-btn").forEach(b => b.classList.remove("sel"));
    btn.classList.add("sel");
    flow.teamSize = Number(btn.dataset.size);
  });
});

$("mode-back").addEventListener("click", () => ui.show("s-home"));
$("mode-go").addEventListener("click", () => {
  if (flow.kind === "pass") {
    const m = modeById(flow.modeId);
    while (passNames.length < (m.teams ? flow.teamSize : 2)) passNames.push("");
    if (m.teams) passNames.length = flow.teamSize;
    ui.renderPassNames(passNames);
    ui.show("s-pass");
  } else {
    openPicker(flow.kind);
  }
});

$("pass-add").addEventListener("click", () => {
  if (passNames.length < 6) { passNames.push(""); ui.renderPassNames(passNames); }
});
$("pass-back").addEventListener("click", () => ui.show("s-mode"));
$("pass-start").addEventListener("click", () => {
  const m = modeById(flow.modeId);
  const min = m.teams ? 4 : 2;
  if (passNames.length < min) { ui.toast(`Need at least ${min} players`, true); return; }
  startPassPlay(passNames);
});

$("pass-ready").addEventListener("click", () => {
  ui.hidePassOverlay();
  if (!match || mode !== "pass") return;
  if (placement.pendingId != null && match.state.phase === "placing") {
    const pid = placement.pendingId;
    placement.pendingId = null;
    startPlacing(pid, 10000);
    return;
  }
  if (match.state.phase !== "aiming") return;
  const cur = match.state.currentId;
  const body = match.sim.getBody(cur);
  const p = match.byId.get(cur);
  if (body && p) flick.arm(body, penById(p.penId));
});

function openPicker(kind) {
  pickerMode = kind;
  const m = modeById(flow.modeId);
  $("practice-opts").classList.toggle("hidden", kind !== "practice" || Boolean(m.teams));
  $("diff-row").classList.toggle("hidden", kind !== "practice");
  document.querySelectorAll(".diff-btn").forEach(b =>
    b.classList.toggle("sel", b.dataset.diff === store.diff));
  $("bots-count").textContent = store.bots;
  $("name-input").value = store.name;
  ui.buildPicker(store.pen, pen => { store.pen = pen.id; }, playerLevel());
  ui.buildStickerRow(STICKERS, save.settings.sticker || "none", playerLevel(), st => {
    save.settings.sticker = st.id === "none" ? null : st.id;
    persist();
  });
  ui.show("s-picker");
}

document.querySelectorAll(".diff-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".diff-btn").forEach(b => b.classList.remove("sel"));
    btn.classList.add("sel");
    store.diff = btn.dataset.diff;
  });
});

$("bots-minus").addEventListener("click", () => {
  store.bots = Math.max(1, store.bots - 1);
  $("bots-count").textContent = store.bots;
});
$("bots-plus").addEventListener("click", () => {
  store.bots = Math.min(5, store.bots + 1);
  $("bots-count").textContent = store.bots;
});

$("picker-back").addEventListener("click", () =>
  ui.show(pickerMode === "join" ? "s-join" : "s-mode"));
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
    goHome();
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
$("lobby-leave").addEventListener("click", goHome);
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

$("btn-quit").addEventListener("click", goHome);

$("payout-continue").addEventListener("click", () => {
  if (seriesKind === "practice") startPracticeRound();
  else if (seriesKind === "pass") startPassRound();
  else if (seriesKind === "online" && session && session.isHost) {
    $("payout-continue").disabled = true;
    session.startGame();
  }
});
$("payout-quit").addEventListener("click", goHome);

$("btn-rematch").addEventListener("click", () => {
  if (mode === "practice") { startPractice(); return; }
  if (mode === "pass" && lastPassNames) { startPassPlay(lastPassNames); return; }
  if (mode === "academy" && academyNextAction) { academyNextAction(); return; }
  if (mode === "daily") { startDaily(); return; }
  if (session) {
    session.voteRematch();
    $("btn-rematch").textContent = "Waiting for others";
    $("btn-rematch").disabled = true;
  }
});
$("btn-home").addEventListener("click", () => {
  const wasAcademy = mode === "academy";
  if (wasAcademy) { cleanupMatch(); openAcademy(); }
  else goHome();
});

$("btn-academy").addEventListener("click", openAcademy);
$("academy-back").addEventListener("click", () => ui.show("s-home"));
$("btn-daily").addEventListener("click", startDaily);
$("btn-share").addEventListener("click", async () => {
  if (!lastDaily) return;
  const text = dailyShareText(lastDaily.day, {
    score: lastDaily.best, kos: lastDaily.tally.kos,
    turnsSurvived: lastDaily.tally.turnsSurvived, won: lastDaily.tally.won
  });
  if (navigator.share) {
    try { await navigator.share({ text }); } catch { /* dismissed */ }
  } else if (navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    ui.toast("Score copied");
  }
});

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
sfx.setMuted(!save.settings.sound);
setLanguage(save.settings.lang);
updateHomeMeta();
if (joinParam && onlineConfigured) {
  pendingJoinCode = canonicalize(joinParam);
  $("code-input").value = pendingJoinCode;
  ui.show("s-join");
} else {
  ui.show("s-home");
  startDemo();
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

// Inject the SVG icon set into the static chrome.
{
  const put = (id, name) => { const el = $(id); if (el) el.innerHTML = ICONS[name] ? `<span class="icn">${ICONS[name]}</span>` : ""; };
  const mark = $("logo-mark");
  if (mark) mark.innerHTML = ICONS.logo;
  put("ic-practice", "bot");
  put("ic-pass", "phone");
  put("ic-academy", "target");
  put("ic-daily", "calendar");
  put("ic-create", "crown");
  put("ic-join", "wifi");
  put("ic-gear", "gear");
  document.querySelectorAll("[data-ic]").forEach(el => {
    el.outerHTML = icon(el.dataset.ic);
  });
}

// Debug handle for automated testing. Not referenced by game code.
window.__pf = {
  get match() { return match; },
  get session() { return session; },
  get timeScale() { return timeScale; },
  get mode() { return mode; },
  renderer, flick, store
};
