-- Typed slides with a figure (owner, 2026-10-18): their text stays, and the server's model adds a
-- description of the figure. 'needs-figure' until then, 'figure' after (plan, part 2).
alter table public.material_pages drop constraint material_pages_source_check;
alter table public.material_pages add constraint material_pages_source_check check (source in ('text', 'needs-vision', 'vision', 'needs-figure', 'figure'));
