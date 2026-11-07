-- Owner, 2026-11-07: a student may upload a file the course already has again ("Upload again"),
-- which makes a second material with the same bytes. The hash index stays for finding the course's
-- copy of a file, but no longer refuses a second one (uploads settle a race between two ordinary
-- uploads of the same file themselves: the later one goes; src/lib/server/materials.ts).
drop index public.materials_same_file;
create index materials_same_file on public.materials (course_id, content_hash) where content_hash is not null;
