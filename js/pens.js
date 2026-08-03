// Pen roster. Pure data, tune freely.
//
// Balance model: a flick's impulse J comes only from finger speed, so launch
// velocity = J / mass. Heavy pens need a genuinely faster swipe to move but
// transfer brutal momentum on contact. Light pens are agile and easy to
// launch, and just as easy to knock off.
//
// Units: length and dia are world units (table is 6 x 9). mass is relative,
// 1.0 = a basic ballpoint. linDampMult / angDampMult scale table drag
// (higher = stops sooner / spins down sooner). restitution = clack bounce.

export const PENS = [
  {
    id: "ronalds045",
    unlock: 0,
    quirk: { name: "Sarkari Pen", text: "Nothing special about it. That is the special thing. +5% everything." },
    flickMult: 1.05,
    name: "Ronalds 045",
    inspo: "the one in every pencil box",
    trait: "Everyone's first pen. Light, honest, replaceable.",
    length: 1.40, dia: 0.16, mass: 1.0,
    friction: 0.35, restitution: 0.45,
    linDampMult: 1.0, angDampMult: 1.0,
    render: { shape: "round", body: "#eef0f4", cap: "#2b6cff", tip: "#c8ccd6", clip: true }
  },
  {
    id: "trimaxx",
    unlock: 6,
    quirk: { name: "Haathi", text: "Too heavy to flip. Cannot be launched airborne or mounted." },
    airborneImmune: true,
    name: "TriMaxx",
    inspo: "the chunky rollerball legend",
    trait: "The pen fight legend. Hard to launch, plows through crowds.",
    length: 1.45, dia: 0.24, mass: 2.2,
    friction: 0.40, restitution: 0.40,
    linDampMult: 1.1, angDampMult: 1.1,
    render: { shape: "round", body: "#20242e", cap: "#0f9d58", tip: "#4a4f5c", clip: true }
  },
  {
    id: "butterglide",
    unlock: 0,
    quirk: { name: "Makkhan", text: "Ink slicks and sticky patches mean nothing to it." },
    zoneImmune: true,
    name: "Jello Butterglide",
    inspo: "smooth like butter",
    trait: "Slippery. Slides far on the same flick, drifts past the edge if you overcook it.",
    length: 1.38, dia: 0.18, mass: 1.1,
    friction: 0.25, restitution: 0.42,
    linDampMult: 0.65, angDampMult: 0.8,
    render: { shape: "round", body: "#fff2b8", cap: "#ff9f1c", tip: "#e0c979", clip: false }
  },
  {
    id: "pentronic",
    unlock: 0,
    quirk: { name: "Patla Sa", text: "So slim it barely takes the hit. Incoming shoves lose 12%." },
    massMult: 1.12, flickMult: 1.12,
    name: "Zinc Pentronic",
    inspo: "the sleek slim one",
    trait: "Slim and slight. A smaller target, but light enough to get launched.",
    length: 1.42, dia: 0.13, mass: 0.85,
    friction: 0.35, restitution: 0.48,
    linDampMult: 0.9, angDampMult: 0.9,
    render: { shape: "round", body: "#101318", cap: "#38bdf8", tip: "#2a2e38", clip: true }
  },
  {
    id: "writeometer",
    unlock: 3,
    quirk: { name: "Lambu", text: "That reach. Flick it from one and a half arms away." },
    armMult: 1.5,
    name: "Glare Write-o-Meter",
    inspo: "counts every metre it writes",
    trait: "Longest pen on the table. Huge reach, wild spin on tip flicks, big target.",
    length: 1.62, dia: 0.17, mass: 1.15,
    friction: 0.35, restitution: 0.45,
    linDampMult: 1.0, angDampMult: 1.0,
    render: { shape: "round", body: "#f5f6fa", cap: "#e63946", tip: "#c8ccd6", clip: true }
  },
  {
    id: "copilotv6",
    unlock: 2,
    quirk: { name: "Googly", text: "Spin it and it bends double. The trick shot pen." },
    magnusMult: 2,
    name: "Copilot V6",
    inspo: "the smooth gel flyer",
    trait: "Barely any spin drag. Set it spinning and it stays live.",
    length: 1.40, dia: 0.15, mass: 0.95,
    friction: 0.30, restitution: 0.50,
    linDampMult: 0.95, angDampMult: 0.5,
    render: { shape: "round", body: "#1b2130", cap: "#8b5cf6", tip: "#39415a", clip: true }
  },
  {
    id: "sparkervictor",
    unlock: 8,
    quirk: { name: "Loha", text: "Solid metal. Its hits send lighter pens flying, literally." },
    launcher: true,
    name: "Sparker Victor",
    inspo: "the metal one from an uncle",
    trait: "Solid metal. Heaviest pen here, loudest clack, needs a real flick.",
    length: 1.35, dia: 0.18, mass: 2.6,
    friction: 0.30, restitution: 0.65,
    linDampMult: 1.15, angDampMult: 1.2,
    render: { shape: "metal", body: "#aeb6c4", cap: "#7d8698", tip: "#8f97a8", clip: true }
  },
  {
    id: "notraj621",
    unlock: 4,
    quirk: { name: "Jugaadu", text: "Survives the chalk line one extra round. Last bench genes." },
    stormGrace: 1,
    name: "Notraj 621 HB",
    inspo: "the pencil that ruled the last bench",
    trait: "Hexagonal. Does not roll, stops dead, and it is the longest thing on the table.",
    length: 1.75, dia: 0.15, mass: 0.9,
    friction: 0.55, restitution: 0.30,
    linDampMult: 1.2, angDampMult: 2.5,
    render: { shape: "pencil", body: "#d43d2a", cap: "#f3a6b2", tip: "#e8c496", clip: false }
  }
];

export function penById(id) {
  return PENS.find(p => p.id === id) || PENS[0];
}

// 0..1 stat bars for the picker.
export function statBars(pen) {
  return {
    weight: norm(pen.mass, 0.85, 2.6),
    glide: 1 - norm(pen.linDampMult * (0.5 + pen.friction), 0.5 * 1.15, 1.2 * 1.6),
    spin: 1 - norm(pen.angDampMult, 0.5, 2.5),
    reach: norm(pen.length, 1.35, 1.75)
  };
}

function norm(v, lo, hi) {
  return Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
}
