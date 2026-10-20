-- Unfinished sessions: one per student, course and kind; owner-only; returned by my_data().
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

\set A aaaaaaaa-0000-4000-8000-000000000001
\set B bbbbbbbb-0000-4000-8000-000000000002
\set course c0000000-0000-4000-8000-00000000000a

insert into auth.users (id, email) values (:'A', 'a@example.com'), (:'B', 'b@example.com');
insert into public.courses (id, owner_id, slug, name, short, variant, pos_x, pos_y, review_config, weights)
  values (:'course', :'A', 'ald', 'ALD', 'ALD', 'ald', 0, 0, '{}', '{}');

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  select set_config('role', 'authenticated', true);
$$;

select pg_temp.act_as(:'A');
select lives_ok(format($$insert into public.session_progress (course_id, kind, session_id, items, position, title) values (%L, 'quick', gen_random_uuid(), '[]', 0, 'ALD')$$, :'course'), 'a student saves an unfinished quick review');
select throws_ok(format($$insert into public.session_progress (course_id, kind, session_id, items, position, title) values (%L, 'quick', gen_random_uuid(), '[]', 0, 'ALD')$$, :'course'), '23505', null, 'one per course and kind: the next save is an update');
select is((public.my_data() -> 'session_progress' -> 0 ->> 'kind'), 'quick', 'my_data returns it');

select set_config('role', 'postgres', true);
select pg_temp.act_as(:'B');
select is((select count(*) from public.session_progress)::int, 0, 'another student sees none of it');
select throws_ok(format($$insert into public.session_progress (course_id, kind, session_id, items, position, title) values (%L, 'deep', gen_random_uuid(), '[]', 0, 'x')$$, :'course'), null, null, 'and can''t save one in a course that isn''t theirs');

select * from finish();
rollback;
