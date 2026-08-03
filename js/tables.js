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
    frictionMult: 0.62,   // steel top, everything glides
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
    frictionMult: 0.45,   // glass top, terrifying
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

export function inHole(holes, x, y) {
  for (const h of holes) {
    const dx = x - h.x, dy = y - h.y;
    if (dx * dx + dy * dy <= h.r * h.r) return h;
  }
  return null;
}
