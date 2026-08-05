// Service worker. Versioned core cache, network-first for the shell so
// updates land after one reload, cache fallback for offline practice.

const CORE = "penfight-core-v11";

const SHELL = [
  ".",
  "index.html",
  "css/style.css",
  "js/main.js",
  "js/pens.js",
  "js/physics.js",
  "js/flick.js",
  "js/game.js",
  "js/bots.js",
  "js/render.js",
  "js/screens.js",
  "js/sfx.js",
  "js/fx.js",
  "js/commentary.js",
  "js/modes.js",
  "js/tables.js",
  "js/levels.js",
  "js/daily.js",
  "js/progress.js",
  "js/series.js",
  "js/icons.js",
  "js/code.js",
  "js/config.js",
  "js/net.js",
  "js/protocol.js",
  "js/room.js",
  "js/voice.js",
  "vendor/planck.mjs",
  "vendor/supabase.mjs",
  "manifest.webmanifest",
  "assets/icon.svg",
  "assets/icon-192.png",
  "assets/icon-512.png",
  "assets/icon-maskable-512.png"
];

// Voice pack. Cached best-effort and separately from the shell: a missing
// clip should cost you a meme line, not the whole install.
const VOICE = [
  "ko-1.mp3", "ko-2.mp3", "ko-3.mp3", "ko-4.mp3", "ko-5.mp3",
  "selfko-1.mp3", "selfko-2.mp3",
  "win-1.mp3", "win-2.mp3", "win-3.mp3", "win-4.mp3", "win-5.mp3", "win-6.mp3",
  "kangal-1.mp3", "out-1.mp3", "out-2.mp3"
].map(f => "assets/voice/" + f);

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CORE)
      .then(c => c.addAll(SHELL).then(() =>
        Promise.all(VOICE.map(v => c.add(v).catch(() => {})))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CORE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // fonts, supabase: straight to network

  e.respondWith(
    // no-cache: revalidate against the server so a deploy never mixes old
    // and new modules (ETags make this cheap).
    fetch(req, { cache: "no-cache" })
      .then(res => {
        const copy = res.clone();
        caches.open(CORE).then(c => c.put(req, copy));
        return res;
      })
      .catch(() =>
        caches.match(req, { ignoreSearch: true })
          .then(hit => hit || caches.match("index.html"))
      )
  );
});
