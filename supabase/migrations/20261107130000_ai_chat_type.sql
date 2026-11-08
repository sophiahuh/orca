-- Owner, 2026-11-07: "AI chat" is a material type (a student's conversation with an AI, pasted or
-- linked); the chat rules follow the type, not the material's name, so a pasted syllabus is a syllabus.
alter table public.materials drop constraint materials_type_check;
alter table public.materials add constraint materials_type_check check (type in ('Syllabus', 'Past exam', 'Practice problems', 'Practice exam', 'Homework', 'Lecture', 'Handwritten notes', 'Typed notes', 'AI chat', 'Other'));
