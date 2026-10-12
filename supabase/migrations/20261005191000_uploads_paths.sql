-- Uploads, round 2 (Phase 4, Task 6 review).
--
-- 1. A material's file path is built by the server only: "<owner>/<material id>/<safe name>",
--    where the name is letters, digits, dot, dash and underscore and isn't "." or "..". The old
--    LIKE check let "<owner>/<id>/../../<someone else>/…" through, and the server reads the path
--    with the secret key. Students can no longer insert any of the server's columns either: a
--    material a student adds is a record without a file (status 'ready'); uploads are inserted by
--    POST /api/materials.
alter table public.materials drop constraint materials_check;
alter table public.materials add constraint materials_storage_path_check check (
  storage_path is null
  or (storage_path ~ ('^' || owner_id::text || '/' || id::text || '/[A-Za-z0-9._-]+$') and storage_path !~ '/\.{1,2}$')
);
alter table public.materials alter column status set default 'ready';
revoke insert on public.materials from anon, authenticated;
grant insert (id, course_id, filename, type, assigned, due, reflect, reflection) on public.materials to authenticated;

-- 2. When the server started reading a file, so a read that died (the function was stopped) can be
--    taken over after a few minutes instead of blocking the upload for good.
alter table public.materials add column reading_since timestamptz;

-- 3. The upload's run record says what hidden text the file had (decision 13), like the material.
alter table public.pipeline_runs add column hidden_text jsonb
  check (hidden_text is null or (jsonb_typeof(hidden_text) = 'object' and jsonb_typeof(hidden_text -> 'items') = 'number' and jsonb_typeof(hidden_text -> 'pages') = 'array'));
