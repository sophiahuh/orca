-- Owner, 2026-10-27: "Typed notes" is a material type (the student's own typed notes, read as text).
alter table public.materials drop constraint materials_type_check;
alter table public.materials add constraint materials_type_check check (type in ('Syllabus', 'Past exam', 'Practice problems', 'Practice exam', 'Homework', 'Lecture', 'Handwritten notes', 'Typed notes', 'Other'));
