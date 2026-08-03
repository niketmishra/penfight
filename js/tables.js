// Table configs. Everything the sim, bots, layout and renderer need to know
// about a playing surface lives here as data. Holes (Compass Box mode) are
// injected per-match; they are simply regions where a pen counts as gone.

export const TABLES = [
  {
    id: "classroom",
    name: "Classroom Desk",
    shape: "rect", w: 6.0, h: 9.0,
    frictionMult: 1.0,
    theme: {
      top: ["#8a5a34", "#9a6a3e", "#7e5230"],
      planks: 5, grain: true, scratches: true,
      edge: "rgba(30,16,4,0.8)", floor: "#0a0d16"
    },
    unlock: 0
  },
  {
    id: "examhall",
    name: "Exam Hall",
    shape: "rect", w: 7.4, h: 10.2,
    frictionMult: 1.0,
    seam: true,           // two desks pushed together, seam down the middle
    theme: {
      top: ["#93643c", "#a5794c", "#87573a"],
      planks: 6, grain: true, scratches: true, paper: true,
      edge: "rgba(30,16,4,0.8)", floor: "#0a0d16"
    },
    unlock: 2
  },
  {
    id: "canteen",
    name: "Canteen Table",
    shape: "round", r: 4.1,
    frictionMult: 0.78,   // steel top, everything glides
    theme: {
      top: ["#8f98a6", "#b7bfcb", "#79818e"],
      planks: 0, grain: false, scratches: true, steel: true,
      edge: "rgba(20,24,32,0.9)", floor: "#0b0a08"
    },
    unlock: 4
  },
  {
    id: "lastbench",
    name: "Last Bench",
    shape: "rect", w: 4.4, h: 10.6,
    frictionMult: 1.08,
    theme: {
      top: ["#6f4526", "#7c522e", "#634020"],
      planks: 3, grain: true, scratches: true, graffiti: true,
      edge: "rgba(24,12,2,0.85)", floor: "#0a0d16"
    },
    unlock: 6
  },
  {
    id: "teachersdesk",
    name: "Teacher's Desk",
    shape: "rect", w: 6.6, h: 9.4,
    frictionMult: 0.62,   // glass top, terrifying
    theme: {
      top: ["#25404a", "#31525e", "#1e3640"],
      planks: 0, grain: false, scratches: false, glass: true,
      edge: "rgba(10,20,26,0.9)", floor: "#070a10"
    },
    unlock: 9
  }
];

export function tableById(id) {
  return TABLES.find(t => t.id === id) || TABLES[0];
}

// Bounding half-extents, used for view fitting and layout scaling.
export function tableHalf(table) {
  return table.shape === "round"
    ? { x: table.r, y: table.r }
    : { x: table.w / 2, y: table.h / 2 };
}

export function tableContains(table, x, y) {
  return table.shape === "round"
    ? x * x + y * y <= table.r * table.r
    : Math.abs(x) <= table.w / 2 && Math.abs(y) <= table.h / 2;
}

// Distance from (x, y) along unit (dx, dy) to the table boundary.
// Bots use this to judge kill lines and self-preservation.
export function rayToEdge(table, x, y, dx, dy) {
  if (table.shape === "round") {
    // Solve |p + t d| = r for t >= 0
    const b = x * dx + y * dy;
    const c = x * x + y * y - table.r * table.r;
    const disc = b * b - c;
    if (disc < 0) return 0;
    const t = -b + Math.sqrt(disc);
    return Math.max(0, t);
  }
  let best = Infinity;
  const hx = table.w / 2, hy = table.h / 2;
  if (dx > 1e-6) best = Math.min(best, (hx - x) / dx);
  if (dx < -1e-6) best = Math.min(best, (-hx - x) / dx);
  if (dy > 1e-6) best = Math.min(best, (hy - y) / dy);
  if (dy < -1e-6) best = Math.min(best, (-hy - y) / dy);
  return Math.max(0, best === Infinity ? 0 : best);
}

// Signed distance from a point to the boundary (positive = inside).
// Used by teeter drama and storm logic.
export function edgeClearance(table, x, y) {
  if (table.shape === "round") return table.r - Math.hypot(x, y);
  return Math.min(
    table.w / 2 - Math.abs(x),
    table.h / 2 - Math.abs(y)
  );
}

// Compass Box holes: 4 inkwells pulled in from the corners.
export function holesFor(table) {
  const half = tableHalf(table);
  const inset = 0.85;
  const r = 0.52;
  const hx = half.x - inset, hy = half.y - inset * 1.35;
  return [
    { x: -hx, y: -hy, r }, { x: hx, y: -hy, r },
    { x: -hx, y: hy, r }, { x: hx, y: hy, r }
  ];
}

// Placement: each player may set their pen anywhere inside a disc around
// their default spot, as long as it stays on the desk and out of holes.
export const PLACE_RADIUS = 1.5;

export function placementZone(spot) {
  return { cx: spot.x, cy: spot.y, r: PLACE_RADIUS };
}

export function inPlacementZone(zone, table, holes, x, y) {
  if (Math.hypot(x - zone.cx, y - zone.cy) > zone.r) return false;
  if (!tableContains(table, x, y)) return false;
  if (edgeClearance(table, x, y) < 0.18) return false;
  if (inHole(holes, x, y)) return false;
  return true;
}

// Clamp a dragged point into the zone (and gently off the edge/holes).
export function clampToZone(zone, table, holes, x, y) {
  const dx = x - zone.cx, dy = y - zone.cy;
  const d = Math.hypot(dx, dy);
  if (d > zone.r) { x = zone.cx + (dx / d) * zone.r; y = zone.cy + (dy / d) * zone.r; }
  // push inside the desk edge
  const half = tableHalf(table);
  if (table.shape === "round") {
    const rr = Math.hypot(x, y);
    const maxR = table.r - 0.2;
    if (rr > maxR) { x = (x / rr) * maxR; y = (y / rr) * maxR; }
  } else {
    x = Math.max(-half.x + 0.2, Math.min(half.x - 0.2, x));
    y = Math.max(-half.y + 0.2, Math.min(half.y - 0.2, y));
  }
  // nudge out of holes
  const h = inHole(holes, x, y);
  if (h) {
    const hx = x - h.x, hy = y - h.y;
    const hd = Math.hypot(hx, hy) || 0.001;
    x = h.x + (hx / hd) * (h.r + 0.1);
    y = h.y + (hy / hd) * (h.r + 0.1);
  }
  return { x, y };
}

export function inHole(holes, x, y) {
  for (const h of holes) {
    const dx = x - h.x, dy = y - h.y;
    if (dx * dx + dy * dy <= h.r * h.r) return h;
  }
  return null;
}

// Desk clutter per table: static obstacles (props) and friction zones.
// Deterministic given the rand source, so the host can generate and share.
const PROP_SHAPES = {
  eraser: { shape: "box", w: 0.72, h: 0.36, friction: 0.9, restitution: 0.06 },
  geometry: { shape: "box", w: 1.15, h: 0.78, friction: 0.25, restitution: 0.75 },
  book: { shape: "box", w: 1.7, h: 1.15, friction: 0.5, restitution: 0.22 },
  sharpener: { shape: "circle", r: 0.2, friction: 0.4, restitution: 0.45 }
};

const TABLE_CLUTTER = {
  classroom: { props: [["eraser", 0.4]], zones: [["ink", 0.3]] },
  examhall: { props: [["geometry", 0.85], ["eraser", 0.45]], zones: [["ink", 0.25]] },
  canteen: { props: [["sharpener", 0.5]], zones: [["sticky", 0.5]] },
  lastbench: { props: [["book", 0.8], ["sharpener", 0.5]], zones: [] },
  teachersdesk: { props: [], zones: [["ink", 0.25]] }
};

const ZONE_SHAPES = {
  ink: { r: 0.75, frictionMult: 0.28 },
  sticky: { r: 0.65, frictionMult: 3.2 }
};

export function genProps(table, rand = Math.random) {
  const clutter = TABLE_CLUTTER[table.id] || { props: [], zones: [] };
  const half = tableHalf(table);
  const props = [], zones = [];
  const taken = [];
  const place = radius => {
    for (let tries = 0; tries < 14; tries++) {
      const x = (rand() - 0.5) * half.x * 0.9;
      const y = (rand() - 0.5) * half.y * 0.75;
      if (Math.hypot(x, y) > Math.min(half.x, half.y) * 0.72) continue;   // keep off the pen ring
      if (taken.every(t => Math.hypot(x - t.x, y - t.y) > t.r + radius + 0.3)) {
        taken.push({ x, y, r: radius });
        return { x, y };
      }
    }
    return null;
  };
  for (const [kind, chance] of clutter.props) {
    if (rand() > chance) continue;
    const shape = PROP_SHAPES[kind];
    const spot = place(Math.max(shape.w || 0, shape.h || 0, (shape.r || 0) * 2) / 2);
    if (spot) props.push({ kind, ...shape, ...spot, angle: (rand() - 0.5) * 1.2 });
  }
  for (const [kind, chance] of clutter.zones) {
    if (rand() > chance) continue;
    const shape = ZONE_SHAPES[kind];
    const spot = place(shape.r);
    if (spot) zones.push({ kind, ...shape, ...spot });
  }
  return { props, zones };
}
