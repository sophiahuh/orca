-- Archived because its material was removed (owner, 2026-10-28), as against rejected by the
-- student: a later upload that teaches the same topic or objective again creates it afresh instead
-- of skipping it as "the same as rejected …" (src/lib/pipeline/run.ts). Cleared when the student
-- restores or confirms the item by hand.
alter table public.topics add column archived_with_material boolean not null default false;
alter table public.objectives add column archived_with_material boolean not null default false;
