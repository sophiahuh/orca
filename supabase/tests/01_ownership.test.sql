-- Two students, A and B. A builds a course through the same paths the app uses; B must not be
-- able to read, change or attach anything to it. Run as the database owner; `act_as` switches
-- to an API role the way PostgREST does (role + JWT claims).
begin;
create extension if not exists pgtap with schema extensions;
select plan(51);

\set A aaaaaaaa-0000-4000-8000-000000000001
\set B bbbbbbbb-0000-4000-8000-000000000002
\set course c0000000-0000-4000-8000-00000000000a
\set course2 c0000000-0000-4000-8000-00000000000b
\set material d0000000-0000-4000-8000-00000000000a
\set run e0000000-0000-4000-8000-00000000000a
\set topic f0000000-0000-4000-8000-00000000000a
\set topic2 f0000000-0000-4000-8000-00000000000b
\set obj 10000000-0000-4000-8000-00000000000a
\set inferred 10000000-0000-4000-8000-00000000000b
\set q 20000000-0000-4000-8000-00000000000a
\set qi 20000000-0000-4000-8000-00000000000b

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  select set_config('role', 'authenticated', true);
$$;

-- Sign-up creates the profile, with the browser's timezone when it's a real one.
insert into auth.users (id, email, raw_user_meta_data) values
  (:'A', 'a@example.com', '{"timezone": "America/New_York"}'),
  (:'B', 'b@example.com', '{"timezone": "Mars/Olympus_Mons"}');
select is((select timezone from public.profiles where owner_id = :'A'), 'America/New_York', 'sign-up creates a profile with the browser''s timezone');
select is((select timezone from public.profiles where owner_id = :'B'), 'UTC', 'an unknown timezone falls back to UTC');
-- The avatar and name from sign-up (Figma sync): a real creature is kept, anything else is the orca.
select is((select avatar from public.profiles where owner_id = :'A'), 'orca', 'no avatar in the metadata: the orca');
select is((select name from public.profiles where owner_id = :'A'), null, 'no name in the metadata: none');
insert into auth.users (id, email, raw_user_meta_data) values
  ('cccccccc-0000-4000-8000-000000000001', 'c@example.com', '{"avatar": "turtle", "name": "  Sophia  "}'),
  ('cccccccc-0000-4000-8000-000000000002', 'd@example.com', '{"avatar": "kraken", "name": ""}');
select is((select avatar || '/' || name from public.profiles where owner_id = 'cccccccc-0000-4000-8000-000000000001'), 'turtle/Sophia', 'the chosen creature and the trimmed name are kept');
select is((select avatar from public.profiles where owner_id = 'cccccccc-0000-4000-8000-000000000002'), 'orca', 'an unknown creature falls back to the orca');
select is((select name from public.profiles where owner_id = 'cccccccc-0000-4000-8000-000000000002'), null, 'an empty name is none');

-- A builds a course the way the app will.
select pg_temp.act_as(:'A');
select lives_ok(format($$insert into public.courses (id, slug, name, short, variant, pos_x, pos_y, review_config, weights)
  values (%L, 'ald', 'Advanced Logic Design', 'ALD', 'ald', 70, 110, '{}', '{}')$$, :'course'), 'A adds a course');
select lives_ok(format($$insert into public.materials (id, course_id, filename, type)
  values (%L, %L, 'L01.pdf', 'Lecture')$$, :'material', :'course'), 'A adds a material');
-- The upload's run is the server's (its job writes it); A's save hangs the structure off it.
reset role;
insert into public.pipeline_runs (id, owner_id, course_id, material_id, kind, at, model) values (:'run', :'A', :'course', :'material', 'upload', now(), 'stub');
select pg_temp.act_as(:'A');
select lives_ok(format($$select public.save_structure(%L, %L)$$, :'course', jsonb_build_object(
  'topics', jsonb_build_array(
    jsonb_build_object('id', :'topic', 'sort_order', 0, 'name', 'Boolean algebra', 'review', 'proposed', 'pos_x', 1, 'pos_y', 2, 'material_id', :'material', 'aliases', '[]'::jsonb),
    jsonb_build_object('id', :'topic2', 'sort_order', 1, 'name', 'Karnaugh maps', 'review', 'proposed', 'pos_x', 3, 'pos_y', 4, 'material_id', :'material', 'aliases', '[]'::jsonb)),
  'objectives', jsonb_build_array(
    jsonb_build_object('id', :'obj', 'topic_id', :'topic', 'name', 'Simplify expressions', 'description', 'd', 'origin', 'material', 'review', 'proposed', 'material_id', :'material', 'run_id', :'run', 'aliases', '[]'::jsonb, 'signals', '[]'::jsonb, 'archived_with_topic', false),
    jsonb_build_object('id', :'inferred', 'topic_id', :'topic', 'name', 'De Morgan', 'description', 'd', 'origin', 'inferred', 'review', 'proposed', 'material_id', :'material', 'run_id', :'run', 'aliases', '[]'::jsonb, 'signals', '[]'::jsonb, 'archived_with_topic', false)),
  'relations', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'from_topic', :'topic', 'to_topic', :'topic2', 'type', 'used-in', 'review', 'proposed', 'material_id', :'material')),
  'questions', jsonb_build_array(
    jsonb_build_object('id', :'q', 'topic_id', :'topic', 'sort_order', 0, 'objective_id', :'obj', 'kind', 'Short answer', 'topic_name', 'Boolean algebra', 'prompt', 'Simplify x + xy.', 'answer', -1, 'exact', jsonb_build_array('x'), 'explanation', 'e', 'anchor', jsonb_build_object('locator', 'slide 3', 'excerpt', 'x + xy = x'), 'material_id', :'material', 'options', '[]'::jsonb),
    jsonb_build_object('id', :'qi', 'topic_id', :'topic', 'sort_order', 1, 'objective_id', :'inferred', 'kind', 'True or false', 'topic_name', 'Boolean algebra', 'prompt', '(ab)'' = a'' + b''?', 'options', jsonb_build_array('True', 'False'), 'answer', 0, 'explanation', 'e'))
)), 'A saves a course structure through save_structure');
set constraints all immediate;
select pass('the saved structure satisfies every deferred check (anchors, references)');
set constraints all deferred;
select lives_ok(format($$insert into public.session_results (course_id, mode, session_id, correct, total, seconds) values (%L, 'quick', 's1', 1, 1, 30)$$, :'course'), 'A records a finished session');
select lives_ok(format($$insert into public.calendar_events (id, date, kind, title, course_id) values (gen_random_uuid(), '2026-10-20', 'exam', 'Midterm', %L)$$, :'course'), 'A adds a calendar entry');
select lives_ok($$update public.profiles set onboarded = true$$, 'A updates their profile');
select is((select name from public.topics where id = :'topic'), 'Boolean algebra', 'A reads their own structure');
select lives_ok(format($$select public.save_structure(%L, %L)$$, :'course', jsonb_build_object('topics', jsonb_build_array(jsonb_build_object('id', :'topic', 'name', 'Boolean algebra I')))),
  'a save can update just some columns of an existing row');
select results_eq(format($$select name, sort_order, pos_x, material_id from public.topics where id = %L$$, :'topic'),
  format($$values ('Boolean algebra I'::text, 0, 1::double precision, %L::uuid)$$, :'material'), 'columns left out of a save keep their values');

-- The evidence log: the browser can't write it at all.
select throws_ok(format($$insert into public.evidence_events (id, owner_id, kind, at, course_id, topic_id, objective_id, question_id, outcome, grader, source, session_id)
  values (gen_random_uuid(), %L, 'answer', now(), %L, %L, %L, %L, 'correct', 'exact', 'quiz', 's1')$$, :'A', :'course', :'topic', :'obj', :'q'),
  '42501', null, 'A cannot insert evidence directly');
reset role;
insert into public.evidence_events (id, owner_id, kind, at, course_id, topic_id, objective_id, question_id, outcome, grader, source, session_id)
  values ('30000000-0000-4000-8000-00000000000a', :'A', 'answer', now(), :'course', :'topic', :'obj', :'q', 'correct', 'exact', 'quiz', 's1');
insert into public.material_pages (owner_id, material_id, n, text) values (:'A', :'material', 1, 'x + xy = x');
select pg_temp.act_as(:'A');
select is((select count(*) from public.evidence_events), 1::bigint, 'A reads their evidence');
select throws_ok($$update public.evidence_events set outcome = 'incorrect'$$, '42501', null, 'A cannot change evidence');
select throws_ok($$delete from public.evidence_events$$, '42501', null, 'A cannot delete evidence');
select throws_ok($$update public.session_results set correct = 0$$, '42501', null, 'A cannot change a finished session');
select is((select count(*) from public.material_pages), 1::bigint, 'A reads their material''s pages');
select throws_ok(format($$insert into public.material_pages (owner_id, material_id, n, text) values (%L, %L, 2, 'p')$$, :'A', :'material'), '42501', null, 'pages are written by the server only');

-- A can't move a row into another course by saving it there.
select lives_ok(format($$insert into public.courses (id, slug, name, short, variant, pos_x, pos_y, review_config, weights)
  values (%L, 'signals', 'Signals', 'SIG', 'signals', 0, 0, '{}', '{}')$$, :'course2'), 'A adds a second course');
select throws_ok(format($$select public.save_structure(%L, %L)$$, :'course2', jsonb_build_object('topics', jsonb_build_array(
  jsonb_build_object('id', :'topic', 'sort_order', 0, 'name', 'Stolen', 'review', 'proposed', 'pos_x', 0, 'pos_y', 0, 'aliases', '[]'::jsonb)))),
  '23514', null, 'save_structure refuses a row that belongs to another course');

-- B sees none of it.
reset role;
select pg_temp.act_as(:'B');
select is((select count(*) from public.courses), 0::bigint, 'B sees no courses of A''s');
select is((select count(*) from public.materials), 0::bigint, 'B sees no materials of A''s');
select is((select count(*) from public.material_pages), 0::bigint, 'B sees no material pages of A''s');
select is((select count(*) from public.pipeline_runs), 0::bigint, 'B sees no pipeline runs of A''s');
select is((select count(*) from public.topics), 0::bigint, 'B sees no topics of A''s');
select is((select count(*) from public.objectives), 0::bigint, 'B sees no objectives of A''s');
select is((select count(*) from public.relations), 0::bigint, 'B sees no relations of A''s');
select is((select count(*) from public.questions), 0::bigint, 'B sees no questions of A''s');
select is((select count(*) from public.session_results), 0::bigint, 'B sees no sessions of A''s');
select is((select count(*) from public.calendar_events), 0::bigint, 'B sees no calendar entries of A''s');
select is((select count(*) from public.evidence_events), 0::bigint, 'B sees no evidence of A''s');
select is((select array_agg(owner_id) from public.profiles), array[:'B'::uuid], 'B sees only their own profile');

-- B can't change A's rows (RLS hides them, so the update touches nothing) ...
update public.courses set name = 'Hacked';
update public.profiles set timezone = 'UTC' where owner_id = :'A';
select lives_ok(format($$update public.questions set prompt = 'Hacked' where id = %L$$, :'q'), 'B''s update of A''s question runs but matches no row');
-- ... can't attach rows to A's course, whoever they claim owns them ...
select throws_ok(format($$insert into public.topics (id, course_id, sort_order, name, review, pos_x, pos_y) values (gen_random_uuid(), %L, 9, 'Mine', 'proposed', 0, 0)$$, :'course'),
  '23503', null, 'B cannot add a topic to A''s course as themselves');
select throws_ok(format($$insert into public.topics (id, owner_id, course_id, sort_order, name, review, pos_x, pos_y) values (gen_random_uuid(), %L, %L, 9, 'Mine', 'proposed', 0, 0)$$, :'A', :'course'),
  '42501', null, 'B cannot add a topic claiming to be A');
select throws_ok(format($$insert into public.calendar_events (id, date, kind, title, course_id) values (gen_random_uuid(), '2026-10-21', 'hw', 'x', %L)$$, :'course'),
  '23503', null, 'B cannot put a calendar entry on A''s course');
select throws_ok(format($$insert into public.session_results (course_id, mode, session_id, correct, total, seconds) values (%L, 'quick', 's', 0, 0, 0)$$, :'course'),
  '23503', null, 'B cannot record a session on A''s course');
-- ... and can't save structure into it.
select throws_ok(format($$select public.save_structure(%L, '{}')$$, :'course'), 'P0002', null, 'B cannot save structure into A''s course');
reset role;
select is((select name from public.courses where id = :'course'), 'Advanced Logic Design', 'A''s course is unchanged');
select is((select prompt from public.questions where id = :'q'), 'Simplify x + xy.', 'A''s question is unchanged');
select is((select timezone from public.profiles where owner_id = :'A'), 'America/New_York', 'A''s profile is unchanged');

-- Signed-out callers see nothing.
set local role anon;
select is((select count(*) from public.courses), 0::bigint, 'signed out sees no courses');
select throws_ok($$select public.save_structure('c0000000-0000-4000-8000-00000000000a', '{}')$$, '42501', null, 'signed out cannot call save_structure');
reset role;

-- Deleting an account removes everything of theirs.
delete from auth.users where id = :'A';
select is((select count(*) from public.courses where owner_id = :'A'), 0::bigint, 'deleting A removes their courses');
select is((select count(*) from public.evidence_events where owner_id = :'A'), 0::bigint, 'deleting A removes their evidence');

select * from finish();
rollback;
