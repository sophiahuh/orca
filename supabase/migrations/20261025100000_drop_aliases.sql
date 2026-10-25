-- Topics and objectives no longer have aliases (2026-10-25): duplicates are matched by name, then by
-- the reconciliation call. The code stopped reading and writing the columns in the same change.
alter table public.topics drop column aliases;
alter table public.objectives drop column aliases;
