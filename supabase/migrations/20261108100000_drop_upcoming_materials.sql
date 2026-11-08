-- Every material counts as covered (owner, 2026-11-08): "How far has the class got?" and the
-- Uploads tab's "Mark covered" are gone, so nothing holds a material's objectives back from
-- reviews, dives, practice or the warm-up any more. Drops the column added in
-- 20261031090000_upcoming_materials.sql (its column grant goes with it). Scheduling only: no
-- learner state was ever stored in it.
alter table public.materials drop column upcoming;
