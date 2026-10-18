-- A thumbs down may carry the student's note on what was wrong (owner, 2026-10-18); question writing
-- reads the course's recent ones (plan: docs/superpowers/plans/2026-10-18-question-feedback.md, part 2).
alter table public.question_feedback add column note text check (note is null or char_length(note) <= 300);
alter table public.question_feedback add constraint question_feedback_note_on_down check (rating = 'down' or note is null);
