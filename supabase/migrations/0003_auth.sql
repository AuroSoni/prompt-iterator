-- Prompt Workbench — put the data behind Supabase Auth.
--
-- 0001/0002 granted the `anon` role full access because there was no login. Now
-- the app signs in with email + password (see src/lib/auth.ts) and talks to
-- Postgres with the user's JWT, so we move every policy from `anon` to
-- `authenticated`: an unauthenticated client can no longer read or write.
--
-- SINGLE USER (see README "Users"): auth exists only to keep the data private,
-- not to coordinate people. There is exactly one account (new signups are
-- disabled in the Supabase dashboard), so a role check is sufficient — no
-- `user_id = auth.uid()` predicate or ownership column is needed. If this ever
-- grows to multiple users, add a `user_id` column and that predicate here.
--
-- OPERATOR STEPS (once, in the Supabase dashboard) — do these BEFORE relying on
-- the auth build, or the app will be locked out with no way in:
--   1. Authentication → Users → Add user (email + password). It is auto-confirmed,
--      so no confirmation email is needed.
--   2. Authentication → Providers/Sign-in settings → DISABLE new sign-ups.
--
-- ROLLBACK: re-run 0001's policy block (recreate each policy `to anon`) to
-- restore open access; the client still works because its config is unchanged.

drop policy if exists "single-user full access" on public.prompts;
create policy "single-user full access" on public.prompts
  for all to authenticated using (true) with check (true);

drop policy if exists "single-user full access" on public.prompt_versions;
create policy "single-user full access" on public.prompt_versions
  for all to authenticated using (true) with check (true);

drop policy if exists "single-user full access" on public.snippets;
create policy "single-user full access" on public.snippets
  for all to authenticated using (true) with check (true);

drop policy if exists "single-user full access" on public.app_meta;
create policy "single-user full access" on public.app_meta
  for all to authenticated using (true) with check (true);
