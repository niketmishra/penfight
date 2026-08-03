-- Pen Fight rooms. Paste this whole file into the Supabase SQL editor,
-- then copy the project URL and anon key into js/config.js.
--
-- The rooms table is only a rendezvous: room existence, status, settings.
-- All live game state travels over Realtime broadcast and presence, so
-- nothing per-turn ever touches Postgres.

drop table if exists public.rooms;

create table public.rooms (
  code       text primary key check (code ~ '^[0-9A-HJKMNP-TV-Z]{6}$'),
  host_id    uuid not null,
  status     text not null default 'lobby' check (status in ('lobby', 'playing', 'done')),
  settings   jsonb not null default '{}'::jsonb check (pg_column_size(settings) < 2048),
  created_at timestamptz not null default now()
);

alter table public.rooms enable row level security;

-- Anyone can look up a room by code. Rooms older than a day are invisible,
-- which retires stale codes without needing a cleanup job.
create policy "rooms are readable while fresh" on public.rooms
  for select to anon
  using (created_at > now() - interval '24 hours');

-- Anyone can open a lobby. The checks above are the validation.
create policy "anyone can create a lobby" on public.rooms
  for insert to anon
  with check (status = 'lobby');

-- Status only moves forward, and nobody can delete through the API.
create policy "status moves forward only" on public.rooms
  for update to anon
  using (true)
  with check (status in ('playing', 'done') and pg_column_size(settings) < 2048);

-- Optional housekeeping if pg_cron is enabled on the project:
-- select cron.schedule('purge-old-penfight-rooms', '17 4 * * *',
--   $$delete from public.rooms where created_at < now() - interval '2 days'$$);
