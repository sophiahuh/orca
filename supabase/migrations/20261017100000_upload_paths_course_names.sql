-- 1. Uploads are stored at "<owner>/<material id>" (owner, 2026-10-17): the file's name isn't needed in
--    storage (it's kept as the material's `filename` for display). Files uploaded before keep their
--    "<owner>/<material id>/<safe name>" paths, so both shapes stay allowed; nothing else is.
alter table public.materials drop constraint materials_storage_path_check;
alter table public.materials add constraint materials_storage_path_check check (
  storage_path is null
  or storage_path = owner_id::text || '/' || id::text
  or (storage_path ~ ('^' || owner_id::text || '/' || id::text || '/[A-Za-z0-9._-]+$') and storage_path !~ '/\.{1,2}$')
);

-- 2. A course's name is at most 50 characters (owner, 2026-10-17).
alter table public.courses add constraint courses_name_length check (char_length(name) <= 50);
