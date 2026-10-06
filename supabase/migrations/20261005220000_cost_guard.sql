-- Cost guard (Phase 4, Task 7c; plan decision 10).
--
-- 1. Every model call is metered: who it was for, what kind of work, which run, the model, the
--    token counts the Messages API reported and the estimated cost in USD (src/lib/pricing.ts).
--    Written and read by the server only (service role): RLS is on and there are no policies, so
--    students never see or change it. The daily budgets sum it per student and for everyone.
create table public.model_usage (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,
  kind text not null check (kind in ('upload', 'top-up', 'reflect', 'grade')),
  run_id uuid,
  model text not null,
  input_tokens integer not null check (input_tokens >= 0),
  output_tokens integer not null check (output_tokens >= 0),
  cache_write_tokens integer not null default 0 check (cache_write_tokens >= 0),
  cache_read_tokens integer not null default 0 check (cache_read_tokens >= 0),
  cost_usd numeric(12, 6) not null check (cost_usd >= 0),
  at timestamptz not null default now()
);
create index on public.model_usage (owner_id, at);
create index on public.model_usage (at);
alter table public.model_usage enable row level security;

-- 2. Rate limits are counted here: a fixed window per student and action, checked and bumped in
--    one statement (hit_rate_limit), so no other service is needed. Service role only, like above.
create table public.rate_limits (
  owner_id uuid not null references auth.users on delete cascade,
  action text not null,
  window_start timestamptz not null,
  count integer not null default 0 check (count >= 0),
  primary key (owner_id, action, window_start)
);
alter table public.rate_limits enable row level security;

-- Count one hit of `action` for `owner` in the fixed window of `window_seconds` that holds now(),
-- and say whether it is within `max_hits`: { allowed, count, retry_after_seconds }. Atomic: the
-- insert-or-bump returns the new count, so two requests can't both see the last free slot.
-- Windows that have passed are removed as a side effect. Only the server may call it.
create function public.hit_rate_limit(owner uuid, action text, window_seconds integer, max_hits integer) returns jsonb
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  w timestamptz;
  n integer;
begin
  if hit_rate_limit.owner is null or hit_rate_limit.action is null or hit_rate_limit.action = '' or window_seconds is null or window_seconds < 1 or max_hits is null or max_hits < 1 then
    raise exception 'hit_rate_limit: bad arguments';
  end if;
  w := to_timestamp(floor(extract(epoch from now()) / window_seconds) * window_seconds);
  insert into public.rate_limits as r (owner_id, action, window_start, count) values (hit_rate_limit.owner, hit_rate_limit.action, w, 1)
    on conflict (owner_id, action, window_start) do update set count = r.count + 1
    returning r.count into n;
  delete from public.rate_limits r where r.owner_id = hit_rate_limit.owner and r.action = hit_rate_limit.action and r.window_start < w;
  return jsonb_build_object(
    'allowed', n <= max_hits,
    'count', n,
    'retry_after_seconds', greatest(1, ceil(extract(epoch from (w + make_interval(secs => window_seconds) - now())))::integer)
  );
end $$;
revoke execute on function public.hit_rate_limit(uuid, text, integer, integer) from public, anon, authenticated;

-- 3. One job runs at a time per student: a second upload or top-up stays queued and starts when
--    the running one finishes (src/lib/jobs/start.ts resumes it). The claim (queued → running) is
--    what the index refuses, so two workers can't run a student's jobs side by side either.
create unique index pipeline_runs_one_running_per_student on public.pipeline_runs (owner_id) where status = 'running';

-- 4. A top-up's request is kept on its run, so a queued or waiting top-up can start later without
--    the browser's help. Uploads name their material already.
alter table public.pipeline_runs add column objective_ids uuid[] not null default '{}';
