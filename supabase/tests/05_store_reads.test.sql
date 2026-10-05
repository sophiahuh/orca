-- The app's reads (course_structure, my_data) return the caller's rows and nobody else's, and an
-- objective's first mechanism-tier question leaves a stale placeholder when it has no snapshot yet.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

\set A aaaaaaaa-0000-4000-8000-000000000001
\set B bbbbbbbb-0000-4000-8000-000000000002
\set course c0000000-0000-4000-8000-00000000000a
\set topic f0000000-0000-4000-8000-00000000000a
\set o1 10000000-0000-4000-8000-000000000001
\set q1 20000000-0000-4000-8000-000000000001

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  select set_config('role', 'authenticated', true);
$$;

insert into auth.users (id, email, raw_user_meta_data) values (:'A', 'a@example.com', '{"timezone": "America/New_York"}'), (:'B', 'b@example.com', '{}');
insert into public.courses (id, owner_id, slug, name, short, variant, pos_x, pos_y, review_config, weights) values
  (:'course', :'A', 'ald', 'ALD', 'ALD', 'ald', 0, 0, '{}', '{}');
insert into public.topics (id, owner_id, course_id, sort_order, name, review, pos_x, pos_y) values
  (:'topic', :'A', :'course', 0, 'Boolean algebra', 'confirmed', 0, 0);
insert into public.objectives (id, owner_id, course_id, topic_id, name, description, origin, review) values
  (:'o1', :'A', :'course', :'topic', 'Simplify', 'd', 'inferred', 'confirmed');

/* ── course_structure ── */

select pg_temp.act_as(:'A');
select is(public.course_structure(:'course', :'A') -> 'timezone', '"America/New_York"'::jsonb, 'the structure carries the owner''s timezone');
select is(jsonb_array_length(public.course_structure(:'course', :'A') -> 'objectives'), 1, 'and the course''s objectives');
select is(public.course_structure(:'course', :'B'), null, 'naming another owner returns nothing');
select pg_temp.act_as(:'B');
select is(public.course_structure(:'course', :'A'), null, 'nor can B read A''s course under RLS');

/* ── my_data ── */

select is(jsonb_array_length(public.my_data() -> 'courses'), 0, 'B sees none of A''s courses');
select is(public.my_data() -> 'profile' ->> 'owner_id', :'B', 'B gets their own profile');
select pg_temp.act_as(:'A');
select is(jsonb_array_length(public.my_data() -> 'topics'), 1, 'A gets their topics');
select ok(not has_function_privilege('anon', 'public.my_data()', 'execute'), 'signed-out callers can''t call my_data');

/* ── the first mechanism-tier question with no snapshot yet ── */

select public.save_structure(:'course', jsonb_build_object('questions', jsonb_build_array(jsonb_build_object(
  'id', :'q1', 'topic_id', :'topic', 'sort_order', 0, 'objective_id', :'o1', 'kind', 'True or false',
  'tier', 'mechanism', 'topic_name', 'Boolean algebra', 'prompt', 'p', 'options', jsonb_build_array('True', 'False'), 'answer', 0, 'explanation', 'e'))));
reset role;
select results_eq(format($$select stale, accumulator is null from public.objective_state where objective_id = %L$$, :'o1'),
  $$values (true, true)$$, 'it leaves a stale placeholder, so a racing first answer loses and retries from the log');

select * from finish();
rollback;
