-- A Dive In is generated asynchronously just like an upload.  Its selected objectives and
-- requested duration live on the run so it can survive navigation, a refresh, and a queued start.
alter table public.pipeline_runs drop constraint if exists pipeline_runs_kind_check;
alter table public.pipeline_runs add constraint pipeline_runs_kind_check
  check (kind in ('upload', 'top-up', 'deep-review'));

alter table public.pipeline_runs add column deep_minutes integer;
alter table public.pipeline_runs add column question_ids uuid[] not null default '{}';
alter table public.pipeline_runs add constraint pipeline_runs_deep_minutes_check
  check ((kind = 'deep-review') = (deep_minutes is not null) and (deep_minutes is null or deep_minutes between 1 and 80));

alter table public.pipeline_runs drop constraint if exists pipeline_runs_material_check;
alter table public.pipeline_runs add constraint pipeline_runs_material_check
  check (kind in ('top-up', 'deep-review') or material_id is not null);

-- A second click follows the existing Dive In instead of paying to generate a duplicate session.
create unique index pipeline_runs_one_deep_review_in_flight on public.pipeline_runs (course_id)
  where kind = 'deep-review' and status in ('queued', 'waiting', 'running');
