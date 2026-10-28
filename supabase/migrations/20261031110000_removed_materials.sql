-- Removing material from a course (owner, 2026-10-28): the row stays (topics, objectives and
-- questions keep their provenance), marked `removed`, without its file, pages, hash or calendar
-- entry; the app doesn't load it, and the objectives only it taught are archived.
alter table public.materials drop constraint if exists materials_status_check;
alter table public.materials add constraint materials_status_check
  check (status in ('uploaded', 'reading', 'processing', 'ready', 'failed', 'removed'));
