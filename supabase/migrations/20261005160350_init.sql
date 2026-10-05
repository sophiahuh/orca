-- Orca's database starts here (docs/superpowers/plans/2026-10-05-orca-phase4-supabase.md).
-- Tables live in `public` under row-level security (every row has an owner_id; policies are
-- owner_id = auth.uid()). Helper functions that must not be callable through the API live in
-- `private`, which PostgREST doesn't expose.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
-- Functions are executable by everyone by default, and Supabase also grants the API roles
-- directly, so each function in `private` revokes EXECUTE itself after it's created (a guard test
-- checks). Triggers still fire: Postgres doesn't check EXECUTE when a trigger runs.
