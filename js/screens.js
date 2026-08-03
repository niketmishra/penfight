// DOM screens and HUD. main.js wires the callbacks; this module only paints.

import { PENS, statBars } from "./pens.js";

const $ = id => document.getElementById(id);

const SCREENS = ["s-home", "s-picker", "s-join", "s-lobby", "s-victory"];
const CHIP_COLORS = ["#3d7bff", "#ff5470", "#ffd166", "#4ade80", "#c084fc", "#fb923c"];

export function show(name) {
  for (const id of SCREENS) $(id).classList.toggle("hidden", id !== name);
  $("hud").classList.toggle("hidden", name !== null);
}

export function chipColor(seat) { return CHIP_COLORS[seat % CHIP_COLORS.length]; }

// ---------- pen picker ----------

export function buildPicker(selectedId, onSelect) {
  const wrap = $("pen-carousel");
  wrap.innerHTML = "";
  for (const pen of PENS) {
    const card = document.createElement("div");
    card.className = "pen-card" + (pen.id === selectedId ? " sel" : "");
    card.dataset.pen = pen.id;
    const cv = document.createElement("canvas");
    cv.width = 60; cv.height = 220;
    drawThumb(cv, pen);
    card.appendChild(cv);
    card.addEventListener("click", () => {
      wrap.querySelectorAll(".pen-card").forEach(c => c.classList.remove("sel"));
      card.classList.add("sel");
      card.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
      showPenInfo(pen);
      onSelect(pen);
    });
    wrap.appendChild(card);
  }
  const sel = PENS.find(p => p.id === selectedId) || PENS[0];
  showPenInfo(sel);
  const selCard = wrap.querySelector(`[data-pen="${sel.id}"]`);
  if (selCard) setTimeout(() => selCard.scrollIntoView({ inline: "center", block: "nearest" }), 50);
}

function showPenInfo(pen) {
  $("pen-name").textContent = pen.name;
  $("pen-inspo").textContent = pen.inspo;
  $("pen-trait").textContent = pen.trait;
  const stats = statBars(pen);
  const labels = { weight: "Weight", glide: "Glide", spin: "Spin", reach: "Reach" };
  $("pen-stats").innerHTML = Object.entries(stats).map(([k, v]) => `
    <div class="stat-row"><span>${labels[k]}</span>
      <div class="stat-track"><div class="stat-fill" style="width:${Math.round(8 + v * 92)}%"></div></div>
    </div>`).join("");
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

export function renderLobby(players, myId, hostId, penName) {
  const ul = $("lobby-roster");
  ul.innerHTML = "";
  for (const p of players) {
    const li = document.createElement("li");
    li.className = (p.ready ? "ready" : "") + (p.connected === false ? " gone" : "");
    const pen = PENS.find(x => x.id === p.penId);
    li.innerHTML = `
      <span class="dot" style="background:${chipColor(p.seat)}"></span>
      <span class="who">${esc(p.name)}${p.id === myId ? " (you)" : ""}${p.id === hostId ? " 👑" : ""}
        <span class="pen-tag">· ${pen ? esc(pen.name) : ""}</span></span>
      <span class="state">${p.connected === false ? "away" : p.ready ? "ready" : "picking"}</span>`;
    ul.appendChild(li);
  }
  const me = players.find(p => p.id === myId);
  const readyBtn = $("lobby-ready");
  if (me) readyBtn.textContent = me.ready ? "Not ready" : "I'm ready";
  const isHost = myId === hostId;
  const canStart = isHost && players.length >= 2 && players.every(p => p.ready || p.connected === false);
  $("lobby-start").classList.toggle("hidden", !isHost);
  $("lobby-start").toggleAttribute("disabled", !canStart);
  $("lobby-status").textContent =
    players.length < 2 ? "Waiting for friends to join" :
    canStart ? "All set!" :
    isHost ? "Waiting for everyone to be ready" : "Waiting for the host to start";
}

// ---------- game hud ----------

export function renderChips(players, currentId, aliveCheck) {
  $("chips").innerHTML = players.map(p => `
    <div class="chip${p.id === currentId ? " turn" : ""}${aliveCheck(p.id) ? "" : " dead"}">
      <span class="dot" style="background:${chipColor(p.seat ?? players.indexOf(p))}"></span>${esc(p.name)}
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

export function floatEmoji(emoji) {
  const el = document.createElement("div");
  el.className = "femoji";
  el.textContent = emoji;
  el.style.left = 12 + Math.random() * 70 + "vw";
  el.style.bottom = "18vh";
  $("float-emoji").appendChild(el);
  setTimeout(() => el.remove(), 1900);
}

export function showVictory(title, sub, emoji) {
  $("victory-emoji").textContent = emoji;
  $("victory-title").textContent = title;
  $("victory-sub").textContent = sub;
  show("s-victory");
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}
