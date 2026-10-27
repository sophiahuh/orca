-- A question's topic is its objective's current topic (2026-10-26), so the fold needs each topic's
-- merge pointer: an objective a job created in a topic the student merged meanwhile still names it.
-- Same as 20261005180000_store_reads.sql, plus each topic's merged_into.
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
   where c.id = course and c.owner_id = owner;
$$;
