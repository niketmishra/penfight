// DOM screens and HUD. main.js wires the callbacks; this module only paints.

import { PENS, statBars } from "./pens.js";
import { TEAM_COLORS } from "./modes.js";
import { ICONS } from "./icons.js";

const $ = id => document.getElementById(id);

const SCREENS = ["s-home", "s-mode", "s-pass", "s-picker", "s-join", "s-lobby", "s-academy", "s-payout", "s-victory"];
const CHIP_COLORS = ["#3d7bff", "#ff5470", "#ffd166", "#4ade80", "#c084fc", "#fb923c"];

// Screen router with a short exit animation. A leaving screen fades for
// 140ms before display:none; arriving screens keep their pop-in.
const leaveTimers = new Map();
let showHook = null;
export function onShow(fn) { showHook = fn; }

export function show(name) {
  for (const id of SCREENS) {
    const el = $(id);
    const arriving = id === name;
    if (arriving) {
      clearTimeout(leaveTimers.get(id));
      leaveTimers.delete(id);
      el.classList.remove("hidden", "leaving");
    } else if (!el.classList.contains("hidden") && !el.classList.contains("leaving")) {
      el.classList.add("leaving");
      leaveTimers.set(id, setTimeout(() => {
        el.classList.remove("leaving");
        el.classList.add("hidden");
        leaveTimers.delete(id);
      }, 140));
    }
  }
  $("hud").classList.toggle("hidden", name !== null);
  if (showHook) showHook(name);
}

export function chipColor(seat) { return CHIP_COLORS[seat % CHIP_COLORS.length]; }

// ---------- mode + table select ----------

export function buildModeCards(modes, selectedId, onSelect, playerLevel = 99) {
  const wrap = $("mode-cards");
  wrap.innerHTML = "";
  for (const m of modes) {
    const open = (m.unlock || 0) <= playerLevel;
    const card = document.createElement("button");
    card.type = "button";
    card.className = "mode-card" + (m.id === selectedId && open ? " sel" : "") + (open ? "" : " locked");
    card.innerHTML = `<span class="mi">${ICONS[m.icon] || ""}</span><span><h4>${esc(m.name)}</h4><p>${open ? esc(m.desc) : `<span class="lock-note"><span class="icn">${ICONS.lock}</span> Unlocks at level ${m.unlock}</span>`}</p></span>`;
    if (open) card.addEventListener("click", () => {
      wrap.querySelectorAll(".mode-card").forEach(c => c.classList.remove("sel"));
      card.classList.add("sel");
      onSelect(m);
    });
    wrap.appendChild(card);
  }
}

// Mini desk painting so the picker shows the actual desk, not just a name.
function drawDeskThumb(cv, t) {
  const g = cv.getContext("2d");
  const w = cv.width, h = cv.height;
  const th = t.theme;
  g.fillStyle = th.floor || "#0a0c14";
  g.fillRect(0, 0, w, h);
  const pad = 5;
  const grad = g.createLinearGradient(pad, pad, w - pad, h - pad);
  grad.addColorStop(0, th.top[0]);
  grad.addColorStop(0.5, th.top[1]);
  grad.addColorStop(1, th.top[2]);
  g.fillStyle = grad;
  g.strokeStyle = th.edge || "rgba(20,10,2,0.8)";
  g.lineWidth = 2;
  if (t.shape === "round") {
    g.beginPath();
    g.arc(w / 2, h / 2, Math.min(w, h) / 2 - pad, 0, Math.PI * 2);
    g.fill(); g.stroke();
  } else {
    const ar = t.w / t.h;
    let dw = w - pad * 2, dh = dw / ar;
    if (dh > h - pad * 2) { dh = h - pad * 2; dw = dh * ar; }
    roundRect(g, (w - dw) / 2, (h - dh) / 2, dw, dh, 4);
    g.fill(); g.stroke();
  }
  if (t.seam) {
    g.strokeStyle = "rgba(20,10,2,0.5)";
    g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(w / 2, pad + 2); g.lineTo(w / 2, h - pad - 2); g.stroke();
  }
  if (th.planks > 1) {
    g.strokeStyle = "rgba(40,22,8,0.3)";
    g.lineWidth = 0.8;
    for (let i = 1; i < Math.min(th.planks, 4); i++) {
      const px = pad + ((w - pad * 2) * i) / Math.min(th.planks, 4);
      g.beginPath(); g.moveTo(px, pad + 2); g.lineTo(px, h - pad - 2); g.stroke();
    }
  }
}

export function buildTableChips(tables, selectedId, onSelect, playerLevel = 99) {
  const wrap = $("table-chips");
  wrap.innerHTML = "";
  for (const t of tables) {
    const open = (t.unlock || 0) <= playerLevel;
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "table-chip" + (t.id === selectedId && open ? " sel" : "") + (open ? "" : " locked");
    const cv = document.createElement("canvas");
    cv.width = 72; cv.height = 48;
    drawDeskThumb(cv, t);
    chip.appendChild(cv);
    const label = document.createElement("span");
    if (open) label.textContent = t.name;
    else label.innerHTML = `<span class="icn">${ICONS.lock}</span> Lv ${t.unlock}`;
    chip.appendChild(label);
    if (open) chip.addEventListener("click", () => {
      wrap.querySelectorAll(".table-chip").forEach(c => c.classList.remove("sel"));
      chip.classList.add("sel");
      onSelect(t);
    });
    wrap.appendChild(chip);
  }
}

// ---------- pass and play names ----------

export function renderPassNames(names) {
  const wrap = $("pass-names");
  wrap.innerHTML = "";
  names.forEach((name, i) => {
    const row = document.createElement("div");
    row.className = "pass-name-row";
    const input = document.createElement("input");
    input.maxLength = 14;
    input.value = name;
    input.placeholder = "Player " + (i + 1);
    input.addEventListener("input", () => { names[i] = input.value; });
    row.appendChild(input);
    if (names.length > 2) {
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "rm";
      rm.textContent = "✕";
      rm.addEventListener("click", () => { names.splice(i, 1); renderPassNames(names); });
      row.appendChild(rm);
    }
    wrap.appendChild(row);
  });
  $("pass-add").classList.toggle("hidden", names.length >= 6);
}

export function showPassOverlay(name, penName) {
  $("pass-who").textContent = name;
  $("pass-pen").textContent = "Your pen: " + penName;
  $("pass-overlay").classList.remove("hidden");
}
export function hidePassOverlay() { $("pass-overlay").classList.add("hidden"); }

// ---------- academy ----------

export function buildAcademyGrid(levels, progress, unlockedFn, onPick) {
  const wrap = $("academy-grid");
  wrap.innerHTML = "";
  let total = 0;
  for (const lv of levels) {
    const stars = progress[lv.id] || 0;
    total += stars;
    const btn = document.createElement("button");
    btn.type = "button";
    const unlocked = unlockedFn(lv.id);
    btn.className = "level-btn"
      + (stars >= 3 ? " full" : stars > 0 ? " done" : "")
      + (unlocked ? "" : " locked");
    const starRow = new Array(3).fill(0)
      .map((_, i) => `<span class="icn">${i < stars ? ICONS.star : ICONS.starEmpty}</span>`).join("");
    btn.innerHTML = `<b>${lv.id}</b><span class="stars">${starRow}</span>`;
    if (unlocked) btn.addEventListener("click", () => onPick(lv));
    wrap.appendChild(btn);
  }
  const max = levels.length * 3;
  $("academy-progress").innerHTML = `
    <span>${total} / ${max} stars</span>
    <div class="xp-track wide"><div class="xp-fill" style="width:${Math.round((total / max) * 100)}%"></div></div>`;
}

// ---------- pen picker ----------

export function buildPicker(selectedId, onSelect, playerLevel = 99) {
  const wrap = $("pen-carousel");
  wrap.innerHTML = "";
  const unlocked = pen => (pen.unlock || 0) <= playerLevel;
  let selId = selectedId;
  if (!unlocked(PENS.find(p => p.id === selId) || PENS[0])) selId = PENS[0].id;
  for (const pen of PENS) {
    const open = unlocked(pen);
    const card = document.createElement("div");
    card.className = "pen-card" + (pen.id === selId ? " sel" : "") + (open ? "" : " locked");
    card.dataset.pen = pen.id;
    const cv = document.createElement("canvas");
    cv.width = 60; cv.height = 220;
    drawThumb(cv, pen);
    card.appendChild(cv);
    if (!open) {
      const tag = document.createElement("span");
      tag.className = "lock-tag";
      tag.innerHTML = `<span class="icn">${ICONS.lock}</span> Lv ` + pen.unlock;
      card.appendChild(tag);
    }
    card.addEventListener("click", () => {
      showPenInfo(pen, open);
      if (!open) return;
      wrap.querySelectorAll(".pen-card").forEach(c => c.classList.remove("sel"));
      card.classList.add("sel");
      card.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
      onSelect(pen);
    });
    wrap.appendChild(card);
  }
  const sel = PENS.find(p => p.id === selId) || PENS[0];
  showPenInfo(sel, true);
  if (sel.id !== selectedId) onSelect(sel);
  const selCard = wrap.querySelector(`[data-pen="${sel.id}"]`);
  if (selCard) setTimeout(() => selCard.scrollIntoView({ inline: "center", block: "nearest" }), 50);
}

function showPenInfo(pen, unlockedNow = true) {
  $("pen-name").textContent = pen.name + (unlockedNow ? "" : " (locked)");
  $("pen-inspo").textContent = pen.inspo;
  $("pen-trait").innerHTML = `<span class="info-chip">${esc(pen.trait)}</span>`;
  $("pen-quirk").innerHTML = pen.quirk
    ? `<span class="info-chip quirk"><b>${esc(pen.quirk.name)}</b> ${esc(pen.quirk.text)}</span>`
    : "";
  const stats = statBars(pen);
  const labels = { weight: "Weight", glide: "Glide", spin: "Spin", reach: "Reach" };
  $("pen-stats").innerHTML = Object.entries(stats).map(([k, v]) => `
    <div class="stat-row"><span>${labels[k]}</span>
      <div class="stat-track"><div class="stat-fill" style="width:8%" data-w="${Math.round(8 + v * 92)}"></div></div>
    </div>`).join("");
  // Bars start collapsed, then animate to their value via the CSS transition.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    $("pen-stats").querySelectorAll(".stat-fill").forEach(f => { f.style.width = f.dataset.w + "%"; });
  }));
}

// Simplified vertical pen for cards, tip pointing up.
function drawThumb(cv, pen) {
  const g = cv.getContext("2d");
  const r = pen.render;
  const W = 14 + pen.dia * 90;
  const L = 90 + pen.length * 70;
  const x = cv.width / 2, top = (cv.height - L) / 2;
  g.save();
  g.translate(x, top + L);
  g.rotate(-Math.PI / 2);
  // Body along +x from 0..L
  const w2 = W / 2;
  if (r.shape === "pencil") {
    g.fillStyle = r.body; g.fillRect(L * 0.12, -w2, L * 0.78, W);
    g.fillStyle = "rgba(255,255,255,0.3)"; g.fillRect(L * 0.12, -w2, L * 0.78, W * 0.24);
    g.fillStyle = "#b9c0cc"; g.fillRect(L * 0.04, -w2, L * 0.08, W);
    g.fillStyle = r.cap; g.fillRect(0, -w2, L * 0.05, W);
    g.fillStyle = r.tip;
    g.beginPath(); g.moveTo(L * 0.9, -w2); g.lineTo(L, 0); g.lineTo(L * 0.9, w2); g.fill();
    g.fillStyle = "#2b2b2b";
    g.beginPath(); g.moveTo(L * 0.97, -W * 0.14); g.lineTo(L, 0); g.lineTo(L * 0.97, W * 0.14); g.fill();
  } else {
    if (r.shape === "metal") {
      const mg = g.createLinearGradient(0, -w2, 0, w2);
      mg.addColorStop(0, "#e6ebf4"); mg.addColorStop(0.5, r.body); mg.addColorStop(1, "#69707e");
      g.fillStyle = mg;
    } else g.fillStyle = r.body;
    roundRect(g, L * 0.05, -w2, L * 0.85, W, w2); g.fill();
    g.fillStyle = "rgba(255,255,255,0.3)";
    roundRect(g, L * 0.1, -w2 + W * 0.12, L * 0.75, W * 0.2, W * 0.1); g.fill();
    g.fillStyle = r.cap; roundRect(g, 0, -w2, L * 0.3, W, w2); g.fill();
    g.fillStyle = r.tip;
    g.beginPath(); g.moveTo(L * 0.88, -w2); g.lineTo(L, 0); g.lineTo(L * 0.88, w2); g.fill();
  }
  g.restore();
}

function roundRect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// ---------- lobby ----------

export function renderLobby(players, myId, hostId, opts = {}) {
  const minPlayers = opts.minPlayers || 2;
  const ul = $("lobby-roster");
  ul.innerHTML = "";
  for (const p of players) {
    const li = document.createElement("li");
    li.className = (p.ready ? "ready" : "") + (p.connected === false ? " gone" : "");
    const pen = PENS.find(x => x.id === p.penId);
    const state = p.connected === false ? '<span class="state">away</span>'
      : p.ready ? `<span class="state ok"><span class="icn">${ICONS.check}</span> ready</span>`
      : '<span class="state">picking</span>';
    li.innerHTML = `
      <span class="dot" style="background:${chipColor(p.seat)}"></span>
      <span class="who">${esc(p.name)}${p.id === myId ? " (you)" : ""}${p.id === hostId ? `<span class="icn host-crown">${ICONS.crown}</span>` : ""}
        <span class="pen-tag">· ${pen ? esc(pen.name) : ""}</span></span>
      ${state}`;
    ul.appendChild(li);
  }
  const me = players.find(p => p.id === myId);
  const readyBtn = $("lobby-ready");
  if (me) readyBtn.textContent = me.ready ? "Not ready" : "I'm ready";
  const isHost = myId === hostId;
  const canStart = isHost && players.length >= minPlayers && players.every(p => p.ready || p.connected === false);
  $("lobby-start").classList.toggle("hidden", !isHost);
  $("lobby-start").toggleAttribute("disabled", !canStart);
  const waitMsg = players.length < minPlayers
    ? `Waiting for friends to join${minPlayers > 2 ? ` (needs ${minPlayers})` : ""}`
    : canStart ? "All set!"
    : isHost ? "Waiting for everyone to be ready" : "Waiting for the host to start";
  $("lobby-status").textContent = (opts.subtitle ? opts.subtitle + " — " : "") + waitMsg;
}

// ---------- game hud ----------

export function renderChips(players, currentId, aliveCheck) {
  $("chips").innerHTML = players.map(p => `
    <div class="chip${p.id === currentId ? " turn" : ""}${aliveCheck(p.id) ? "" : " dead"}">
      <span class="dot" style="background:${p.team != null ? TEAM_COLORS[p.team] : chipColor(p.seat ?? players.indexOf(p))}"></span>${esc(p.name)}${p.balance != null ? ` <b class="chip-bal">₹${p.balance}</b>` : ""}
    </div>`).join("");
}

export function setTurnBanner(text, mine) {
  const b = $("turn-banner");
  b.textContent = text;
  b.classList.toggle("mine", Boolean(mine));
}

export function setTimer(frac) {
  const wrap = $("timer-wrap");
  if (frac == null) { wrap.classList.add("hidden"); return; }
  wrap.classList.remove("hidden");
  $("timer-bar").style.width = Math.max(0, Math.min(1, frac)) * 100 + "%";
}

export function toast(text, hot = false) {
  const el = document.createElement("div");
  el.className = "toast" + (hot ? " hot" : "");
  el.textContent = text;
  $("toasts").appendChild(el);
  setTimeout(() => el.remove(), 3100);
}

// Big commentator line: louder styling, shorter life, one at a time.
let commEl = null;
export function comment(text) {
  if (!text) return;
  if (commEl) commEl.remove();
  const el = document.createElement("div");
  el.className = "toast comm";
  el.textContent = text;
  $("toasts").appendChild(el);
  commEl = el;
  setTimeout(() => { el.remove(); if (commEl === el) commEl = null; }, 2400);
}

// Reaction floater: takes an icon key (flame/laugh/shock/clap). Unknown
// keys (old clients sending raw emoji) fall back to plain text.
export function floatEmoji(key) {
  const el = document.createElement("div");
  el.className = "femoji";
  if (ICONS[key]) el.innerHTML = `<span class="icn">${ICONS[key]}</span>`;
  else el.textContent = key;
  el.style.left = 12 + Math.random() * 70 + "vw";
  el.style.bottom = "18vh";
  $("float-emoji").appendChild(el);
  setTimeout(() => el.remove(), 1900);
}

// Daav standings between rounds and at series end.
// rows: [{name, balance, delta, isMe, out}] ranked best first.
export function showPayout({ title, sub, rows, continueLabel, showContinue = true }) {
  $("payout-title").textContent = title;
  $("payout-sub").textContent = sub || "";
  $("payout-rows").innerHTML = rows.map((r, i) => `
    <div class="payout-row${r.isMe ? " me" : ""}${r.out ? " out" : ""}">
      <span class="pos">${i + 1}</span>
      <span class="who">${esc(r.name)}${r.isMe ? " (you)" : ""}</span>
      ${r.kos ? `<span class="kos" title="${r.kos} KO">
        <span class="icn">${ICONS.skull}</span>${r.kos}${r.bounty ? `<b class="bounty">+₹${r.bounty}</b>` : ""}</span>` : ""}
      ${r.out ? '<span class="kangal">KANGAL</span>' : ""}
      <span class="bal">₹${r.balance}</span>
      <span class="delta ${r.delta > 0 ? "up" : r.delta < 0 ? "down" : ""}">${r.delta > 0 ? "+" : ""}${r.delta || 0}</span>
    </div>`).join("");
  $("payout-continue").textContent = continueLabel || "Next round";
  $("payout-continue").classList.toggle("hidden", !showContinue);
  show("s-payout");
}

// opts.standings: [{name, isMe, kos, dead}] ranked best first.
// opts.xp: {gained, frac} animates the earned-XP bar.
export function showVictory(title, sub, iconName = "trophy", opts = {}) {
  const el = $("victory-icon");
  el.innerHTML = ICONS[iconName] || ICONS.trophy;
  el.classList.toggle("lost", iconName === "skull");
  $("victory-title").textContent = title;
  $("victory-sub").textContent = sub;
  const st = $("victory-standings");
  if (opts.standings && opts.standings.length > 1) {
    st.classList.remove("hidden");
    st.innerHTML = opts.standings.map((r, i) => `
      <div class="payout-row${r.isMe ? " me" : ""}${r.dead ? " out" : ""}">
        <span class="pos">${i + 1}</span>
        <span class="who">${esc(r.name)}${r.isMe ? " (you)" : ""}</span>
        ${r.kos ? `<span class="kos"><span class="icn">${ICONS.skull}</span>${r.kos}</span>` : ""}
      </div>`).join("");
  } else {
    st.classList.add("hidden");
    st.innerHTML = "";
  }
  const xp = $("victory-xp");
  if (opts.xp) {
    xp.classList.remove("hidden");
    xp.querySelector("span").textContent = `+${opts.xp.gained} XP`;
    const fill = xp.querySelector(".xp-fill");
    fill.style.width = "0%";
    requestAnimationFrame(() => requestAnimationFrame(() => {
      fill.style.width = Math.round(Math.min(1, opts.xp.frac) * 100) + "%";
    }));
  } else {
    xp.classList.add("hidden");
  }
  $("btn-share").classList.add("hidden");   // daily unhides it after
  show("s-victory");
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}
