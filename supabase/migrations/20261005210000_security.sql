-- Injection defences (Phase 4, Task 7b; plan decision 13).
--
-- 1. What a run's checks found: { "screen": [{ "check", "quote" }], "instructionsFound": [...],
--    "refused": n }. Written by the job with the run (save_structure); the review screen warns from
--    it ("This file contains text aimed at an AI; check what it added.").
alter table public.pipeline_runs add column security jsonb
  check (security is null or (jsonb_typeof(security) = 'object' and jsonb_typeof(security -> 'screen') = 'array' and jsonb_typeof(security -> 'instructionsFound') = 'array'));

-- 2. Every suspected item, one row per finding: who, what kind of text, which check, what it
--    referred to, and the quoted span (at most 240 characters, never the whole text). Readable and
--    writable by the service role only: RLS on, no policies. Integration reads it to turn model
--    grading off for a student whose answers are flagged repeatedly.
create table public.security_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,
  -- Where the text came from.
  kind text not null check (kind in ('upload', 'reflection_note', 'student_answer', 'generated')),
  -- Which check flagged it: the pattern screen's checks, the model's instructionsFound, or a validator's refusal.
  "check" text not null check (length("check") between 1 and 60),
  run_id uuid,
  material_id uuid,
  question_id uuid,
  quote text not null check (length(quote) <= 240),
  at timestamptz not null default now()
);
create index on public.security_events (owner_id, at);
create index on public.security_events (owner_id, kind, at);
alter table public.security_events enable row level security;

-- 3. A run's findings become events when the run is saved with them (the job writes the run
--    through save_structure and never touches security_events itself).
create function private.security_events_from_run() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  hit jsonb;
  found text;
begin
  if new.security is null or (tg_op = 'UPDATE' and old.security is not distinct from new.security) then
    return new;
  end if;
  for hit in select * from jsonb_array_elements(coalesce(new.security -> 'screen', '[]'::jsonb)) loop
    insert into public.security_events (owner_id, kind, "check", run_id, material_id, quote)
      values (new.owner_id, 'upload', left(coalesce(hit ->> 'check', 'phrase'), 60), new.id, new.material_id, left(coalesce(hit ->> 'quote', ''), 240));
  end loop;
  for found in select value #>> '{}' from jsonb_array_elements(coalesce(new.security -> 'instructionsFound', '[]'::jsonb)) loop
    insert into public.security_events (owner_id, kind, "check", run_id, material_id, quote)
      values (new.owner_id, 'upload', 'model:instructionsFound', new.id, new.material_id, left(coalesce(found, ''), 240));
  end loop;
  return new;
end $$;
revoke execute on function private.security_events_from_run() from public, anon, authenticated;

create trigger security_events_from_run
  after insert or update of security on public.pipeline_runs
  for each row execute function private.security_events_from_run();
