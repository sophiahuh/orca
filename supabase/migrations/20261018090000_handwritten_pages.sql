-- Handwritten and scanned notes are read from page images by the server's model (owner, 2026-10-18;
-- docs/superpowers/plans/2026-10-18-handwritten-notes.md).
-- 1. The student says an upload is handwritten notes: every page is read as an image.
alter table public.materials add column handwritten boolean not null default false;
-- 2. Where a page's text comes from: its text layer ('text'), waiting to be read from its image
--    ('needs-vision': handwritten, from a notes app, or almost no text), or read from it ('vision').
alter table public.material_pages add column source text not null default 'text' check (source in ('text', 'needs-vision', 'vision'));
