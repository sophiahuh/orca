-- Paused uploads (owner, 2026-10-28): a queued upload the student has set aside. It isn't live:
-- the queue skips it (nothing waits behind it, it is never taken for dead), and "Resume" puts it
-- back in line by its upload time. Only uploads pause; top-ups and dives are not queued by hand.
alter table public.pipeline_runs drop constraint if exists pipeline_runs_status_check;
alter table public.pipeline_runs add constraint pipeline_runs_status_check
  check (status in ('queued', 'waiting', 'running', 'paused', 'done', 'failed'));
alter table public.pipeline_runs add constraint pipeline_runs_paused_uploads_only check (status <> 'paused' or kind = 'upload');

-- A paused run is still the material's one run in flight: re-uploading the file resumes it instead of starting a second.
drop index if exists public.pipeline_runs_one_upload_in_flight;
create unique index pipeline_runs_one_upload_in_flight on public.pipeline_runs (material_id)
  where kind = 'upload' and status in ('queued', 'waiting', 'running', 'paused');
