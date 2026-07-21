-- Prompt Workbench — snippet library flag (regions↔snippets unification).
--
-- The model changes (see README "Core model"): marking a region in a prompt now
-- CREATES or links a snippet, so a region is an occurrence/reference of a snippet
-- (the region carries snippetId + syncedVersion inside the existing `regions`
-- JSONB — no DDL needed for the link itself). This flag distinguishes snippets
-- surfaced in the sidebar's library list (authored via "New snippet", or
-- promoted) from one-off snippets auto-created by marking, which surface only
-- once referenced by 2+ regions.
--
-- used_by / stale are now DERIVED in the client from region references and are no
-- longer authoritative. The columns are retained (still supplied by inserts) but
-- the store overwrites their loaded values after hydrate.

alter table public.snippets
  add column if not exists library boolean not null default true;
