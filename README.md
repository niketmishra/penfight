# Pen Fight

The classic Indian school bench game, on your phone. Everyone puts a pen on the desk, you take turns flicking your own pen into the others, and the last pen still on the table wins.

**Play it: https://niketmishra.github.io/penfight/**

## What's in the game

- **The flick**: swipe speed is force, swipe direction is aim, and where your swipe crosses the pen decides the spin. Flick through the tip and it whirls, and spinning pens genuinely curve (Magnus force). A resting palm is ignored.
- **Eight pens** inspired by the icons of every Indian pencil box, each with real weight, glide, spin and size differences plus a signature quirk: TriMaxx (Haathi) cannot be flipped airborne, Copilot V6 (Googly) curves double, Butterglide (Makkhan) ignores ink slicks, Sparker Victor (Loha) launches victims sky high.
- **Chadhai**: hard tip hits launch pens airborne over everything. Land on someone's pen and they miss a turn. School rules.
- **Living desks**: classroom, exam hall, round canteen steel, the last bench, teacher's glass desk. Erasers, geometry boxes and book stacks to bank shots off; ink slicks and fevicol patches that change the physics.
- **The chalk line**: drag a match out and a shrinking chalk boundary starts confiscating pens outside it.
- **Modes**: Classic free-for-all, Team Match (2v2 / 3v3, friendly fire on), Compass Box (four inkwell holes), Pass and Play (one phone, 2 to 6 players), online rooms with 6 letter invite codes for 2 to 6 friends.
- **Trick Shot Academy**: 24 star-rated levels that teach every trick in the game.
- **Daily Bawaal**: everyone gets the same seeded desk, pen and bots each day. Score it, share the brag card.
- **Progression**: XP levels unlock pens, desks, modes and barrel stickers. Hinglish commentary ("SEEDHA NEECHE!"), kill cam slow-mo, school bell, classroom ambience. All local, no accounts, no ads.

Plain static PWA. No build step, no framework. Canvas 2D + [Planck.js](https://piqnt.com/planck.js) physics, Supabase Realtime for rooms.

## Run locally

```
python3 -m http.server 8161
```

Open http://localhost:8161. Everything except online rooms works immediately, fully offline.

## Enable online rooms

1. Create a free project at [supabase.com](https://supabase.com)
2. Open the SQL editor, paste all of `supabase/schema.sql`, run it
3. Project Settings > API: copy the URL and the anon public key into `js/config.js`

The anon key is meant to be public; row level security in the schema is the protection. Rooms are just a rendezvous row, all live play is Realtime broadcast, so the free tier is plenty.

## Deploy

GitHub Pages from `main`, root. All paths are relative. After changing any shipped file, bump `CORE` in `sw.js` so installed players pick up the update.

## Project layout

- `js/physics.js` table world, capsule pens, dry friction, Magnus curve, airborne and mounts
- `js/flick.js` the finger flick: palm rejection, swipe fit, contact point spin
- `js/pens.js` the pen roster, stats and quirks; tune everything here
- `js/tables.js` desk configs, furniture, zones, holes
- `js/modes.js` mode configs and the single win-condition rule
- `js/game.js` match controller and turn machine shared by every mode
- `js/room.js` online session: lobby, host migration, striker authoritative physics
- `js/levels.js` the 24 academy levels
- `js/daily.js` seeded daily challenge and share text
- `js/progress.js` XP, unlocks, stats, stickers, save blob
- `js/render.js` camera, kill cam, desk themes, particles, teeter drama
- `js/commentary.js` the Hinglish commentator
- `supabase/schema.sql` rooms table + RLS
