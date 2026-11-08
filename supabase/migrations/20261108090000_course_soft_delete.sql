-- Deleting a course (2026-11-08): a soft delete. The course keeps its row and everything under it,
-- stamped with `deleted_at`; null means live. Only the server sets it (DELETE /api/courses/:id,
-- which also stops the course's jobs); a trigger keeps a student's own session from setting it.

alter table public.courses add column deleted_at timestamptz;

-- A deleted course gives up its slug: a new course of the same name gets the same URL.
alter table public.courses drop constraint courses_owner_id_slug_key;
create unique index courses_live_slug on public.courses (owner_id, slug) where deleted_at is null;

-- Only the server deletes a course (it also stops the course's jobs): a student's own session
-- can't set or clear deleted_at, whatever else it may change under RLS.
create function private.courses_keep_deleted_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.deleted_at is distinct from old.deleted_at and current_user in ('authenticated', 'anon') then
    raise exception 'a course is deleted through Orca''s server' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function private.courses_keep_deleted_at() from public, anon, authenticated;
create trigger keep_deleted_at before update on public.courses
  for each row execute function private.courses_keep_deleted_at();

-- The student's data leaves out deleted courses and everything filed under them.
-- Same as 20261019090000_session_progress.sql, filtered to live courses.
create or replace function public.my_data() returns jsonb
language sql stable security invoker set search_path = '' as $$
  with live as (select c.id from public.courses c where c.owner_id = (select auth.uid()) and c.deleted_at is null)
  select jsonb_build_object(
    'profile', (select to_jsonb(p) from public.profiles p where p.owner_id = (select auth.uid())),
    'courses', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at, r.id) from public.courses r where r.owner_id = (select auth.uid()) and r.deleted_at is null), '[]'::jsonb),
    'materials', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at, r.id) from public.materials r where r.owner_id = (select auth.uid()) and r.course_id in (select id from live)), '[]'::jsonb),
    'runs', coalesce((select jsonb_agg(to_jsonb(r) order by r.at, r.id) from public.pipeline_runs r where r.owner_id = (select auth.uid()) and r.course_id in (select id from live)), '[]'::jsonb),
    'topics', coalesce((select jsonb_agg(to_jsonb(r) order by r.course_id, r.sort_order, r.id) from public.topics r where r.owner_id = (select auth.uid()) and r.course_id in (select id from live)), '[]'::jsonb),
    'objectives', coalesce((select jsonb_agg(to_jsonb(r) order by r.course_id, r.created_at, r.id) from public.objectives r where r.owner_id = (select auth.uid()) and r.course_id in (select id from live)), '[]'::jsonb),
    'relations', coalesce((select jsonb_agg(to_jsonb(r) order by r.course_id, r.created_at, r.id) from public.relations r where r.owner_id = (select auth.uid()) and r.course_id in (select id from live)), '[]'::jsonb),
    'questions', coalesce((select jsonb_agg(to_jsonb(r) order by r.course_id, r.topic_id, r.sort_order, r.id) from public.questions r where r.owner_id = (select auth.uid()) and r.course_id in (select id from live)), '[]'::jsonb),
    'sessions', coalesce((select jsonb_agg(to_jsonb(r) order by r.finished_at, r.id) from public.session_results r where r.owner_id = (select auth.uid()) and r.course_id in (select id from live)), '[]'::jsonb),
    'calendar', coalesce((select jsonb_agg(to_jsonb(r) order by r.date, r.created_at, r.id) from public.calendar_events r where r.owner_id = (select auth.uid()) and (r.course_id is null or r.course_id in (select id from live))), '[]'::jsonb),
    'exams', coalesce((select jsonb_agg(to_jsonb(r) order by r.course_id, r.date, r.created_at, r.id) from public.exams r where r.owner_id = (select auth.uid()) and r.course_id in (select id from live)), '[]'::jsonb),
    'question_feedback', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at, r.question_id) from public.question_feedback r where r.owner_id = (select auth.uid()) and r.course_id in (select id from live)), '[]'::jsonb),
    'session_progress', coalesce((select jsonb_agg(to_jsonb(r) order by r.updated_at) from public.session_progress r where r.owner_id = (select auth.uid()) and r.course_id in (select id from live)), '[]'::jsonb),
    'evidence', coalesce((select jsonb_agg(to_jsonb(r) order by r.at, r.id) from public.evidence_events r where r.owner_id = (select auth.uid()) and r.course_id in (select id from live)), '[]'::jsonb),
    'snapshots', coalesce((select jsonb_agg(to_jsonb(r) order by r.objective_id) from public.objective_state r where r.owner_id = (select auth.uid()) and r.course_id in (select id from live)), '[]'::jsonb));
$$;

-- A deleted course has no structure to read (null, as for a course that isn't the owner's).
-- Same as 20261029090000_course_structure_topic_merges.sql, plus the deleted_at filter.
create or replace function public.course_structure(course uuid, owner uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'timezone', p.timezone,
    'topics', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'review', t.review, 'sort_order', t.sort_order, 'merged_into', t.merged_into) order by t.sort_order, t.id)
        from public.topics t where t.course_id = c.id and t.owner_id = c.owner_id), '[]'::jsonb),
    'objectives', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'topic_id', o.topic_id, 'name', o.name, 'review', o.review, 'merged_into', o.merged_into) order by o.id)
        from public.objectives o where o.course_id = c.id and o.owner_id = c.owner_id), '[]'::jsonb),
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object('id', q.id, 'topic_id', q.topic_id, 'objective_id', q.objective_id, 'tier', q.tier, 'sort_order', q.sort_order) order by q.sort_order, q.id)
        from public.questions q where q.course_id = c.id and q.owner_id = c.owner_id), '[]'::jsonb))
    from public.courses c
    join public.profiles p on p.owner_id = c.owner_id
   where c.id = course and c.owner_id = owner and c.deleted_at is null;
$$;
