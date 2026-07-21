-- Prompt Workbench — initial schema.
--
-- Model (see README "Core model"): a prompt is a continuous document with named
-- regions painted over spans of it. Regions are a value object of the document
-- (their from/to are offsets into THIS body), so they live inline as JSONB on
-- the row rather than in a side table — a body and its region offsets are always
-- written together and can never be torn apart.
--
-- Tables map 1:1 to the app's domain objects:
--   prompts          — working copies the editor reads/writes
--   prompt_versions  — immutable whole-prompt snapshots (read-only history)
--   snippets         — library snippets, versioned independently
-- Region shape (JSONB array element): { id, name, flag, note, from, to }.

-- ---------------------------------------------------------------------------
-- prompts — the mutable working copy of each prompt.
-- ---------------------------------------------------------------------------
create table if not exists public.prompts (
  id               text primary key,
  name             text        not null,
  body             text        not null default '',
  regions          jsonb       not null default '[]'::jsonb,
  tokens           integer     not null default 0,
  current_version  integer     not null default 1,
  sort_order       integer     not null default 0,
  updated_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- prompt_versions — immutable snapshots of a whole prompt. Never updated in
-- place; a "save version" writes a new row. Body + regions are frozen copies.
-- ---------------------------------------------------------------------------
create table if not exists public.prompt_versions (
  id         text primary key,
  prompt_id  text        not null references public.prompts (id) on delete cascade,
  n          integer     not null,
  message    text        not null default '',
  body       text        not null default '',
  regions    jsonb       not null default '[]'::jsonb,
  tokens     integer     not null default 0,
  saved_at   date        not null default current_date,
  unique (prompt_id, n)
);

create index if not exists prompt_versions_prompt_id_idx
  on public.prompt_versions (prompt_id);

-- ---------------------------------------------------------------------------
-- snippets — reusable library fragments, versioned independently of prompts.
-- used_by / stale are display counters; when Phase 4 (copy-on-insert usage
-- links) lands they get derived from a snippet_usage table and dropped here.
-- ---------------------------------------------------------------------------
create table if not exists public.snippets (
  id          text primary key,
  name        text        not null,
  body        text        not null default '',
  regions     jsonb       not null default '[]'::jsonb,
  tokens      integer     not null default 0,
  version     integer     not null default 1,
  used_by     integer     not null default 0,
  stale       integer     not null default 0,
  sort_order  integer     not null default 0,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row Level Security.
--
-- This is a SINGLE-USER tool (see README "Users"): auth exists only to keep the
-- data private, not to coordinate between people. There is no login UI yet, so
-- the client talks to Postgres with the publishable anon key and the policies
-- below grant that anon role full access. The anon key + project URL are the
-- only gate; keep them in an untracked .env.local, never in the repo.
--
-- To make the data properly private later: add Supabase Auth, change every
-- `to anon` below to `to authenticated`, and add a `user_id = auth.uid()`
-- predicate (plus a user_id column). RLS stays ON throughout.
-- ---------------------------------------------------------------------------
alter table public.prompts          enable row level security;
alter table public.prompt_versions  enable row level security;
alter table public.snippets         enable row level security;

drop policy if exists "single-user full access" on public.prompts;
create policy "single-user full access" on public.prompts
  for all to anon using (true) with check (true);

drop policy if exists "single-user full access" on public.prompt_versions;
create policy "single-user full access" on public.prompt_versions
  for all to anon using (true) with check (true);

drop policy if exists "single-user full access" on public.snippets;
create policy "single-user full access" on public.snippets
  for all to anon using (true) with check (true);
