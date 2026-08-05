// Desi voice pack: sampled meme lines for the moments that matter.
//
// Fired only when a pen goes over, when money changes hands, or when
// somebody walks out. Deliberately NOT on collisions: pens knock into each
// other many times a turn, and a voice line per contact is noise.
//
// Every clip plays to its end. A line already speaking is never cut off; a
// bigger moment arriving mid-line waits its turn instead of talking over it.
//
// Recast any moment by swapping a filename in CLIPS. Nothing else changes.

import { audioCtx, isMuted, onMute } from "./sfx.js";

const BASE = "assets/voice/";

export const CLIPS = {
  ko: ["ko-1.mp3", "ko-2.mp3", "ko-3.mp3", "ko-4.mp3", "ko-5.mp3"],
  selfko: ["selfko-1.mp3", "selfko-2.mp3"],
  win: ["win-1.mp3", "win-2.mp3", "win-3.mp3", "win-4.mp3", "win-5.mp3", "win-6.mp3"],
  kangal: ["kangal-1.mp3"],
  out: ["out-1.mp3", "out-2.mp3"]
};

// A bigger moment queues behind a smaller one; a smaller one is dropped.
const PRIORITY = { out: 1, ko: 2, selfko: 3, kangal: 4, win: 5 };
const GAIN = { ko: 0.85, selfko: 0.9, kangal: 0.9, win: 0.95, out: 0.8 };

const GAP = 220;               // ms of air between consecutive lines

const buffers = new Map();     // file -> AudioBuffer
const pending = new Map();     // file -> Promise
let enabled = true;
let loaded = false;

let liveLine = null;           // { src, gain, kind, endsAt }
let queued = null;             // kind waiting for the current line to finish
let queueTimer = null;
let lastPicked = {};           // kind -> last file, to avoid repeats

export const stats = { lines: 0, dropped: 0, lastFile: null };

export function setEnabled(on) {
  enabled = Boolean(on);
  if (!enabled) stopAll();
}
export function isEnabled() { return enabled; }

onMute(m => { if (m) stopAll(); });

// Pull every clip into memory once. ~370 KB total; failures are silent
// because the game must never depend on audio.
export function preload() {
  if (loaded) return;
  loaded = true;
  for (const files of Object.values(CLIPS)) for (const f of files) load(f);
}

function load(file) {
  if (buffers.has(file)) return Promise.resolve(buffers.get(file));
  if (pending.has(file)) return pending.get(file);
  const p = fetch(BASE + file)
    .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
    .then(buf => new Promise((res, rej) => {
      const ac = audioCtx();
      if (!ac) return rej(new Error("no audio context"));
      // Callback form: Safari still doesn't return a promise here.
      ac.decodeAudioData(buf, b => res(b), e => rej(e));
    }))
    .then(b => { buffers.set(file, b); pending.delete(file); return b; })
    .catch(() => { pending.delete(file); return null; });
  pending.set(file, p);
  return p;
}

function pick(kind) {
  const files = CLIPS[kind];
  if (!files || !files.length) return null;
  if (files.length === 1) return files[0];
  const avoid = lastPicked[kind];
  let f = files[Math.floor(Math.random() * files.length)];
  if (f === avoid) f = files[(files.indexOf(f) + 1) % files.length];
  lastPicked[kind] = f;
  return f;
}

function ready(kind) {
  return enabled && !isMuted() && audioCtx() != null && Boolean(CLIPS[kind]);
}

function speaking() {
  return Boolean(liveLine) && Date.now() < liveLine.endsAt;
}

function start(kind) {
  if (!ready(kind)) return;
  const file = pick(kind);
  if (!file) return;
  const go = () => {
    if (!ready(kind) || speaking()) return;
    const ac = audioCtx();
    const buf = buffers.get(file);
    if (!ac || !buf) return;
    const src = ac.createBufferSource();
    const g = ac.createGain();
    src.buffer = buf;
    g.gain.value = GAIN[kind] ?? 0.85;
    src.connect(g).connect(ac.destination);
    src.start();
    liveLine = { src, gain: g, kind, endsAt: Date.now() + buf.duration * 1000 };
    stats.lines++;
    stats.lastFile = file;
    // When it finishes on its own, let anything queued have the floor.
    src.onended = () => {
      if (liveLine && liveLine.src === src) liveLine = null;
      flushQueue();
    };
  };
  if (buffers.has(file)) go(); else load(file).then(b => { if (b) go(); });
}

function flushQueue() {
  clearTimeout(queueTimer);
  if (!queued) return;
  const kind = queued;
  queued = null;
  queueTimer = setTimeout(() => start(kind), GAP);
}

// Announce a moment. Nothing ever interrupts a line in progress: a bigger
// moment waits for the current one to finish, a smaller one is dropped.
export function line(kind) {
  if (!ready(kind)) return;
  if (speaking()) {
    const prio = PRIORITY[kind] || 1;
    const livePrio = PRIORITY[liveLine.kind] || 1;
    const queuedPrio = queued ? (PRIORITY[queued] || 1) : 0;
    if (prio > livePrio && prio > queuedPrio) queued = kind;
    else stats.dropped++;
    return;
  }
  start(kind);
}

// Only for muting or leaving a match - never mid-sentence during play.
export function stopAll() {
  clearTimeout(queueTimer);
  queued = null;
  if (!liveLine) return;
  const { src } = liveLine;
  liveLine = null;
  try { src.onended = null; src.stop(); } catch { /* already finished */ }
}
