// Synthesized sounds and haptics. No samples, all WebAudio.
// init() must be called from a user gesture (iOS unlock).

let ac = null;
let unlocked = false;
let muted = false;

export function setMuted(m) {
  if (m) ambience(false);   // stop the loop before the gate closes
  muted = Boolean(m);
}

export function init() {
  if (!ac) {
    try { ac = new (window.AudioContext || window.webkitAudioContext)(); }
    catch { return; }
  }
  if (ac.state === "suspended") ac.resume();
  unlocked = true;
}

function now() { return ac.currentTime; }

// Pen on pen. Material changes the voice: metal rings, wood thuds,
// plastic clicks. Volume scales with contact impulse.
export function clack(impulse, material = "plastic") {
  if (!unlocked || !ac || muted) return;
  const vol = Math.min(0.7, 0.12 + impulse * 0.055);
  const t = now();

  const M = {
    plastic: { f: 1400, decay: 0.08, noiseF: 2600, ring: 0 },
    metal: { f: 2300, decay: 0.22, noiseF: 4200, ring: 0.16 },
    wood: { f: 700, decay: 0.06, noiseF: 1400, ring: 0 }
  }[material] || { f: 1400, decay: 0.08, noiseF: 2600, ring: 0 };

  const osc = ac.createOscillator();
  const og = ac.createGain();
  osc.type = material === "metal" ? "sine" : "triangle";
  osc.frequency.setValueAtTime(M.f, t);
  osc.frequency.exponentialRampToValueAtTime(M.f * 0.55, t + M.decay * 0.8);
  og.gain.setValueAtTime(vol, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + M.decay);
  osc.connect(og).connect(ac.destination);
  osc.start(t); osc.stop(t + M.decay + 0.02);

  if (M.ring) {
    const ring = ac.createOscillator();
    const rg = ac.createGain();
    ring.type = "sine";
    ring.frequency.value = M.f * 1.62;
    rg.gain.setValueAtTime(vol * 0.35, t);
    rg.gain.exponentialRampToValueAtTime(0.001, t + M.ring);
    ring.connect(rg).connect(ac.destination);
    ring.start(t); ring.stop(t + M.ring + 0.02);
  }

  const nb = noiseBurst(0.035);
  const bp = ac.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = M.noiseF;
  bp.Q.value = 1.2;
  const ng = ac.createGain();
  ng.gain.setValueAtTime(vol * 0.9, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
  nb.connect(bp).connect(ng).connect(ac.destination);
  nb.start(t);
}

// School bell: two-tone electric ring.
export function bell() {
  if (!unlocked || !ac || muted) return;
  const t = now();
  for (let i = 0; i < 7; i++) {
    const t0 = t + i * 0.09;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = "square";
    osc.frequency.value = i % 2 ? 1180 : 940;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.07, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.085);
    osc.connect(g).connect(ac.destination);
    osc.start(t0); osc.stop(t0 + 0.1);
  }
}

// Crowd gasp for a pen teetering on the edge.
export function oooh() {
  if (!unlocked || !ac || muted) return;
  const t = now();
  const nb = noiseBurst(0.5);
  const bp = ac.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.setValueAtTime(320, t);
  bp.frequency.exponentialRampToValueAtTime(520, t + 0.28);
  bp.frequency.exponentialRampToValueAtTime(280, t + 0.5);
  bp.Q.value = 2.6;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.11, t + 0.12);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
  nb.connect(bp).connect(g).connect(ac.destination);
  nb.start(t);
}

// Rubber band twang: a pitch-bent pluck.
export function boing() {
  if (!unlocked || !ac || muted) return;
  const t = now();
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(180, t);
  osc.frequency.exponentialRampToValueAtTime(90, t + 0.06);
  osc.frequency.exponentialRampToValueAtTime(150, t + 0.14);
  osc.frequency.exponentialRampToValueAtTime(105, t + 0.24);
  g.gain.setValueAtTime(0.28, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
  osc.connect(g).connect(ac.destination);
  osc.start(t); osc.stop(t + 0.32);
}

// Coin clink for antes and payouts.
export function clink(delay = 0) {
  if (!unlocked || !ac || muted) return;
  const t = now() + delay;
  for (const [f, d] of [[2650, 0.09], [3970, 0.13]]) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = "sine";
    osc.frequency.value = f;
    g.gain.setValueAtTime(0.09, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + d);
    osc.connect(g).connect(ac.destination);
    osc.start(t); osc.stop(t + d + 0.02);
  }
}

export function clinkCascade(n = 4) {
  for (let i = 0; i < n; i++) clink(i * 0.09);
}

// Soft menu tap: a filtered thump, quiet enough to live on every button.
export function uiTap() {
  if (!unlocked || !ac || muted) return;
  const t = now();
  const osc = ac.createOscillator();
  const g = ac.createGain();
  const f = ac.createBiquadFilter();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(620, t);
  osc.frequency.exponentialRampToValueAtTime(240, t + 0.06);
  f.type = "lowpass";
  f.frequency.value = 1400;
  g.gain.setValueAtTime(0.06, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
  osc.connect(f).connect(g).connect(ac.destination);
  osc.start(t); osc.stop(t + 0.09);
}

// Short airy sweep for screen changes.
export function uiSwish() {
  if (!unlocked || !ac || muted) return;
  const t = now();
  const len = 0.16;
  const buf = ac.createBuffer(1, ac.sampleRate * len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = ac.createBufferSource();
  src.buffer = buf;
  const f = ac.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.setValueAtTime(700, t);
  f.frequency.exponentialRampToValueAtTime(2400, t + len);
  f.Q.value = 1.2;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.05, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + len);
  src.connect(f).connect(g).connect(ac.destination);
  src.start(t);
}

// Kill-cam slow-mo entry.
export function whoomp() {
  if (!unlocked || !ac || muted) return;
  const t = now();
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(220, t);
  osc.frequency.exponentialRampToValueAtTime(46, t + 0.35);
  g.gain.setValueAtTime(0.001, t);
  g.gain.exponentialRampToValueAtTime(0.3, t + 0.05);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
  osc.connect(g).connect(ac.destination);
  osc.start(t); osc.stop(t + 0.42);
}

// Classroom ambience: ceiling-fan hum plus occasional murmurs.
let ambNodes = null;
let ambTimer = null;
export function ambience(on) {
  if (!unlocked || !ac || muted) return;
  if (on && !ambNodes) {
    const src = ac.createBufferSource();
    const len = ac.sampleRate * 2;
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {   // brown-ish noise
      last = (last + (Math.random() * 2 - 1) * 0.02) * 0.98;
      data[i] = last * 3;
    }
    src.buffer = buf;
    src.loop = true;
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 160;
    const g = ac.createGain();
    g.gain.value = 0.05;
    src.connect(lp).connect(g).connect(ac.destination);
    src.start();
    ambNodes = { src, g };
    const murmur = () => {
      if (!ambNodes) return;
      const t = now();
      const nb = noiseBurst(0.35);
      const bp = ac.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 400 + Math.random() * 500;
      bp.Q.value = 3;
      const mg = ac.createGain();
      mg.gain.setValueAtTime(0.0001, t);
      mg.gain.exponentialRampToValueAtTime(0.02 + Math.random() * 0.02, t + 0.1);
      mg.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      nb.connect(bp).connect(mg).connect(ac.destination);
      nb.start(t);
      ambTimer = setTimeout(murmur, 1500 + Math.random() * 4000);
    };
    ambTimer = setTimeout(murmur, 1200);
  } else if (!on && ambNodes) {
    try { ambNodes.src.stop(); } catch { /* already stopped */ }
    clearTimeout(ambTimer);
    ambNodes = null;
  }
}

export function whoosh(power = 1) {
  if (!unlocked || !ac || muted) return;
  const t = now();
  const nb = noiseBurst(0.16);
  const bp = ac.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.setValueAtTime(500, t);
  bp.frequency.exponentialRampToValueAtTime(2200, t + 0.12);
  bp.Q.value = 0.8;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.001, t);
  g.gain.exponentialRampToValueAtTime(0.16 * power, t + 0.04);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
  nb.connect(bp).connect(g).connect(ac.destination);
  nb.start(t);
}

export function fall() {
  if (!unlocked || !ac || muted) return;
  const t = now();
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(660, t);
  osc.frequency.exponentialRampToValueAtTime(140, t + 0.35);
  g.gain.setValueAtTime(0.22, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
  osc.connect(g).connect(ac.destination);
  osc.start(t); osc.stop(t + 0.42);
}

export function win() {
  if (!unlocked || !ac || muted) return;
  const t = now();
  [523, 659, 784, 1047].forEach((f, i) => {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = "triangle";
    osc.frequency.value = f;
    const t0 = t + i * 0.11;
    g.gain.setValueAtTime(0.001, t0);
    g.gain.exponentialRampToValueAtTime(0.2, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.28);
    osc.connect(g).connect(ac.destination);
    osc.start(t0); osc.stop(t0 + 0.3);
  });
}

export function tick() {
  if (!unlocked || !ac || muted) return;
  const t = now();
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = "square";
  osc.frequency.value = 900;
  g.gain.setValueAtTime(0.05, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
  osc.connect(g).connect(ac.destination);
  osc.start(t); osc.stop(t + 0.035);
}

function noiseBurst(dur) {
  const len = Math.max(1, Math.floor(ac.sampleRate * dur));
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buf;
  return src;
}

export function vibrate(ms) {
  if (navigator.vibrate) { try { navigator.vibrate(ms); } catch { /* ignore */ } }
}
