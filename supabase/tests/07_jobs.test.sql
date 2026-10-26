-- Jobs (Task 7a): run records are the server's. A student reads their own runs (and follows them
-- through Realtime) but can't write one, directly or through save_structure; one upload job per
-- material and one top-up per course can be in flight.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

\set A aaaaaaaa-0000-4000-8000-000000000071
\set B bbbbbbbb-0000-4000-8000-000000000072
\set course c0000000-0000-4000-8000-000000000071
\set material d0000000-0000-4000-8000-000000000071
\set run e0000000-0000-4000-8000-000000000071

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  select set_config('role', 'authenticated', true);
$$;

insert into auth.users (id, email) values (:'A', 'a7@example.com'), (:'B', 'b7@example.com');
insert into public.courses (id, owner_id, slug, name, short, variant, pos_x, pos_y, review_config)
  values (:'course', :'A', 'ald', 'ALD', 'ALD', 'ald', 0, 0, '{}');
insert into public.materials (id, owner_id, course_id, filename, type) values (:'material', :'A', :'course', 'L01.pdf', 'Lecture');
-- The job's run, as the server writes it.
insert into public.pipeline_runs (id, owner_id, course_id, material_id, kind, at, model, status, progress)
  values (:'run', :'A', :'course', :'material', 'upload', now(), 'claude-opus-5-5', 'running', '{"stage": "mapping"}');

select pg_temp.act_as(:'A');
select is((select progress ->> 'stage' from public.pipeline_runs where id = :'run'), 'mapping', 'A reads their run''s progress');
select throws_ok(format($$insert into public.pipeline_runs (id, course_id, material_id, kind, at, model) values (gen_random_uuid(), %L, %L, 'upload', now(), 'x')$$, :'course', :'material'),
  '42501', null, 'A cannot insert a run');
select throws_ok(format($$update public.pipeline_runs set status = 'done', hidden_text = null where id = %L$$, :'run'),
  '42501', null, 'A cannot change a run (its counts and hidden-text note are the job''s)');
select throws_ok(format($$select public.save_structure(%L, %L)$$, :'course', jsonb_build_object(
  'runs', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'material_id', :'material', 'kind', 'upload', 'at', now(), 'model', 'stub')))),
  '42501', null, 'a browser save carrying a run is refused');
reset role;

select pg_temp.act_as(:'B');
select is((select count(*) from public.pipeline_runs), 0::bigint, 'B sees none of A''s runs');
reset role;

-- One job in flight per material and per course.
select throws_ok(format($$insert into public.pipeline_runs (id, owner_id, course_id, material_id, kind, at, model, status) values (gen_random_uuid(), %L, %L, %L, 'upload', now(), 'x', 'queued')$$, :'A', :'course', :'material'),
  '23505', null, 'a second upload job for the same material is refused while one is in flight');
update public.pipeline_runs set status = 'done', progress = null where id = :'run';
select lives_ok(format($$insert into public.pipeline_runs (id, owner_id, course_id, material_id, kind, at, model, status) values (gen_random_uuid(), %L, %L, %L, 'upload', now(), 'x', 'queued')$$, :'A', :'course', :'material'),
  'once it finished, the material can be processed again');
select lives_ok(format($$insert into public.pipeline_runs (id, owner_id, course_id, material_id, kind, at, model, status) values (gen_random_uuid(), %L, %L, null, 'top-up', now(), 'x', 'running')$$, :'A', :'course'),
  'a top-up run may name no material');
select throws_ok(format($$insert into public.pipeline_runs (id, owner_id, course_id, material_id, kind, at, model, status) values (gen_random_uuid(), %L, %L, null, 'top-up', now(), 'x', 'queued')$$, :'A', :'course'),
  '23505', null, 'a second top-up for the same course is refused while one is in flight');
select throws_ok(format($$insert into public.pipeline_runs (id, owner_id, course_id, material_id, kind, at, model, status) values (gen_random_uuid(), %L, %L, null, 'upload', now(), 'x', 'done')$$, :'A', :'course'),
  '23514', null, 'an upload run must name its material');
select throws_ok(format($$insert into public.pipeline_runs (id, owner_id, course_id, material_id, kind, at, model, status, progress) values (gen_random_uuid(), %L, %L, %L, 'upload', now(), 'x', 'done', '[1]')$$, :'A', :'course', :'material'),
  '23514', null, 'progress is an object');

select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pipeline_runs'),
  'runs are in the Realtime publication');

select * from finish();
rollback;
