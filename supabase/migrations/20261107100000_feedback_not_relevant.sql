-- Owner, 2026-11-07: "Not relevant" as a thumbs-down reason (the question is from the course, but not
-- something the student needs). Choosing it for the whole objective removes the objective, which is a
-- structure change, so nothing else is stored here.
alter table public.question_feedback drop constraint question_feedback_reason_check;
alter table public.question_feedback add constraint question_feedback_reason_check
  check (reason is null or reason in ('wrong-answer', 'unclear', 'too-easy', 'too-hard', 'not-my-course', 'not-relevant'));
