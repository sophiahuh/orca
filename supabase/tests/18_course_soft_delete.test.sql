-- Deleting a course (2026-11-08) is a soft delete: deleted_at set by the server only; my_data and
-- course_structure leave the course and everything under it out; its slug is free again.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

\set A aaaaaaaa-0000-4000-8000-000000000181
\set gone c0000000-0000-4000-8000-000000000181
\set kept c0000000-0000-4000-8000-000000000182
\set again c0000000-0000-4000-8000-000000000183
\set topic f0000000-0000-4000-8000-000000000181
\set o1 10000000-0000-4000-8000-000000000181

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  select set_config('role', 'authenticated', true);
$$;

insert into auth.users (id, email) values (:'A', 'a18@example.com');
insert into public.courses (id, owner_id, slug, name, short, variant, pos_x, pos_y, review_config) values
  (:'gone', :'A', 'ald', 'ALD', 'ALD', 'ald', 0, 0, '{}'),
  (:'kept', :'A', 'circuits', 'Circuits', 'CIR', 'circuit', 0, 0, '{}');
insert into public.topics (id, owner_id, course_id, sort_order, name, review, pos_x, pos_y) values
  (:'topic', :'A', :'gone', 0, 'Boolean algebra', 'confirmed', 0, 0);
insert into public.objectives (id, owner_id, course_id, topic_id, name, description, origin, review) values
  (:'o1', :'A', :'gone', :'topic', 'Simplify', 'd', 'inferred', 'confirmed');
insert into public.calendar_events (id, owner_id, course_id, date, kind, title) values
  (gen_random_uuid(), :'A', :'gone', '2026-11-10', 'hw', 'HW 1'),
  (gen_random_uuid(), :'A', null, '2026-11-11', 'hw', 'Personal');

/* ── the browser can't set deleted_at ── */

select pg_temp.act_as(:'A');
select throws_ok(format($$update public.courses set deleted_at = now() where id = %L$$, :'gone'), '42501', null, 'the browser can''t delete a course itself');
select lives_ok(format($$update public.courses set name = 'Logic' where id = %L$$, :'gone'), 'it can still rename one');
reset role;

/* ── the server deletes it ── */

update public.courses set deleted_at = now() where id = :'gone';

select pg_temp.act_as(:'A');
select is(jsonb_array_length(public.my_data() -> 'courses'), 1, 'my_data leaves out the deleted course');
select is(public.my_data() -> 'courses' -> 0 ->> 'id', :'kept', 'and keeps the live one');
select is(jsonb_array_length(public.my_data() -> 'topics'), 0, 'the deleted course''s topics go with it');
select is(jsonb_array_length(public.my_data() -> 'objectives'), 0, 'and its objectives');
select is(jsonb_array_length(public.my_data() -> 'calendar'), 1, 'its calendar entries go; entries of no course stay');
select is(public.course_structure(:'gone', :'A'), null, 'course_structure returns nothing for it');
select isnt(public.course_structure(:'kept', :'A'), null, 'but still reads a live course');
select lives_ok(format($$insert into public.courses (id, owner_id, slug, name, short, variant, pos_x, pos_y, review_config) values (%L, %L, 'ald', 'ALD', 'ALD', 'ald', 0, 0, '{}')$$, :'again', :'A'), 'a new course can take the deleted one''s slug');
select throws_ok($$insert into public.courses (id, owner_id, slug, name, short, variant, pos_x, pos_y, review_config) values (gen_random_uuid(), auth.uid(), 'ald', 'ALD', 'ALD', 'ald', 0, 0, '{}')$$, '23505', null, 'two live courses still can''t share a slug');
reset role;

select * from finish();
rollback;
