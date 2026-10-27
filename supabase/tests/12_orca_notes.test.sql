-- Notes for Orca: one per account and one per course, owner-only, 1–1,000 characters; the slider columns are gone.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

\set A aaaaaaaa-0000-4000-8000-000000000001
\set B bbbbbbbb-0000-4000-8000-000000000002
\set course c0000000-0000-4000-8000-00000000000a

insert into auth.users (id, email) values (:'A', 'a@example.com'), (:'B', 'b@example.com');
insert into public.courses (id, owner_id, slug, name, short, variant, pos_x, pos_y, review_config)
  values (:'course', :'A', 'ald', 'ALD', 'ALD', 'ald', 0, 0, '{}');

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  select set_config('role', 'authenticated', true);
$$;

select hasnt_column('public', 'courses', 'weights', 'the course slider column is gone');
select hasnt_column('public', 'profiles', 'default_weights', 'the account slider column is gone');

select pg_temp.act_as(:'A');
select lives_ok(format($$update public.courses set orca_notes = 'Exams look like past exams.' where id = %L$$, :'course'), 'a student writes their course''s notes');
select lives_ok(format($$update public.profiles set orca_notes = 'Worked examples help me.' where owner_id = %L$$, :'A'), 'and their notes for all classes');
select throws_ok(format($$update public.courses set orca_notes = repeat('x', 1001) where id = %L$$, :'course'), '23514', null, 'at most 1,000 characters');
select throws_ok(format($$update public.courses set orca_notes = '' where id = %L$$, :'course'), '23514', null, 'empty is null, not an empty string');
select is((public.my_data() -> 'courses' -> 0 ->> 'orca_notes'), 'Exams look like past exams.', 'my_data returns them');

select set_config('role', 'postgres', true);
select pg_temp.act_as(:'B');
select is((select count(*) from public.courses where orca_notes is not null)::int, 0, 'another student sees none of it');

select * from finish();
rollback;
