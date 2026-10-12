-- Reads for the app on Supabase (Phase 4, Task 5), each one consistent: a single SQL statement
-- sees one snapshot of the database, so a structure save landing halfway through can't give a
-- reader half of the old structure and half of the new (several PostgREST reads in parallel can).
--
-- Also the race left in 20261005170500_snapshots.sql: an objective's first mechanism-tier question
-- marked its snapshot stale only if one existed, so a first answer racing that question could
-- leave a fresh-but-wrong snapshot. It now creates a stale placeholder, which makes the racing
-- insert (expected_version 0) lose and retry from the log.

/* ── One course's structure, as the fold reads it ─────────────────────── */

-- The course's topics, objectives and questions (only the columns the fold needs) and its owner's
-- timezone, or null when the course isn't `owner`'s. Security invoker: under RLS for the browser;
-- the server calls it with the service role and the verified user as `owner`.
create function public.course_structure(course uuid, owner uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'timezone', p.timezone,
    'topics', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'review', t.review, 'sort_order', t.sort_order) order by t.sort_order, t.id)
        from public.topics t where t.course_id = c.id and t.owner_id = c.owner_id), '[]'::jsonb),
    'objectives', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'topic_id', o.topic_id, 'name', o.name, 'review', o.review, 'merged_into', o.merged_into) order by o.id)
        from public.objectives o where o.course_id = c.id and o.owner_id = c.owner_id), '[]'::jsonb),
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object('id', q.id, 'topic_id', q.topic_id, 'objective_id', q.objective_id, 'tier', q.tier, 'sort_order', q.sort_order) order by q.sort_order, q.id)
        from public.questions q where q.course_id = c.id and q.owner_id = c.owner_id), '[]'::jsonb))
    from public.courses c
    join public.profiles p on p.owner_id = c.owner_id
   where c.id = course and c.owner_id = owner;
$$;

revoke execute on function public.course_structure(uuid, uuid) from public, anon;
grant execute on function public.course_structure(uuid, uuid) to authenticated, service_role;

/* ── Everything the signed-in student has ─────────────────────────────── */

-- What the app loads at start (plan decision 4): the profile and every row of every table the
-- student owns, as whole rows, in one consistent read. Snapshots come too; the app asks
-- GET /api/state only for courses with a stale one. Material page text is left out (read on the
-- server by the jobs). Runs as the caller under RLS, and names auth.uid() as well.
create function public.my_data() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'profile', (select to_jsonb(p) from public.profiles p where p.owner_id = (select auth.uid())),
    'courses', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at, r.id) from public.courses r where r.owner_id = (select auth.uid())), '[]'::jsonb),
    'materials', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at, r.id) from public.materials r where r.owner_id = (select auth.uid())), '[]'::jsonb),
    'runs', coalesce((select jsonb_agg(to_jsonb(r) order by r.at, r.id) from public.pipeline_runs r where r.owner_id = (select auth.uid())), '[]'::jsonb),
    'topics', coalesce((select jsonb_agg(to_jsonb(r) order by r.course_id, r.sort_order, r.id) from public.topics r where r.owner_id = (select auth.uid())), '[]'::jsonb),
    'objectives', coalesce((select jsonb_agg(to_jsonb(r) order by r.course_id, r.created_at, r.id) from public.objectives r where r.owner_id = (select auth.uid())), '[]'::jsonb),
    'relations', coalesce((select jsonb_agg(to_jsonb(r) order by r.course_id, r.created_at, r.id) from public.relations r where r.owner_id = (select auth.uid())), '[]'::jsonb),
    'questions', coalesce((select jsonb_agg(to_jsonb(r) order by r.course_id, r.topic_id, r.sort_order, r.id) from public.questions r where r.owner_id = (select auth.uid())), '[]'::jsonb),
    'sessions', coalesce((select jsonb_agg(to_jsonb(r) order by r.finished_at, r.id) from public.session_results r where r.owner_id = (select auth.uid())), '[]'::jsonb),
    'calendar', coalesce((select jsonb_agg(to_jsonb(r) order by r.date, r.created_at, r.id) from public.calendar_events r where r.owner_id = (select auth.uid())), '[]'::jsonb),
    'evidence', coalesce((select jsonb_agg(to_jsonb(r) order by r.at, r.id) from public.evidence_events r where r.owner_id = (select auth.uid())), '[]'::jsonb),
    'snapshots', coalesce((select jsonb_agg(to_jsonb(r) order by r.objective_id) from public.objective_state r where r.owner_id = (select auth.uid())), '[]'::jsonb));
$$;

revoke execute on function public.my_data() from public, anon;
grant execute on function public.my_data() to authenticated;

/* ── The mechanism-tier race ──────────────────────────────────────────── */

create or replace function private.question_changed() returns trigger
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
      -- create_missing: with no snapshot yet, an answer being recorded right now would insert one
      -- folded without the mechanism flag. A stale placeholder makes that insert lose and retry.
      perform private.mark_stale(target, true);
    end if;
  end if;
  return null;
end;
$$;

revoke execute on function private.question_changed() from public, anon, authenticated;
