-- Prompt Workbench — library folders.
--
-- Per-section folder trees for the sidebar: a folder belongs to exactly one
-- section ('prompt' or 'snippet') and holds docs of that kind plus subfolders.
-- Arbitrary nesting via the self-referential parent_id.
--
-- DELETE SEMANTICS: the CLIENT is authoritative — deleting a folder moves its
-- children (subfolders and docs) up to the deleted folder's parent, then
-- deletes the row (see deleteFolder in src/lib/library.ts). The FK actions
-- below are only a safety net for out-of-band deletes (SQL console): `set
-- null` promotes survivors to the section root rather than destroying them,
-- because deleting an organizational container must never delete documents.

create table if not exists public.folders (
  id          text primary key,
  name        text        not null,
  section     text        not null check (section in ('prompt', 'snippet')),
  parent_id   text        references public.folders (id) on delete set null,
  sort_order  integer     not null default 0,
  updated_at  timestamptz not null default now()
);

create index if not exists folders_parent_id_idx
  on public.folders (parent_id);

-- Docs point at their containing folder; null = section root.
alter table public.prompts
  add column if not exists folder_id text
    references public.folders (id) on delete set null;

alter table public.snippets
  add column if not exists folder_id text
    references public.folders (id) on delete set null;

create index if not exists prompts_folder_id_idx  on public.prompts  (folder_id);
create index if not exists snippets_folder_id_idx on public.snippets (folder_id);

-- RLS: same single-user posture as 0003_auth.sql.
alter table public.folders enable row level security;

drop policy if exists "single-user full access" on public.folders;
create policy "single-user full access" on public.folders
  for all to authenticated using (true) with check (true);
