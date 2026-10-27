-- "The class hasn't reached this yet" (owner, 2026-10-27): set when a folder is uploaded without
-- dates and the student taps how far the class has got, or inferred from an assigned date in the
-- future. The objectives such a material created wait: they're left out of the quick-review pool
-- and the due counts until the student marks it covered (the Uploads tab). A scheduling signal
-- only: it never changes mastery.
alter table public.materials add column upcoming boolean not null default false;
-- The student sets it from the browser (the Uploads tab), like the dates; the insert's columns are
-- the server's (POST /api/materials), a browser-made record is never upcoming.
grant update (upcoming) on public.materials to authenticated;
