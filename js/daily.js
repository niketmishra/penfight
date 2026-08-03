// Daily Bawaal. Everyone on the planet gets the same desk, the same pen of
// the day, and the same five bots. Score it, share it, argue about it.

import { PENS } from "./pens.js";
import { TABLES } from "./tables.js";
import { genLayout } from "./game.js";
import { genProps, tableById } from "./tables.js";
import { botRoster } from "./bots.js";

const EPOCH = Date.UTC(2026, 7, 2);   // day #1 = 3 Aug 2026 IST-ish

export function dayNumber(date = new Date()) {
  return Math.max(1, Math.floor((date.getTime() - EPOCH) / 86400000));
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deterministic full setup for the day.
export function dailySetup(day, myId, myName) {
  const rand = mulberry32(day * 2654435761 + 977);
  const tableId = TABLES[Math.floor(rand() * 4)].id;   // teacher's desk stays special
  const table = tableById(tableId);
  const penOfDay = PENS[Math.floor(rand() * PENS.length)].id;
  const bots = botRoster(5, penOfDay, PENS, rand);
  const me = { id: myId, name: myName, penId: penOfDay, isBot: false };
  const players = [me, ...bots];
  players.forEach((p, i) => { p.seat = i; });
  const layout = genLayout(players, table, rand);
  const clutter = genProps(table, rand);
  return { day, tableId, penOfDay, players, layout, props: clutter.props, zones: clutter.zones };
}

export function dailyScore({ kos, turnsSurvived, won, mounts }) {
  return kos * 1000 + turnsSurvived * 150 + (won ? 2500 : 0) + mounts * 800;
}

export function dailyShareText(day, { score, kos, turnsSurvived, won }) {
  const cap = won ? "last pen standing" : `survived ${turnsSurvived} turns`;
  return `Pen Fight Daily #${day}\n${score.toLocaleString("en-IN")} pts · ${kos} KO${kos === 1 ? "" : "s"} · ${cap}\nhttps://niketmishra.github.io/penfight/`;
}
