-- Topic links found by the link step (owner, 2026-10-06): after an upload they carry its material;
-- "Find connections" links the whole course and comes from no single upload, so material_id may
-- be empty. The link step's model calls are metered as their own kind.
alter table public.relations alter column material_id drop not null;
alter table public.model_usage drop constraint model_usage_kind_check;
alter table public.model_usage add constraint model_usage_kind_check check (kind in ('upload', 'top-up', 'reflect', 'grade', 'deep-review', 'relink'));
