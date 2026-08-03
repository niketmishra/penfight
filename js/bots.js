// Bot opponents for practice mode. They aim at a scored target with gaussian
// noise, pick an impulse that carries them roughly to the target and through
// it toward the edge, and add a little contact offset for natural spin.

import { PHYS } from "./physics.js";
import { penById } from "./pens.js";
import { J_MAX } from "./flick.js";
import { rayToEdge } from "./tables.js";

const BOT_NAMES = ["Bunty", "Chintu", "Pinky", "Golu", "Mona"];

// Difficulty shapes aim noise, self-preservation and power judgement.
const DIFFS = {
  easy: { sigma: [0.2, 0.14], caution: [1.2, 0.8], pow: [1.0, 0.5] },
  normal: { sigma: [0.08, 0.1], caution: [0.6, 0.8], pow: [1.15, 0.25] },
  ace: { sigma: [0.025, 0.045], caution: [0.5, 0.4], pow: [1.18, 0.1] }
};

export function botRoster(count, excludePenId, penPool, rand = Math.random, difficulty = "normal") {
  const d = DIFFS[difficulty] || DIFFS.normal;
  const pens = penPool.filter(p => p.id !== excludePenId);
  shuffle(pens, rand);
  return Array.from({ length: count }, (_, i) => ({
    id: "bot-" + i,
    name: BOT_NAMES[i % BOT_NAMES.length],
    penId: (pens[i % pens.length] || penPool[0]).id,
    isBot: true,
    sigma: d.sigma[0] + rand() * d.sigma[1],      // aim noise, radians
    caution: d.caution[0] + rand() * d.caution[1],
    powBase: d.pow[0], powSpread: d.pow[1]
  }));
}

export function attachBots(match) {
  let timer = null;
  match.on("turn", ({ player }) => {
    if (!player || !player.isBot) return;
    clearTimeout(timer);
    timer = setTimeout(() => takeTurn(match, player), 800 + Math.random() * 800);
  });
  match.on("over", () => clearTimeout(timer));
  return { cancel: () => clearTimeout(timer) };
}

function takeTurn(match, bot) {
  if (match.state.phase !== "aiming" || match.state.currentId !== bot.id) return;
  const me = match.sim.getBody(bot.id);
  if (!me) { match.advanceTurn(); return; }
  const table = match.sim.table;
  const myPos = me.getPosition();
  const myPen = penById(bot.penId);

  let best = null;
  match.sim.eachPen((uid, data, x, y) => {
    if (uid === bot.id) return;
    if (bot.team != null && data.ownerId && match.byId.get(data.ownerId)
      && match.byId.get(data.ownerId).team === bot.team) return;   // teammate
    const dx = x - myPos.x, dy = y - myPos.y;
    const dist = Math.hypot(dx, dy) || 0.001;
    const dirX = dx / dist, dirY = dy / dist;
    // How close is the target to falling if pushed along this line?
    const exitDist = rayToEdge(table, x, y, dirX, dirY);
    const edgeBonus = Math.max(0, 1.6 - exitDist) * 0.9;
    // Would this shot carry me off too? Stopping distance at full send.
    const a = PHYS.fricDecel * myPen.linDampMult * (table.frictionMult || 1);
    const vMax = J_MAX / myPen.mass;
    const stopDist = (vMax * vMax) / (2 * a);
    const myExit = rayToEdge(table, myPos.x, myPos.y, dirX, dirY);
    const selfRisk = stopDist > myExit ? bot.caution * Math.min(1, dist / Math.max(0.001, myExit)) : 0;
    const score = 1.5 / dist + edgeBonus - selfRisk;
    if (!best || score > best.score) best = { score, x, y, dist, dirX, dirY };
  });
  if (!best) { match.advanceTurn(); return; }

  // Aim with noise
  const noise = gauss() * bot.sigma;
  const cos = Math.cos(noise), sin = Math.sin(noise);
  const dx = best.dirX * cos - best.dirY * sin;
  const dy = best.dirX * sin + best.dirY * cos;

  // Impulse: enough to reach the target and carry it toward the edge.
  // Aiming through the target, not just at it, is what ends duels.
  const a = PHYS.fricDecel * myPen.linDampMult * (table.frictionMult || 1);
  const carry = Math.min(3.5, rayToEdge(table, best.x, best.y, dx, dy) * 0.8 + 0.5);
  const powB = bot.powBase || 1.15, powS = bot.powSpread ?? 0.25;
  const vNeed = Math.sqrt(2 * a * (best.dist + carry)) * (powB + Math.random() * powS);
  const J = Math.min(J_MAX, Math.max(J_MAX * 0.2, vNeed * myPen.mass));

  match.applyFlick(bot.id, {
    dx, dy, J,
    off: gauss() * 0.18
  });
}

function gauss() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function shuffle(arr, rand = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
