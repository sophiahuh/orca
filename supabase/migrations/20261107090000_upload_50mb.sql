-- Owner, 2026-11-07: uploads up to 50 MB (was 30), the most a Supabase project on any plan takes
-- per file. The bucket's limit and the materials row's check move together with LIMITS.uploadBytes.
update storage.buckets set file_size_limit = 52428800 where id = 'materials';
alter table public.materials drop constraint materials_size_bytes_check;
alter table public.materials add constraint materials_size_bytes_check check (size_bytes is null or size_bytes between 0 and 52428800);
