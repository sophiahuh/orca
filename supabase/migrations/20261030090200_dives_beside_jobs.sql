-- A Dive In runs beside the student's other job instead of queueing behind it: the student is
-- waiting on the loading screen, and an upload can hold the one-running place for half an hour.
-- A dive only adds questions to the structure it read when it started, so it can't collide with an
-- upload's changes. Uploads and top-ups still run one at a time per student (decision 10).
drop index public.pipeline_runs_one_running_per_student;
create unique index pipeline_runs_one_running_per_student on public.pipeline_runs (owner_id)
  where status = 'running' and kind <> 'deep-review';
