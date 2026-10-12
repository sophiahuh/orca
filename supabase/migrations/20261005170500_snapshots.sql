-- Snapshots of the fold (plan decision 3). One row per objective an event counts for now: the
-- ObjectiveAccumulator after applying, in time order, every event that counts for it
-- (src/lib/mastery/attribution.ts decides which do). A snapshot is a cache, never the record:
-- the evidence log is, and any snapshot can be rebuilt from it. Rows are written only by the
-- server (service role), through record_evidence (an event and its snapshot in one transaction)
-- and save_snapshot (a rebuild); structure changes that move events between objectives mark the
-- objectives involved stale, and the next read rebuilds them.

create table public.objective_state (
  objective_id uuid primary key,
  owner_id uuid not null references auth.users on delete cascade,
  course_id uuid not null,
  -- The ObjectiveAccumulator (src/lib/mastery/objective-state.ts) as JSON. Null only on a row a
  -- structure change created before anything was folded into it (always stale).
  accumulator jsonb,
  -- RULES_VERSION the accumulator was folded under; an older one counts as stale.
  rules_version integer,
  stale boolean not null default false,
  -- Optimistic-concurrency counter, not history: every write and every stale mark adds one, and a
  -- write names the version it read, so two tabs answering at once can't lose an answer.
  version integer not null default 1 check (version > 0),
  -- The accumulator's lastAt: the newest event folded in.
  last_event_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (course_id, owner_id) references public.courses (id, owner_id) on delete cascade,
  foreign key (objective_id, course_id) references public.objectives (id, course_id) on delete cascade,
  check ((accumulator is null) = (rules_version is null)),
  check (stale or accumulator is not null),
  check (accumulator is null or jsonb_typeof(accumulator) = 'object')
);
create index on public.objective_state (owner_id);
create index on public.objective_state (course_id);

alter table public.objective_state enable row level security;
create policy "own snapshots: read" on public.objective_state for select to authenticated using (owner_id = (select auth.uid()));
revoke insert, update, delete, truncate on public.objective_state from anon, authenticated;

/* ── Writes (server only) ─────────────────────────────────────────────── */

-- Record one evidence event and, when it counts for an objective, that objective's new snapshot,
-- in one transaction. The snapshot is written only if its version is still `expected_version`
-- (0: no row yet); otherwise nothing is written and it returns false, and the caller rebuilds
-- from the log and tries again. The owner comes from the server's verified session, never from
-- the browser; the event's course must be theirs, and `owner_id` in the event is overwritten.
--
-- event: an evidence_events row as JSON (columns by name). objective: where it counts now, or
-- null when it counts for nothing (archived), in which case only the event is written.
create function public.record_evidence(owner uuid, event jsonb, objective uuid, accumulator jsonb, rules_version integer, expected_version integer)
returns boolean
language plpgsql security invoker set search_path = '' as $$
declare
  course uuid := (event ->> 'course_id')::uuid;
  written integer;
begin
  if owner is null or not exists (select 1 from public.courses c where c.id = course and c.owner_id = owner) then
    raise exception 'Course % does not belong to this student', course using errcode = 'insufficient_privilege';
  end if;
  if objective is not null then
    if not exists (select 1 from public.objectives o where o.id = objective and o.course_id = course) then
      raise exception 'Objective % is not in course %', objective, course using errcode = 'foreign_key_violation';
    end if;
    if accumulator is null or rules_version is null or expected_version is null or expected_version < 0 then
      raise exception 'record_evidence: a snapshot needs an accumulator, its rules version and the version it read'
        using errcode = 'invalid_parameter_value';
    end if;
    if expected_version = 0 then
      insert into public.objective_state (objective_id, owner_id, course_id, accumulator, rules_version, stale, version, last_event_at)
      values (objective, owner, course, accumulator, rules_version, false, 1, (accumulator ->> 'lastAt')::timestamptz)
      on conflict (objective_id) do nothing;
    else
      update public.objective_state s
         set accumulator = record_evidence.accumulator, rules_version = record_evidence.rules_version, stale = false,
             version = s.version + 1, last_event_at = (record_evidence.accumulator ->> 'lastAt')::timestamptz, updated_at = now()
       where s.objective_id = objective and s.owner_id = owner and s.version = expected_version;
    end if;
    get diagnostics written = row_count;
    if written = 0 then
      return false;
    end if;
  end if;
  insert into public.evidence_events
    select * from jsonb_populate_record(null::public.evidence_events, event || jsonb_build_object('owner_id', owner));
  return true;
end;
$$;

-- Save a snapshot rebuilt from the log (a stale one, read by GET /api/state), only if nothing
-- wrote or marked it since it was read. Returns false when the version moved on.
create function public.save_snapshot(owner uuid, objective uuid, accumulator jsonb, rules_version integer, expected_version integer)
returns boolean
language plpgsql security invoker set search_path = '' as $$
declare
  written integer;
begin
  if accumulator is null or rules_version is null then
    raise exception 'save_snapshot: needs an accumulator and its rules version' using errcode = 'invalid_parameter_value';
  end if;
  update public.objective_state s
     set accumulator = save_snapshot.accumulator, rules_version = save_snapshot.rules_version, stale = false,
         version = s.version + 1, last_event_at = (save_snapshot.accumulator ->> 'lastAt')::timestamptz, updated_at = now()
   where s.objective_id = objective and s.owner_id = owner and s.version = expected_version;
  get diagnostics written = row_count;
  return written > 0;
end;
$$;

revoke execute on function public.record_evidence(uuid, jsonb, uuid, jsonb, integer, integer) from public, anon, authenticated;
revoke execute on function public.save_snapshot(uuid, uuid, jsonb, integer, integer) from public, anon, authenticated;
grant execute on function public.record_evidence(uuid, jsonb, uuid, jsonb, integer, integer) to service_role;
grant execute on function public.save_snapshot(uuid, uuid, jsonb, integer, integer) to service_role;

/* ── Stale marks ──────────────────────────────────────────────────────── */

-- The objective that stands for `id` now, following merged_into (as resolveObjectiveId does).
create function private.resolve_objective(id uuid) returns uuid
language plpgsql stable set search_path = '' as $$
declare
  current uuid := id;
  next_id uuid;
  steps integer := 0;
begin
  loop
    select o.merged_into into next_id from public.objectives o where o.id = current;
    exit when next_id is null;
    steps := steps + 1;
    if steps > 1000 then
      raise exception 'Objective merge cycle through %', id;
    end if;
    current := next_id;
  end loop;
  return current;
end;
$$;

-- Mark one objective's snapshot stale, and every objective it was merged into after it (the
-- chain up to the one that stands for it now). With create_missing, an objective with no snapshot
-- gets a stale one, because events may now count for it that didn't before (a merge, an
-- un-merge, a re-tag, a restore); the next read rebuilds it.
create function private.mark_stale(start uuid, create_missing boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  current uuid := start;
  steps integer := 0;
begin
  while current is not null loop
    if create_missing then
      insert into public.objective_state (objective_id, owner_id, course_id, stale)
        select o.id, o.owner_id, o.course_id, true from public.objectives o where o.id = current
      on conflict (objective_id) do update set stale = true, version = public.objective_state.version + 1, updated_at = now();
    else
      update public.objective_state set stale = true, version = version + 1, updated_at = now() where objective_id = current;
    end if;
    select o.merged_into into current from public.objectives o where o.id = current;
    steps := steps + 1;
    if steps > 1000 then
      raise exception 'Objective merge cycle through %', start;
    end if;
  end loop;
end;
$$;

-- Whether any question other than `excluding` makes `objective` (as it stands now) one with
-- mechanism-tier questions, the flag that decides what clears a mix-up.
create function private.has_mechanism_question(objective uuid, course uuid, excluding uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.questions q
     where q.course_id = course and q.id <> excluding and q.tier = 'mechanism' and q.objective_id is not null
       and private.resolve_objective(q.objective_id) = objective);
$$;

-- A merge, un-merge, archive, restore or move to another topic changes which events count for
-- the objective and for the ones on both sides of its merge chain.
create function private.objective_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.mark_stale(new.id, true);
  if old.merged_into is not null then
    perform private.mark_stale(old.merged_into, true);
  end if;
  return null;
end;
$$;

create trigger objective_state_stale after update of merged_into, review, topic_id on public.objectives
  for each row
  when (old.merged_into is distinct from new.merged_into or old.review is distinct from new.review or old.topic_id is distinct from new.topic_id)
  execute function private.objective_changed();

-- Archiving or restoring a topic takes its objectives off the trail or puts them back.
create function private.topic_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  o uuid;
begin
  for o in select id from public.objectives where topic_id = new.id loop
    perform private.mark_stale(o, true);
  end loop;
  return null;
end;
$$;

create trigger objective_state_stale after update of review on public.topics
  for each row when (old.review is distinct from new.review)
  execute function private.topic_changed();

-- A re-tag (objective or topic) moves the question's answers to another objective. A new
-- question, or a tier change, matters only when its objective gains its first mechanism-tier
-- question or loses its last one.
create function private.question_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  target uuid;
begin
  if tg_op = 'UPDATE' and (old.objective_id is distinct from new.objective_id or old.topic_id is distinct from new.topic_id) then
    if old.objective_id is not null then
      perform private.mark_stale(old.objective_id, true);
    end if;
    if new.objective_id is not null then
      perform private.mark_stale(new.objective_id, true);
    end if;
    return null;
  end if;
  if new.objective_id is null then
    return null;
  end if;
  if (tg_op = 'INSERT' and new.tier = 'mechanism')
     or (tg_op = 'UPDATE' and (old.tier is not distinct from 'mechanism') <> (new.tier is not distinct from 'mechanism')) then
    target := private.resolve_objective(new.objective_id);
    if not private.has_mechanism_question(target, new.course_id, new.id) then
      perform private.mark_stale(target, false);
    end if;
  end if;
  return null;
end;
$$;

create trigger objective_state_stale after insert or update of objective_id, topic_id, tier on public.questions
  for each row execute function private.question_changed();

-- Day keys come from the profile's timezone, so a change can move answers to other days.
create function private.timezone_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.objective_state set stale = true, version = version + 1, updated_at = now() where owner_id = new.owner_id;
  return null;
end;
$$;

create trigger objective_state_stale after update of timezone on public.profiles
  for each row when (old.timezone is distinct from new.timezone)
  execute function private.timezone_changed();

revoke execute on function private.resolve_objective(uuid) from public, anon, authenticated;
revoke execute on function private.mark_stale(uuid, boolean) from public, anon, authenticated;
revoke execute on function private.has_mechanism_question(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function private.objective_changed() from public, anon, authenticated;
revoke execute on function private.topic_changed() from public, anon, authenticated;
revoke execute on function private.question_changed() from public, anon, authenticated;
revoke execute on function private.timezone_changed() from public, anon, authenticated;
