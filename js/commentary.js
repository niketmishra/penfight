// The classroom commentator. Event-driven one-liners, Hinglish by default
// with an English fallback, never the same line twice in a row.

const LINES = {
  hi: {
    start: ["Chalo shuru karte hain!", "Pen nikalo, fight shuru!", "Bell baj gayi, match on!"],
    kill: ["SEEDHA NEECHE!", "Chhutti ho gayi {name} ki!", "Kya nishana!", "{name} ka pen gaya kaam se!", "Ek jhatke mein saaf!"],
    selfKill: ["Apne hi pen se?!", "Arre yeh khud hi gir gaya!", "{name} ne khud ko hi uda diya!", "Overconfidence, classic."],
    holeKill: ["Inkwell mein tapak gaya!", "Seedha khadde mein!", "{name} ka pen davaat mein doob gaya!"],
    multiKill: ["DOUBLE DHAMAKA!", "Ek teer, do shikaar!", "Poora bench saaf!"],
    teeter: ["Bach gaya... bas bas bas!", "Kinare pe atka hai!", "Saans rok lo, gir sakta hai!"],
    mount: ["CHADHAI! Upar chadh gaya!", "Pen pe pen! Classic chadhai!", "{name} ke pen pe kabza!"],
    skip: ["{name} ki turn gayi, pen dabba hua hai!", "Chadhai ka asar, {name} baithe rahenge!"],
    bigHit: ["KYA MAARA!", "Uff, poori taakat se!", "Awaaz school bhar mein gayi!"],
    storm: ["Madam aa rahi hain, andar aa jao!", "Chalk line chhoti ho rahi hai!", "Line ke bahar mat raho!"],
    stormKill: ["Madam ne dekh liya! {name} bahar!", "Line ke bahar, seedha confiscate!"],
    win: ["LAST PEN STANDING!", "Poore desk pe raaj!", "Champion ka pen, baaki sab dabbe mein!"],
    curve: ["Googly! Kya ghoomaya!", "Spin dekho, spin!", "Yeh toh bend ho gaya!"],
    nearWin: ["Bas ek aur bacha hai!", "Final showdown!"]
  },
  en: {
    start: ["Pens out, let's go!", "The bell rang. Fight!"],
    kill: ["STRAIGHT DOWN!", "{name} is out!", "What a shot!", "Clean knockout!"],
    selfKill: ["Off their own flick?!", "Overcooked it, classic."],
    holeKill: ["Sunk in the inkwell!", "Straight into the pit!"],
    multiKill: ["DOUBLE TROUBLE!", "Two in one shot!"],
    teeter: ["Hanging on by a millimetre!", "Hold your breath..."],
    mount: ["MOUNTED! Pen on pen!", "Pinned to the desk!"],
    skip: ["{name} is pinned, turn skipped!"],
    bigHit: ["WHAT A HIT!", "Heard that across the school!"],
    storm: ["The chalk line is shrinking!", "Get inside the line!"],
    stormKill: ["Caught outside the line! {name} is out!"],
    win: ["LAST PEN STANDING!", "The desk is yours!"],
    curve: ["Look at that bend!", "Spin doctor!"],
    nearWin: ["One more to go!", "Final showdown!"]
  }
};

let lang = "hi";
let lastLine = "";

export function setLanguage(l) { lang = l === "en" ? "en" : "hi"; }
export function language() { return lang; }

export function commentate(event, data = {}) {
  const pool = (LINES[lang] && LINES[lang][event]) || LINES.hi[event];
  if (!pool || !pool.length) return null;
  let line = pool[Math.floor(Math.random() * pool.length)];
  if (pool.length > 1 && line === lastLine) {
    line = pool[(pool.indexOf(line) + 1) % pool.length];
  }
  lastLine = line;
  return line.replace("{name}", data.name || "");
}
