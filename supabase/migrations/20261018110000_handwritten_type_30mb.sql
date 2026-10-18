-- Owner, 2026-10-18: uploads up to 30 MB (was 25), and "Handwritten notes" is a material type
-- (its pages are read from their images; it replaces the upload page's separate switch).
update storage.buckets set file_size_limit = 31457280 where id = 'materials';
alter table public.materials drop constraint materials_size_bytes_check;
alter table public.materials add constraint materials_size_bytes_check check (size_bytes is null or size_bytes between 0 and 31457280);
alter table public.materials drop constraint materials_type_check;
alter table public.materials add constraint materials_type_check check (type in ('Syllabus', 'Past exam', 'Practice problems', 'Practice exam', 'Homework', 'Lecture', 'Handwritten notes', 'Other'));
