-- topics.source: every page range a topic is taught on, across uploads (2026-10-26), as
-- [{ materialId, from, to }]. The old single range { filename, slideStart, slideEnd } came from the
-- upload that created the topic, which is its material_id.
update public.topics set source = case
  when source is null or material_id is null or jsonb_typeof(source) <> 'object' then '[]'::jsonb
  else jsonb_build_array(jsonb_build_object(
    'materialId', material_id,
    'from', (source ->> 'slideStart')::integer,
    'to', greatest((source ->> 'slideStart')::integer, (source ->> 'slideEnd')::integer)))
end;
alter table public.topics alter column source set default '[]'::jsonb;
alter table public.topics alter column source set not null;
alter table public.topics add constraint topics_source_is_array check (jsonb_typeof(source) = 'array');
