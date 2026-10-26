-- Notes for Orca (owner, 2026-10-25): what the student knows about a class ("exams look like past
-- exams", "no proofs, only applications"), once for every class (profiles) and once per class
-- (courses). The writing steps (map, objectives, generate, deep) get both as a student_notes data
-- block; routes and jobs sanitise and screen them (src/lib/pipeline/notes.ts). They replace the
-- material-type weight sliders, whose columns are dropped: every covering place now counts the same.
alter table public.profiles
  drop column default_weights,
  add column orca_notes text check (orca_notes is null or char_length(orca_notes) between 1 and 1000);

alter table public.courses
  drop column weights,
  add column orca_notes text check (orca_notes is null or char_length(orca_notes) between 1 and 1000);

comment on column public.profiles.orca_notes is 'Notes for Orca for all the student''s classes; null = none.';
comment on column public.courses.orca_notes is 'Notes for Orca for this class (sent with the account''s; this one wins on a conflict); null = none.';

alter table public.security_events drop constraint security_events_kind_check;
alter table public.security_events add constraint security_events_kind_check
  check (kind in ('upload', 'reflection_note', 'student_answer', 'generated', 'orca_notes'));
