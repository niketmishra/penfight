// Hand-drawn SVG icon set. Every icon is a function of size so screens can
// scale them, all stroke-based on currentColor so CSS colors them. No emoji
// anywhere in the game: these are the game's real icons.

const svg = (body, vb = "0 0 24 24") =>
  `<svg viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  // Crossed pens, the game mark
  logo: svg(`
    <path d="M4 20 L15 5 l3 -1.6 1.6 1.6 L18 8 7 21 4.4 21.6 Z" fill="currentColor" stroke="none" opacity="0.9"/>
    <path d="M20 20 L9 5 6 3.4 4.4 5 6 8 17 21 19.6 21.6 Z" fill="currentColor" stroke="none" opacity="0.55"/>
  `),
  swords: svg(`
    <path d="M4 4 L13 13 M4 4 l0.5 3.5 L8 8 Z"/>
    <path d="M20 4 L11 13 M20 4 l-0.5 3.5 L16 8 Z"/>
    <path d="M9 15 l-3.5 3.5 M6.5 14 L10 17.5 M15 15 l3.5 3.5 M17.5 14 L14 17.5"/>
  `),
  bench: svg(`
    <path d="M3 10 h18 M5 10 v7 M19 10 v7 M8 10 V7 h8 v3"/>
    <path d="M8 4.5 a1.6 1.6 0 1 0 0.01 0 M16 4.5 a1.6 1.6 0 1 0 0.01 0"/>
  `),
  inkwell: svg(`
    <path d="M6 9 h12 l-1.5 11 h-9 Z"/>
    <path d="M9 9 V6 a3 3 0 0 1 6 0 v3"/>
    <ellipse cx="12" cy="14.5" rx="3.2" ry="2" fill="currentColor" stroke="none" opacity="0.7"/>
  `),
  target: svg(`
    <circle cx="12" cy="12" r="8.5"/>
    <circle cx="12" cy="12" r="5"/>
    <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/>
  `),
  calendar: svg(`
    <rect x="4" y="5.5" width="16" height="14.5" rx="2.5"/>
    <path d="M4 10 h16 M8 3.5 v4 M16 3.5 v4"/>
    <path d="M12 12.5 v4 M10.3 13.6 c0-.9 3.4-.9 3.4 0 0 .8-3.4.7-3.4 1.6 0 .9 3.4.9 3.4 0" stroke-width="1.4"/>
  `),
  rupee: svg(`
    <circle cx="12" cy="12" r="9" opacity="0.6"/>
    <path d="M8.5 7 h7 M8.5 10.2 h7 M9.5 7 c4.5 0 4.5 6 0 6 l5 4.8" stroke-width="1.9"/>
  `),
  trophy: svg(`
    <path d="M8 4 h8 v5 a4 4 0 0 1 -8 0 Z"/>
    <path d="M8 5.5 H5 a3 3 0 0 0 3 4 M16 5.5 h3 a3 3 0 0 1 -3 4"/>
    <path d="M12 13 v3 M9 19.5 h6 M10 16.5 h4 v3 h-4 Z"/>
  `),
  skull: svg(`
    <path d="M12 3.5 a7 7 0 0 1 7 7 c0 2.6-1.4 4.2-3 5.2 V19 a1.5 1.5 0 0 1 -1.5 1.5 h-5 A1.5 1.5 0 0 1 8 19 v-3.3 c-1.6-1-3-2.6-3-5.2 a7 7 0 0 1 7-7 Z"/>
    <circle cx="9.3" cy="11" r="1.6" fill="currentColor" stroke="none"/>
    <circle cx="14.7" cy="11" r="1.6" fill="currentColor" stroke="none"/>
    <path d="M11 15.2 l1 -1.4 1 1.4"/>
  `),
  gear: svg(`
    <circle cx="12" cy="12" r="3.2"/>
    <path d="M12 2.8 v3 M12 18.2 v3 M2.8 12 h3 M18.2 12 h3 M5.5 5.5 l2.1 2.1 M16.4 16.4 l2.1 2.1 M18.5 5.5 l-2.1 2.1 M7.6 16.4 l-2.1 2.1"/>
  `),
  lock: svg(`
    <rect x="6" y="10.5" width="12" height="9" rx="2"/>
    <path d="M8.5 10.5 V8 a3.5 3.5 0 0 1 7 0 v2.5"/>
    <circle cx="12" cy="15" r="1.3" fill="currentColor" stroke="none"/>
  `),
  back: svg(`<path d="M14.5 5 L7.5 12 l7 7"/>`),
  share: svg(`
    <circle cx="6.5" cy="12" r="2.6"/><circle cx="17.5" cy="6" r="2.6"/><circle cx="17.5" cy="18" r="2.6"/>
    <path d="M8.8 10.8 L15.2 7.2 M8.8 13.2 l6.4 3.6"/>
  `),
  phone: svg(`
    <rect x="7" y="3" width="10" height="18" rx="2.5"/>
    <path d="M10.5 18.5 h3"/>
  `),
  bot: svg(`
    <rect x="5.5" y="8" width="13" height="10" rx="3"/>
    <path d="M12 8 V4.8 M12 4.8 a1.4 1.4 0 1 0 -.01 0"/>
    <circle cx="9.3" cy="12.5" r="1.4" fill="currentColor" stroke="none"/>
    <circle cx="14.7" cy="12.5" r="1.4" fill="currentColor" stroke="none"/>
    <path d="M9.5 15.6 h5"/>
  `),
  wifi: svg(`
    <path d="M4 9.5 a11.5 11.5 0 0 1 16 0 M7 13 a7.5 7.5 0 0 1 10 0 M10 16.3 a3.5 3.5 0 0 1 4 0"/>
    <circle cx="12" cy="19" r="1.3" fill="currentColor" stroke="none"/>
  `),
  play: svg(`<path d="M8 5.5 L18 12 8 18.5 Z" fill="currentColor" stroke="none"/>`),
  star: svg(`<path d="M12 3.6 l2.5 5.2 5.7 0.8 -4.1 4 1 5.7 -5.1 -2.7 -5.1 2.7 1 -5.7 -4.1 -4 5.7 -0.8 Z" fill="currentColor" stroke="none"/>`),
  starEmpty: svg(`<path d="M12 3.6 l2.5 5.2 5.7 0.8 -4.1 4 1 5.7 -5.1 -2.7 -5.1 2.7 1 -5.7 -4.1 -4 5.7 -0.8 Z"/>`),
  flame: svg(`
    <path d="M12 3.5 c1 3 4.5 4.5 4.5 9 a4.5 4.5 0 0 1 -9 0 c0 -2 1 -3.5 1.8 -4.8 .5 1 1.4 1.6 1.4 1.6 C10.5 7 11.5 5.5 12 3.5 Z" fill="currentColor" stroke="none" opacity="0.85"/>
  `),
  crown: svg(`
    <path d="M4.5 17 L4 8.5 8 12 12 6 16 12 20 8.5 19.5 17 Z" fill="currentColor" stroke="none" opacity="0.9"/>
    <path d="M4.5 19.2 h15"/>
  `),
  check: svg(`
    <path d="M4.5 12.5 L10 18 19.5 6.5" stroke-width="2.4"/>
  `),
  // Reaction bar: laugh, shock, clap join flame. Faces are stroke circles so
  // they inherit the button color like every other icon.
  laugh: svg(`
    <circle cx="12" cy="12" r="8.5"/>
    <path d="M8 10 l2 1.2 M16 10 l-2 1.2"/>
    <path d="M7.5 13.5 a4.8 4.8 0 0 0 9 0 Z" fill="currentColor" stroke="none" opacity="0.85"/>
  `),
  shock: svg(`
    <circle cx="12" cy="12" r="8.5"/>
    <circle cx="9" cy="9.6" r="1" fill="currentColor" stroke="none"/>
    <circle cx="15" cy="9.6" r="1" fill="currentColor" stroke="none"/>
    <ellipse cx="12" cy="15" rx="2" ry="2.8"/>
  `),
  clap: svg(`
    <path d="M7 11 l4.5 -4.5 M9.5 13 L15 7.5 M12 15 l4.5 -4.5" stroke-width="2"/>
    <path d="M6 14 a6.5 6.5 0 0 0 10.5 5.5 L20 16"/>
    <path d="M3.5 7.5 l1.8 1 M5.5 4.5 l1.2 1.6 M9 3 l0.4 2"/>
  `)
};

export function icon(name, cls = "") {
  return `<span class="icn ${cls}">${ICONS[name] || ""}</span>`;
}
