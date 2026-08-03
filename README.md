# Pen Fight

The classic Indian school bench game, on your phone. Everyone puts a pen on the desk, you take turns flicking your own pen into the others, and the last pen still on the table wins.

- Practice against bots, fully offline
- Or create a room, share the 6 letter code, and play with 2 to 6 friends live
- Eight pens inspired by the icons of every Indian pencil box, each with its own weight, glide, and spin
- Flick with your finger: swipe speed sets the force, swipe direction sets the aim, and where your swipe crosses the pen decides the spin. Flick through the tip and it whirls, flick through the middle and it flies straight.

Plain static PWA. No build step, no framework. Canvas 2D + [Planck.js](https://piqnt.com/planck.js) physics, Supabase Realtime for rooms.

## Run locally

```
python3 -m http.server 8161
```

Open http://localhost:8161. Practice mode works immediately. To try it on your phone, use your Mac's LAN IP on the same Wi-Fi.

## Enable online rooms

1. Create a free project at [supabase.com](https://supabase.com)
2. Open the SQL editor, paste all of `supabase/schema.sql`, run it
3. Project Settings > API: copy the URL and the anon public key into `js/config.js`

The anon key is meant to be public; row level security in the schema is the protection. Rooms are just a rendezvous row, all live play is Realtime broadcast, so the free tier is plenty.

## Deploy (GitHub Pages)

1. Push this repo to GitHub
2. Repo Settings > Pages > deploy from branch, `main`, root
3. Done. All paths are relative so it works under `/penfight/`

After changing any shipped file, bump `CORE` in `sw.js` (v1 -> v2) so installed players pick up the update.

## Project layout

- `js/physics.js` table world, pen bodies, friction, settle and fall detection
- `js/flick.js` the finger flick: palm rejection, swipe fit, contact point spin
- `js/pens.js` the pen roster and stats, tune everything here
- `js/game.js` turn machine shared by practice and online
- `js/bots.js` practice opponents
- `js/room.js` online session: lobby, host migration, striker authoritative physics
- `js/render.js` desk, vector pens, fall animations, screen shake
- `supabase/schema.sql` rooms table + RLS
