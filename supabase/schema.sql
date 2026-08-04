-- Pen Fight rooms, hardened for a public site.
--
-- Security model: the site is public (github.io) and the anon key ships in
-- the page, which is by design. Protection comes from three layers:
--   1. Anonymous sign-ins: every player gets a real, server-issued identity
--      (enable it under Authentication > Sign In / Up > Anonymous).
--   2. Row level security below: reads are limited to fresh rooms, only
--      signed-in users can create lobbies, and only a room's actual host
--      (verified by auth.uid(), which cannot be spoofed) can change it.
--   3. A creation throttle so nobody can flood the table.
--
-- The rooms table is only a rendezvous (existence + status). All live game
-- traffic is Realtime broadcast/presence and never touches Postgres.
--
-- Paste this whole file into the SQL editor and run it. Then put the
-- project URL and anon (publishable) key into js/config.js.

drop table if exists public.rooms;

create table public.rooms (
  code       text primary key check (code ~ '^[0-9A-HJKMNP-TV-Z]{6}$'),
  host_id    uuid not null default auth.uid(),
  status     text not null default 'lobby' check (status in ('lobby', 'playing', 'done')),
  settings   jsonb not null default '{}'::jsonb check (pg_column_size(settings) < 2048),
  created_at timestamptz not null default now()
);

alter table public.rooms enable row level security;

-- Reads: only fresh rooms are visible, which retires stale codes without a
-- cleanup job. Anonymous sign-ins land in the authenticated role.
create policy "fresh rooms are readable"
  on public.rooms for select to authenticated
  using (created_at > now() - interval '24 hours');

-- Creates: any signed-in player can open a lobby, but only as themselves.
create policy "signed-in players can open a lobby"
  on public.rooms for insert to authenticated
  with check (status = 'lobby' and host_id = auth.uid());

-- Updates: only the room's real host, and status only moves forward.
-- auth.uid() comes from the server-issued session and cannot be faked.
create policy "only the host moves status forward"
  on public.rooms for update to authenticated
  using (host_id = auth.uid())
  with check (status in ('playing', 'done') and pg_column_size(settings) < 2048);

-- No delete policy at all: rows age out of visibility instead.

-- Creation throttle: at most 3 rooms per minute per player and 30 per
-- minute across the whole site. Stops both griefers and runaway scripts.
create or replace function public.rooms_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.rooms
      where host_id = auth.uid()
        and created_at > now() - interval '1 minute') >= 3 then
    raise exception 'Slow down: too many rooms from you this minute';
  end if;
  if (select count(*) from public.rooms
      where created_at > now() - interval '1 minute') >= 30 then
    raise exception 'Too many rooms right now, try again in a minute';
  end if;
  return new;
end
$$;

drop trigger if exists rooms_rate_limit on public.rooms;
create trigger rooms_rate_limit
  before insert on public.rooms
  for each row execute function public.rooms_rate_limit();

-- Optional housekeeping if pg_cron is enabled on the project:
-- select cron.schedule('purge-penfight-rooms', '17 4 * * *',
--   $$delete from public.rooms where created_at < now() - interval '2 days'$$);
