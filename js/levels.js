// Trick Shot Academy. 24 hand-placed lessons in flicking, curving, banking
// and sinking. Coordinates are world units; classroom desk is 6 x 9 with
// x in [-3, 3], y in [-4.5, 4.5]. Player starts near the bottom.

// Level fields: name, hint, flickLimit, star2/star3 (flicks needed for 2/3
// stars), tableId, pen (forced pen id or null = player's own), player
// {x, y, angle}, targets [{penId, x, y, angle}], props, zones, holes.

const P = (x, y, angle = 0) => ({ x, y, angle });
const T = (penId, x, y, angle = 0) => ({ penId, x, y, angle });
const box = (x, y, angle = 0) => ({ kind: "geometry", shape: "box", w: 1.15, h: 0.78, x, y, angle, friction: 0.25, restitution: 0.75 });
const book = (x, y, angle = 0) => ({ kind: "book", shape: "box", w: 1.7, h: 1.15, x, y, angle, friction: 0.5, restitution: 0.22 });
const eraser = (x, y, angle = 0) => ({ kind: "eraser", shape: "box", w: 0.72, h: 0.36, x, y, angle, friction: 0.9, restitution: 0.06 });
const sharp = (x, y) => ({ kind: "sharpener", shape: "circle", r: 0.2, x, y, friction: 0.4, restitution: 0.45 });
const ink = (x, y, r = 0.8) => ({ kind: "ink", x, y, r, frictionMult: 0.28 });
const glue = (x, y, r = 0.65) => ({ kind: "sticky", x, y, r, frictionMult: 3.2 });
const hole = (x, y, r = 0.55) => ({ x, y, r });

export const LEVELS = [
  { id: 1, name: "Pehla Nishana", hint: "One pen, straight ahead. Push it off the top.",
    flickLimit: 2, star3: 1, star2: 2, player: P(0, 3.4, -Math.PI / 2),
    targets: [T("ronalds045", 0, -3.6, 0)] },
  { id: 2, name: "Do Ka Dum", hint: "Two corners, two shots. Line them up.",
    flickLimit: 4, star3: 2, star2: 3, player: P(0, 3.4, -Math.PI / 2),
    targets: [T("pentronic", -2.1, -3.4, 0.4), T("butterglide", 2.1, -3.4, -0.4)] },
  { id: 3, name: "Zor Se!", hint: "The Haathi will not move for a gentle tap.",
    flickLimit: 3, star3: 1, star2: 2, player: P(0, 3.4, -Math.PI / 2),
    targets: [T("trimaxx", 0, -1.2, 0)] },
  { id: 4, name: "Side Business", hint: "It is hugging the side. Angle the shot.",
    flickLimit: 2, star3: 1, star2: 2, player: P(0.8, 3.4, -Math.PI / 2),
    targets: [T("copilotv6", -2.55, 0, Math.PI / 2)] },
  { id: 5, name: "Bank Shot", hint: "The Camlin box is springy. Use the wall.",
    flickLimit: 3, star3: 1, star2: 2, player: P(-1.6, 3.4, -Math.PI / 2),
    targets: [T("ronalds045", 1.7, -3.3, 0.2)], props: [box(0.2, -0.9, 0.5)] },
  { id: 6, name: "Deewar", hint: "Maths 10 blocks the middle. Go around.",
    flickLimit: 4, star3: 2, star2: 3, player: P(0, 3.4, -Math.PI / 2),
    targets: [T("pentronic", -1.9, -3.3, 0), T("butterglide", 1.9, -3.3, 0)],
    props: [book(0, -0.6, 0.05)] },
  { id: 7, name: "Googly 101", hint: "Flick through the TIP. Spin bends the path.",
    flickLimit: 3, star3: 1, star2: 2, pen: "copilotv6", player: P(0, 3.4, -Math.PI / 2),
    targets: [T("ronalds045", 0, -3.4, 0)], props: [book(0, -0.4, 0)] },
  { id: 8, name: "Ink Slide", hint: "Ink kills friction. A soft flick goes far.",
    flickLimit: 2, star3: 1, star2: 2, player: P(0, 3.4, -Math.PI / 2),
    targets: [T("writeometer", 0, -3.6, 0.1)], zones: [ink(0, 0.4, 1.1)] },
  { id: 9, name: "Chipku Patch", hint: "Fevicol ka jod. Full power through the glue.",
    flickLimit: 3, star3: 1, star2: 2, player: P(0, 3.4, -Math.PI / 2),
    targets: [T("ronalds045", 0, -3.5, 0)], zones: [glue(0, -1.8, 0.85)] },
  { id: 10, name: "Teen Patti", hint: "Three in a row. Spend your flicks wisely.",
    flickLimit: 5, star3: 3, star2: 4, player: P(0, 3.4, -Math.PI / 2),
    targets: [T("pentronic", -2, -3.4, 0), T("ronalds045", 0, -3.6, 0), T("butterglide", 2, -3.4, 0)] },
  { id: 11, name: "Inkwell", hint: "Nudge it in. The well does the rest.",
    flickLimit: 2, star3: 1, star2: 2, player: P(0, 3.4, -Math.PI / 2),
    targets: [T("ronalds045", 0, -2.1, 0.2)], holes: [hole(0, -3.3, 0.6)] },
  { id: 12, name: "Carrom King", hint: "Two pens, two pockets. Channel your inner striker.",
    flickLimit: 4, star3: 2, star2: 3, player: P(0, 3.4, -Math.PI / 2),
    targets: [T("pentronic", -1.6, -2.3, 0.5), T("butterglide", 1.6, -2.3, -0.5)],
    holes: [hole(-2.3, -3.4, 0.55), hole(2.3, -3.4, 0.55)] },
  { id: 13, name: "Sandwich", hint: "Thread the gap between the books.",
    flickLimit: 3, star3: 1, star2: 2, player: P(0, 3.4, -Math.PI / 2),
    targets: [T("sparkervictor", 0, -3.4, 0)],
    props: [book(-1.45, -1, 0.12), book(1.45, -1, -0.12)] },
  { id: 14, name: "Long Drive", hint: "The last bench is long. Judge the distance.",
    flickLimit: 2, star3: 1, star2: 2, tableId: "lastbench", player: P(0, 4.6, -Math.PI / 2),
    targets: [T("notraj621", 0, -4.4, 0.1)] },
  { id: 15, name: "Canteen Special", hint: "Steel top. Everything slides too far.",
    flickLimit: 3, star3: 2, star2: 3, tableId: "canteen", player: P(0, 2.9, -Math.PI / 2),
    targets: [T("ronalds045", -1.6, -2.2, 0.3), T("pentronic", 1.6, -2.2, -0.3)] },
  { id: 16, name: "Sharp Shooter", hint: "Slalom through the sharpeners.",
    flickLimit: 3, star3: 1, star2: 2, player: P(0, 3.4, -Math.PI / 2),
    targets: [T("butterglide", 0, -3.5, 0)],
    props: [sharp(-0.5, 1), sharp(0.55, -0.2), sharp(-0.5, -1.6)] },
  { id: 17, name: "Double Googly", hint: "Two hidden pens. Two bending shots.",
    flickLimit: 4, star3: 2, star2: 3, pen: "copilotv6", player: P(0, 3.4, -Math.PI / 2),
    targets: [T("ronalds045", -1.4, -3.4, 0), T("pentronic", 1.4, -3.4, 0)],
    props: [book(0, -0.8, 0)] },
  { id: 18, name: "Haathi Ko Hilao", hint: "A featherweight vs the tank. Aim for the edge it is already near.",
    flickLimit: 3, star3: 1, star2: 2, pen: "pentronic", player: P(0, 3.4, -Math.PI / 2),
    targets: [T("trimaxx", 0.4, -3.9, 0.3)] },
  { id: 19, name: "Glass Table", hint: "Madam's desk. One touch and everything skates.",
    flickLimit: 2, star3: 1, star2: 2, tableId: "teachersdesk", player: P(0, 3.6, -Math.PI / 2),
    targets: [T("copilotv6", 0, 0, 0.4)] },
  { id: 20, name: "Chaar Kone", hint: "Four corners. Plan the route.",
    flickLimit: 6, star3: 4, star2: 5, player: P(0, 0, -Math.PI / 2),
    targets: [T("ronalds045", -2.2, -3.6, 0.3), T("pentronic", 2.2, -3.6, -0.3),
      T("butterglide", -2.2, 3.6, -0.3), T("writeometer", 2.2, 3.6, 0.3)] },
  { id: 21, name: "Bilkul Seedha", hint: "A dead straight channel. No margin.",
    flickLimit: 2, star3: 1, star2: 2, player: P(0, 3.6, -Math.PI / 2),
    targets: [T("ronalds045", 0, -3.7, 0)],
    props: [book(-1.28, 0, 0), book(1.28, 0, 0), eraser(-0.75, -2.2, 0.2), eraser(0.75, -2.2, -0.2)] },
  { id: 22, name: "Ricochet Raja", hint: "No direct line. The box wall is your friend.",
    flickLimit: 3, star3: 1, star2: 2, player: P(-2, 3.4, -Math.PI / 2),
    targets: [T("sparkervictor", -2, -3.4, 0)],
    props: [book(-1.2, 0, 0.06), book(-2.6, 0, 0.06), box(1.6, -0.4, -0.5)] },
  { id: 23, name: "Ink & Well", hint: "Ride the ink, skip the well, take the pen.",
    flickLimit: 3, star3: 1, star2: 2, player: P(0.5, 3.4, -Math.PI / 2),
    targets: [T("butterglide", 0.5, -3.6, 0)],
    zones: [ink(0.5, 0.6, 1)], holes: [hole(-0.9, -1.4, 0.55)] },
  { id: 24, name: "Full Toss Final", hint: "Everything you learned. Last bench final exam.",
    flickLimit: 7, star3: 4, star2: 5, player: P(0, 3.8, -Math.PI / 2),
    targets: [T("trimaxx", 0, -3.8, 0), T("copilotv6", -2.2, -1.5, 0.5), T("pentronic", 2.3, 0.6, -0.4)],
    props: [book(0, -0.9, 0.08), sharp(1.2, 1.8)],
    zones: [ink(-1.5, 1.4, 0.8)], holes: [hole(2.35, -3.45, 0.55)] }
];

export function levelById(id) {
  return LEVELS.find(l => l.id === id);
}

export function starsFor(level, flicksUsed) {
  if (flicksUsed <= level.star3) return 3;
  if (flicksUsed <= level.star2) return 2;
  return 1;
}

export function levelUnlocked(id, academyProgress) {
  return id === 1 || Boolean(academyProgress[id - 1]);
}
