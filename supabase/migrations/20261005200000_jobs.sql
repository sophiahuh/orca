-- Jobs (Phase 4, Task 7a). Uploads and top-ups now run on the server (processMaterial and topUp,
-- inline or on Trigger.dev), so their run records are the server's, not the browser's.
--
-- 1. Runs are written by the server only. Students still read their own (and follow them through
--    Realtime), but can't insert or change one, so a run's counts, errors and hidden-text note are
--    what the job recorded. save_structure runs as its caller, so a browser save that carries runs
--    is refused too.
drop policy "own runs: add" on public.pipeline_runs;
drop policy "own runs: change" on public.pipeline_runs;
revoke insert, update, delete, truncate on public.pipeline_runs from anon, authenticated;

-- 2. A top-up writes questions for a session's objectives from whichever materials teach them: one
--    run for the whole top-up, naming its material only when there was exactly one.
alter table public.pipeline_runs alter column material_id drop not null;
alter table public.pipeline_runs add constraint pipeline_runs_material_check check (kind = 'top-up' or material_id is not null);

-- 3. Progress is a small object ({ stage, ... }); a finished run has none.
alter table public.pipeline_runs add constraint pipeline_runs_progress_check check (progress is null or jsonb_typeof(progress) = 'object');

-- 4. One job in flight per material (an upload) and per course (a top-up): a retried request or a
--    second tab finds the running one instead of paying for the same work twice.
create unique index pipeline_runs_one_upload_in_flight on public.pipeline_runs (material_id)
  where kind = 'upload' and status in ('queued', 'waiting', 'running');
create unique index pipeline_runs_one_top_up_in_flight on public.pipeline_runs (course_id)
  where kind = 'top-up' and status in ('queued', 'waiting', 'running');

-- 5. The review screen and the session end card follow a run's progress through Realtime, which
--    applies the table's row-level security to every subscriber.
alter publication supabase_realtime add table public.pipeline_runs;
