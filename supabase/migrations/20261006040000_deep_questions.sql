-- Deep review (owner, 2026-10-06): starting a deep review writes harder, longer questions for it
-- (the "deep" pipeline step). They join the course's question stock marked deep, so quizzes, quick
-- reviews and re-quizzes leave them out and only deep reviews ask them.
alter table public.questions add column deep boolean not null default false;

-- Writing them is metered like every model call, as its own kind of work.
alter table public.model_usage drop constraint model_usage_kind_check;
alter table public.model_usage add constraint model_usage_kind_check check (kind in ('upload', 'top-up', 'reflect', 'grade', 'deep-review'));
