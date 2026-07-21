-- Prompt Workbench — app_meta: a tiny server-side key/value table.
--
-- Its first job is the SEED MARKER. On a fresh database the app seeds the sample
-- library; the naive "reseed when the tables are empty" rule would resurrect the
-- samples the moment the user deletes their last prompt. Instead, seeding writes
-- a durable `seeded` row here (server-side, so it survives across devices — a
-- localStorage flag would not), and the app reseeds only when that marker is
-- absent. Deleting everything is then permanent, while an interrupted first seed
-- (marker never written) still self-heals on the next load.
--
-- RLS mirrors the other tables. This migration keeps the `to anon` grant to stay
-- consistent with 0001; 0003_auth.sql flips all four tables to `authenticated`
-- together once the login gate ships.

create table if not exists public.app_meta (
  key    text  primary key,
  value  jsonb not null default '{}'::jsonb
);

alter table public.app_meta enable row level security;

drop policy if exists "single-user full access" on public.app_meta;
create policy "single-user full access" on public.app_meta
  for all to anon using (true) with check (true);
