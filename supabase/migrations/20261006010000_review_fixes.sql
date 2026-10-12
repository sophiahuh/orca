-- Fixes from the whole-branch review (Phase 4, Wave 3, 2026-10-06).
--
-- 1. When a job claimed its run. Dead-run detection judged from `at` (when the run was created),
--    which is wrong once one job runs at a time per student: a run may legitimately queue for an
--    hour before it starts. `claim` sets this; a running run is dead when it was claimed longer ago
--    than its job could run (src/lib/jobs/start.ts, DEAD_RUN_MS).
alter table public.pipeline_runs add column started_at timestamptz;

-- 2. How sure the pattern screen is: 'strong' for phrasing that has no place in course material
--    or an honest answer (ignore the instructions, system prompt, mark this correct, chat role
--    tags, an encoded payload), 'weak' for phrasing that ordinary prose also uses ("the output only
--    changes on the clock edge", "you are a designer"). Only strong hits refuse generated text,
--    warn on the review screen and count toward turning a student's model grading off.
alter table public.security_events add column severity text not null default 'strong' check (severity in ('strong', 'weak'));

-- 3. The trigger carries the severity and also logs what the output validators refused
--    (security.refusedItems: [{ what, reason }]) as 'generated' events, so decision 13's "every
--    suspected item is logged" holds for refusals too.
create or replace function private.security_events_from_run() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  hit jsonb;
  found text;
  refused jsonb;
begin
  if new.security is null or (tg_op = 'UPDATE' and old.security is not distinct from new.security) then
    return new;
  end if;
  for hit in select * from jsonb_array_elements(coalesce(new.security -> 'screen', '[]'::jsonb)) loop
    insert into public.security_events (owner_id, kind, "check", severity, run_id, material_id, quote)
      values (new.owner_id, 'upload', left(coalesce(hit ->> 'check', 'phrase'), 60),
              case when hit ->> 'severity' = 'weak' then 'weak' else 'strong' end,
              new.id, new.material_id, left(coalesce(hit ->> 'quote', ''), 240));
  end loop;
  for found in select value #>> '{}' from jsonb_array_elements(coalesce(new.security -> 'instructionsFound', '[]'::jsonb)) loop
    insert into public.security_events (owner_id, kind, "check", run_id, material_id, quote)
      values (new.owner_id, 'upload', 'model:instructionsFound', new.id, new.material_id, left(coalesce(found, ''), 240));
  end loop;
  for refused in select * from jsonb_array_elements(coalesce(new.security -> 'refusedItems', '[]'::jsonb)) loop
    insert into public.security_events (owner_id, kind, "check", run_id, material_id, quote)
      values (new.owner_id, 'generated', 'validator', new.id, new.material_id,
              left(coalesce(refused ->> 'what', '') || ': ' || coalesce(refused ->> 'reason', ''), 240));
  end loop;
  return new;
end $$;
revoke execute on function private.security_events_from_run() from public, anon, authenticated;
