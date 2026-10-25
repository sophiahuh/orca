-- A Dive In is as long as the student picks (2026-10-25): the 80-minute ceiling goes, at least 1 stays.
alter table public.pipeline_runs drop constraint pipeline_runs_deep_minutes_check;
alter table public.pipeline_runs add constraint pipeline_runs_deep_minutes_check
  check ((kind = 'deep-review') = (deep_minutes is not null) and (deep_minutes is null or deep_minutes >= 1));
