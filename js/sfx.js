// Synthesized sounds and haptics. No samples, all WebAudio.
// init() must be called from a user gesture (iOS unlock).

let ac = null;
let unlocked = false;

export function init() {
  if (!ac) {
    try { ac = new (window.AudioContext || window.webkitAudioContext)(); }
    catch { return; }
  }
  if (ac.state === "suspended") ac.resume();
  unlocked = true;
}

function now() { return ac.currentTime; }

// Pen on pen. Pitch drops with mass, volume scales with impulse.
export function clack(impulse, mass = 1) {
  if (!unlocked || !ac) return;
  const vol = Math.min(0.7, 0.12 + impulse * 0.055);
  const t = now();

  // Body knock: short sine ping
  const osc = ac.createOscillator();
  const og = ac.createGain();
  osc.type = "triangle";
  const f0 = 1400 / Math.sqrt(mass);
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(f0 * 0.55, t + 0.06);
  og.gain.setValueAtTime(vol, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
  osc.connect(og).connect(ac.destination);
  osc.start(t); osc.stop(t + 0.09);

  // Plastic click: filtered noise burst
  const nb = noiseBurst(0.035);
  const bp = ac.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 2600 / Math.pow(mass, 0.3);
  bp.Q.value = 1.2;
  const ng = ac.createGain();
  ng.gain.setValueAtTime(vol * 0.9, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
  nb.connect(bp).connect(ng).connect(ac.destination);
  nb.start(t);
}

export function whoosh(power = 1) {
  if (!unlocked || !ac) return;
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
  if (!unlocked || !ac) return;
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
  if (!unlocked || !ac) return;
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
  if (!unlocked || !ac) return;
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
