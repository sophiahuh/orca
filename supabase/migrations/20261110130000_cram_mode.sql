-- Cram mode (docs/superpowers/specs/2026-11-10-cram-mode-contracts.md, section 1). A material can
-- be held back (mapped to objectives, never used to write questions, never shown to Claude); an exam
-- can be crammed for and carry a scope; questions can come from Claude; evidence gains two kinds
-- (work: a problem Claude set and judged; signal: what the student did) and the columns Claude
-- reports on an answer (help, confidence, error_type). Mastery is recomputed under rules v4.

alter table public.materials add column held_back boolean not null default false;

alter table public.exams add column cramming boolean not null default false;
-- ExamScope (src/lib/data.ts); null = no scope beyond topic_ids.
alter table public.exams add column scope jsonb check (scope is null or jsonb_typeof(scope) = 'object');

alter table public.questions add column source text not null default 'orca' check (source in ('orca', 'claude'));

-- The constraint names are Postgres's defaults (checked on the local stack with \d evidence_events).
alter table public.evidence_events drop constraint evidence_events_kind_check;
alter table public.evidence_events add constraint evidence_events_kind_check check (kind in ('answer', 'confusion', 'work', 'signal'));
alter table public.evidence_events drop constraint evidence_events_grader_check;
alter table public.evidence_events add constraint evidence_events_grader_check check (grader in ('choice', 'exact', 'rubric', 'self', 'claude'));
-- flag_source gains 'connector-struggled' (a struggled flag from Claude; strength follows the source).
alter table public.evidence_events drop constraint evidence_events_flag_source_check;
alter table public.evidence_events add constraint evidence_events_flag_source_check check (flag_source in ('homework', 'handwritten-marker', 'connector', 'connector-struggled', 'slide', 'manual'));
-- The value checks on help and signal are named, or Postgres would give them the names the shape
-- constraints below take (evidence_events_help_check, evidence_events_signal_check).
alter table public.evidence_events
  add column help text constraint evidence_events_help_values_check check (help in ('none', 'hint', 'shown')),
  add column confidence smallint check (confidence between 1 and 3),
  add column error_type text check (error_type in ('arithmetic', 'units', 'sign', 'misread', 'notation', 'concept')),
  -- work: the problem as the student saw it, and how it was judged.
  add column problem text check (problem is null or length(problem) between 1 and 4000),
  add column basis text check (basis in ('official-solution', 'known-answer', 'claude')),
  -- signal: what the student did.
  add column signal text constraint evidence_events_signal_values_check check (signal in ('got-it', 'lost', 'asked-answer', 'asked-harder'));
alter table public.evidence_events
  add constraint evidence_events_work_check check (kind <> 'work' or (question_id is null and problem is not null and basis is not null and outcome is not null and source = 'connector' and session_id is not null)),
  add constraint evidence_events_signal_check check (kind <> 'signal' or (question_id is null and signal is not null and source = 'connector' and session_id is not null)),
  add constraint evidence_events_help_check check (help is null or kind in ('answer', 'work'));

-- The flag shape (20261105090000_struggle_flags.sql) accepts connector-struggled wherever it accepts connector.
alter table public.evidence_events drop constraint evidence_events_flag_check;
alter table public.evidence_events add constraint evidence_events_flag_check check (
  kind <> 'confusion' or (
    question_id is null
    and flag_source is not null
    and (material_id is not null or flag_source in ('manual', 'connector', 'connector-struggled'))
    and (page is null or material_id is not null)
    and (flag_source <> 'slide' or (material_id is not null and page is not null))
  )
);

comment on column public.materials.held_back is 'Mapped to objectives but never used to write questions, never returned by material_for, never listed beyond its name (a past or practice exam kept for a practice test).';
comment on column public.exams.cramming is 'The student is cramming for this exam: the exam window applies whatever the date.';
comment on column public.exams.scope is 'ExamScope (src/lib/data.ts): per-objective weights inside the exam window, the format and where it came from; null = no scope beyond topic_ids.';
comment on column public.questions.source is 'Who wrote it: orca (the pipeline) or claude (add_questions through the connector).';
comment on column public.evidence_events.help is 'Answers and work: how much help Claude gave (none = full credit, hint = half, shown = a miss).';
comment on column public.evidence_events.confidence is 'Answers and work: the student''s confidence before the answer was revealed, 1 to 3.';
comment on column public.evidence_events.error_type is 'Answers and work: the kind of mistake, from the fixed list.';
comment on column public.evidence_events.problem is 'Work: the problem as the student saw it.';
comment on column public.evidence_events.basis is 'Work: what the judgement rested on (an official solution, a known answer, or Claude alone).';
comment on column public.evidence_events.signal is 'Signals: what the student did (got-it, lost, asked-answer, asked-harder).';
