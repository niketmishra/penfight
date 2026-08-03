// Persistent save. One localStorage blob, defaults merged over whatever is
// stored so new fields never break old saves. pf_id/pf_name/pf_pen/pf_bots
// stay as their own keys (network identity and quick prefs).

const KEY = "pf_save";

const DEFAULTS = {
  v: 1,
  xp: 0,
  stats: {
    matches: 0, wins: 0, kos: 0, selfKos: 0, mounts: 0,
    holeSinks: 0, stormDodges: 0, academyStars: 0, dailyPlays: 0
  },
  academy: {},     // levelId -> best stars
  dailyBest: {},   // dayNumber -> best score
  settings: { lang: "hi", sound: true, reduceMotion: false },
  seenTutorial: false
};

function load() {
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(KEY)) || {}; }
  catch { stored = {}; }
  const merged = { ...DEFAULTS, ...stored };
  merged.stats = { ...DEFAULTS.stats, ...(stored.stats || {}) };
  merged.settings = { ...DEFAULTS.settings, ...(stored.settings || {}) };
  merged.academy = stored.academy || {};
  merged.dailyBest = stored.dailyBest || {};
  return merged;
}

export const save = load();

export function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(save)); } catch { /* full */ }
}

export function addXp(amount) {
  save.xp += Math.max(0, Math.round(amount));
  persist();
}

// Level curve: each level needs a bit more than the last.
export function levelFor(xp) {
  let lvl = 1, need = 400, left = xp;
  while (left >= need && lvl < 40) { left -= need; lvl += 1; need = Math.round(need * 1.25); }
  return { level: lvl, into: left, need };
}

export function bumpStat(key, by = 1) {
  if (key in save.stats) { save.stats[key] += by; persist(); }
}

export function setAcademyStars(levelId, stars) {
  const prev = save.academy[levelId] || 0;
  if (stars > prev) {
    save.academy[levelId] = stars;
    save.stats.academyStars += stars - prev;
    persist();
  }
}

export function setDailyBest(day, score) {
  const prev = save.dailyBest[day] || 0;
  if (score > prev) { save.dailyBest[day] = score; persist(); }
  return Math.max(prev, score);
}
