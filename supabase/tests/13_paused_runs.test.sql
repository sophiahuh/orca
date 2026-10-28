-- Paused uploads (2026-10-28): a status of their own, for uploads only, still the material's one
-- run in flight (re-uploading the file resumes it instead of starting a second).
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

\set A aaaaaaaa-0000-4000-8000-000000000131
\set course c0000000-0000-4000-8000-000000000131
\set material d0000000-0000-4000-8000-000000000131
\set run e0000000-0000-4000-8000-000000000131

insert into auth.users (id, email) values (:'A', 'a13@example.com');
insert into public.courses (id, owner_id, slug, name, short, variant, pos_x, pos_y, review_config)
  values (:'course', :'A', 'ald', 'ALD', 'ALD', 'ald', 0, 0, '{}');
insert into public.materials (id, owner_id, course_id, filename, type) values (:'material', :'A', :'course', 'L01.pdf', 'Lecture');

select lives_ok(format($$insert into public.pipeline_runs (id, owner_id, course_id, material_id, kind, at, model, status) values (%L, %L, %L, %L, 'upload', now(), 'x', 'paused')$$, :'run', :'A', :'course', :'material'),
  'an upload may be paused');
select throws_ok(format($$insert into public.pipeline_runs (id, owner_id, course_id, material_id, kind, at, model, status) values (gen_random_uuid(), %L, %L, %L, 'upload', now(), 'x', 'queued')$$, :'A', :'course', :'material'),
  '23505', null, 'a paused run is still the material''s one run in flight');
select throws_ok(format($$insert into public.pipeline_runs (id, owner_id, course_id, material_id, kind, at, model, status) values (gen_random_uuid(), %L, %L, null, 'top-up', now(), 'x', 'paused')$$, :'A', :'course'),
  '23514', null, 'only uploads pause');
select lives_ok(format($$update public.pipeline_runs set status = 'queued' where id = %L$$, :'run'), 'a paused run resumes to queued');

select * from finish();
rollback;
