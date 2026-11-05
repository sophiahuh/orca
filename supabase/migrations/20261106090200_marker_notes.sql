-- How the student marks confusion in their handwritten notes (weak points first, Plan B), e.g.
-- "★ = lost, ? in the margin". The page reader gets it as a description, never instructions. Saved
-- only through PUT /api/marker-notes, which screens it like Notes for Orca; jobs screen it again.
alter table public.profiles add column marker_notes text check (marker_notes is null or char_length(marker_notes) between 1 and 300);
