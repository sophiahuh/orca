-- Snapshots (objective_state): who can read and write them, record_evidence's version check, and
-- the structure changes that mark them stale. Run as the database owner; `act_as` switches to an
-- API role the way PostgREST does.
begin;
create extension if not exists pgtap with schema extensions;
select plan(43);

\set A aaaaaaaa-0000-4000-8000-000000000001
\set B bbbbbbbb-0000-4000-8000-000000000002
\set course c0000000-0000-4000-8000-00000000000a
\set courseB c0000000-0000-4000-8000-00000000000b
\set topic f0000000-0000-4000-8000-00000000000a
\set topic2 f0000000-0000-4000-8000-00000000000b
\set o1 10000000-0000-4000-8000-000000000001
\set o2 10000000-0000-4000-8000-000000000002
\set o3 10000000-0000-4000-8000-000000000003
\set o4 10000000-0000-4000-8000-000000000004
\set q1 20000000-0000-4000-8000-000000000001
\set q2 20000000-0000-4000-8000-000000000002
\set q3 20000000-0000-4000-8000-000000000003
\set q4 20000000-0000-4000-8000-000000000004

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  select set_config('role', 'authenticated', true);
$$;
create function pg_temp.as_server() returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  select set_config('role', 'service_role', true);
$$;
create function pg_temp.answer(id uuid, question uuid, objective uuid) returns jsonb language sql as $$
  select jsonb_build_object('id', id, 'kind', 'answer', 'at', now(), 'course_id', 'c0000000-0000-4000-8000-00000000000a',
    'topic_id', 'f0000000-0000-4000-8000-00000000000a', 'objective_id', objective, 'question_id', question,
    'outcome', 'correct', 'grader', 'choice', 'source', 'quiz', 'session_id', 's1');
$$;
create function pg_temp.snap(objective uuid) returns table (stale boolean, version integer) language sql as $$
  select s.stale, s.version from public.objective_state s where s.objective_id = objective;
$$;

insert into auth.users (id, email) values (:'A', 'a@example.com'), (:'B', 'b@example.com');
insert into public.courses (id, owner_id, slug, name, short, variant, pos_x, pos_y, review_config, weights) values
  (:'course', :'A', 'ald', 'ALD', 'ALD', 'ald', 0, 0, '{}', '{}'),
  (:'courseB', :'B', 'ald', 'ALD', 'ALD', 'ald', 0, 0, '{}', '{}');
insert into public.topics (id, owner_id, course_id, sort_order, name, review, pos_x, pos_y) values
  (:'topic', :'A', :'course', 0, 'Boolean algebra', 'confirmed', 0, 0),
  (:'topic2', :'A', :'course', 1, 'K-maps', 'confirmed', 0, 0);
insert into public.objectives (id, owner_id, course_id, topic_id, name, description, origin, review) values
  (:'o1', :'A', :'course', :'topic', 'Simplify', 'd', 'inferred', 'confirmed'),
  (:'o2', :'A', :'course', :'topic', 'Simplify again', 'd', 'inferred', 'confirmed'),
  (:'o3', :'A', :'course', :'topic', 'De Morgan', 'd', 'inferred', 'confirmed'),
  (:'o4', :'A', :'course', :'topic2', 'Group cells', 'd', 'inferred', 'confirmed');
insert into public.questions (id, owner_id, course_id, topic_id, sort_order, objective_id, kind, tier, topic_name, prompt, options, answer, explanation) values
  (:'q1', :'A', :'course', :'topic', 0, :'o1', 'True or false', 'retrieval', 'Boolean algebra', 'p', '{True,False}', 0, 'e'),
  (:'q2', :'A', :'course', :'topic', 1, :'o2', 'True or false', 'retrieval', 'Boolean algebra', 'p', '{True,False}', 0, 'e'),
  (:'q3', :'A', :'course', :'topic', 2, :'o3', 'True or false', 'retrieval', 'Boolean algebra', 'p', '{True,False}', 0, 'e'),
  (:'q4', :'A', :'course', :'topic2', 0, :'o4', 'True or false', 'retrieval', 'K-maps', 'p', '{True,False}', 0, 'e');

/* ── Who may write ── */

select pg_temp.act_as(:'A');
select ok(not has_function_privilege('authenticated', 'public.record_evidence(uuid, jsonb, uuid, jsonb, integer, integer)', 'execute')
  and not has_function_privilege('anon', 'public.record_evidence(uuid, jsonb, uuid, jsonb, integer, integer)', 'execute'),
  'API roles cannot call record_evidence');
select ok(not has_function_privilege('authenticated', 'public.save_snapshot(uuid, uuid, jsonb, integer, integer)', 'execute')
  and not has_function_privilege('anon', 'public.save_snapshot(uuid, uuid, jsonb, integer, integer)', 'execute'),
  'API roles cannot call save_snapshot');
select throws_ok(format($$select public.record_evidence(%L, pg_temp.answer(gen_random_uuid(), %L, %L), %L, '{}', 1, 0)$$, :'A', :'q1', :'o1', :'o1'),
  '42501', null, 'A cannot record evidence through the function');
select throws_ok(format($$insert into public.objective_state (objective_id, owner_id, course_id, accumulator, rules_version) values (%L, %L, %L, '{}', 1)$$, :'o1', :'A', :'course'),
  '42501', null, 'A cannot write a snapshot');

/* ── record_evidence ── */

select pg_temp.as_server();
select is(public.record_evidence(:'A', pg_temp.answer('30000000-0000-4000-8000-000000000001', :'q1', :'o1'), :'o1', '{"answered": 1, "lastAt": "2026-10-05T12:00:00.000Z"}', 1, 0),
  true, 'the first answer creates the snapshot');
select results_eq(format($$select stale, version, rules_version, last_event_at from public.objective_state where objective_id = %L$$, :'o1'),
  $$values (false, 1, 1, '2026-10-05T12:00:00Z'::timestamptz)$$, 'the new snapshot is fresh at version 1, stamped with the accumulator''s last event');
select is((select count(*) from public.evidence_events), 1::bigint, 'and the event is in the log');
select is(public.record_evidence(:'A', pg_temp.answer('30000000-0000-4000-8000-000000000002', :'q1', :'o1'), :'o1', '{"answered": 2}', 1, 0),
  false, 'a writer that read "no snapshot yet" loses once one exists');
select is(public.record_evidence(:'A', pg_temp.answer('30000000-0000-4000-8000-000000000002', :'q1', :'o1'), :'o1', '{"answered": 2}', 1, 7),
  false, 'a writer that read an old version loses');
select is((select count(*) from public.evidence_events), 1::bigint, 'and a losing write adds no event');
select is(public.record_evidence(:'A', pg_temp.answer('30000000-0000-4000-8000-000000000002', :'q1', :'o1'), :'o1', '{"answered": 2}', 1, 1),
  true, 'a writer with the current version wins');
select results_eq(format($$select (accumulator ->> 'answered')::int, version from public.objective_state where objective_id = %L$$, :'o1'),
  $$values (2, 2)$$, 'the snapshot is overwritten and its version moves on');
select is(public.record_evidence(:'A', pg_temp.answer('30000000-0000-4000-8000-000000000003', :'q1', :'o1'), null, null, null, null),
  true, 'an event that counts for nothing is recorded without a snapshot');
select is((select count(*) from public.evidence_events), 3::bigint, 'it is in the log');
select throws_ok(format($$select public.record_evidence(%L, pg_temp.answer(gen_random_uuid(), %L, %L), %L, '{}', 1, 2)$$, :'B', :'q1', :'o1', :'o1'),
  '42501', null, 'evidence can''t be recorded into another student''s course');
select throws_ok(format($$select public.record_evidence(%L, pg_temp.answer(gen_random_uuid(), %L, %L) || '{"course_id": "%s"}', null, null, null, null)$$, :'A', :'q1', :'o1', :'courseB'),
  '42501', null, 'nor by naming their course in the event');
select is((select owner_id from public.evidence_events where id = '30000000-0000-4000-8000-000000000001'), :'A'::uuid, 'the owner comes from the parameter');
select throws_ok(format($$select public.record_evidence(%L, pg_temp.answer(gen_random_uuid(), %L, %L), %L, null, 1, 2)$$, :'A', :'q1', :'o1', :'o1'),
  '22023', null, 'a snapshot write needs an accumulator');

/* ── save_snapshot ── */

select is(public.save_snapshot(:'A', :'o1', '{"answered": 3}', 1, 1), false, 'a rebuild that read an old version is not saved');
select is(public.save_snapshot(:'B', :'o1', '{"answered": 3}', 1, 2), false, 'a rebuild for the wrong owner is not saved');
select is(public.save_snapshot(:'A', :'o1', '{"answered": 3}', 1, 2), true, 'a rebuild with the current version is saved');

/* ── Reads ── */

select pg_temp.act_as(:'A');
select is((select count(*) from public.objective_state), 1::bigint, 'A reads their snapshot');
select pg_temp.act_as(:'B');
select is((select count(*) from public.objective_state), 0::bigint, 'B reads none of A''s');
reset role;

/* ── Stale marks ── */

-- Give o2, o3 and o4 snapshots to watch.
select pg_temp.as_server();
select public.record_evidence(:'A', pg_temp.answer(gen_random_uuid(), :'q2', :'o2'), :'o2', '{"answered": 1}', 1, 0);
select public.record_evidence(:'A', pg_temp.answer(gen_random_uuid(), :'q3', :'o3'), :'o3', '{"answered": 1}', 1, 0);
select public.record_evidence(:'A', pg_temp.answer(gen_random_uuid(), :'q4', :'o4'), :'o4', '{"answered": 1}', 1, 0);

-- Changes made the way the browser makes them: save_structure under A's session.
select pg_temp.act_as(:'A');
select public.save_structure(:'course', jsonb_build_object('objectives', jsonb_build_array(jsonb_build_object('id', :'o2', 'name', 'Renamed', 'review', 'confirmed'))));
select is((select stale from pg_temp.snap(:'o2')), false, 'a save that renames an objective leaves its snapshot alone');

select public.save_structure(:'course', jsonb_build_object('objectives', jsonb_build_array(jsonb_build_object('id', :'o2', 'merged_into', :'o1', 'review', 'archived'))));
select results_eq(format($$select stale, version from pg_temp.snap(%L) union all select stale, version from pg_temp.snap(%L)$$, :'o2', :'o1'),
  $$values (true, 2), (true, 4)$$, 'a merge marks the loser and the winner stale and moves their versions');
select is((select stale from pg_temp.snap(:'o3')), false, 'objectives outside the merge are untouched');

-- Rebuild o1 and o2, then merge o1 into o3: the chain o2 → o1 → o3 is involved.
select pg_temp.as_server();
select public.save_snapshot(:'A', :'o1', '{}', 1, 4), public.save_snapshot(:'A', :'o2', '{}', 1, 2);
select pg_temp.act_as(:'A');
select public.save_structure(:'course', jsonb_build_object('objectives', jsonb_build_array(jsonb_build_object('id', :'o1', 'merged_into', :'o3', 'review', 'archived'))));
select results_eq(format($$select stale from pg_temp.snap(%L) union all select stale from pg_temp.snap(%L)$$, :'o1', :'o3'),
  $$values (true), (true)$$, 'merging further marks the old end and the new end of the chain');

select pg_temp.as_server();
select public.save_snapshot(:'A', :'o1', '{}', 1, (select version from pg_temp.snap(:'o1'))),
       public.save_snapshot(:'A', :'o3', '{}', 1, (select version from pg_temp.snap(:'o3')));
select pg_temp.act_as(:'A');
select public.save_structure(:'course', jsonb_build_object('objectives', jsonb_build_array(jsonb_build_object('id', :'o1', 'merged_into', null, 'review', 'confirmed'))));
select results_eq(format($$select stale from pg_temp.snap(%L) union all select stale from pg_temp.snap(%L)$$, :'o1', :'o3'),
  $$values (true), (true)$$, 'an un-merge marks both sides');

-- An objective that never had a snapshot gets a stale one when events may now count for it.
reset role;
insert into public.objectives (id, owner_id, course_id, topic_id, name, description, origin, review)
  values ('10000000-0000-4000-8000-000000000005', :'A', :'course', :'topic', 'New', 'd', 'inferred', 'confirmed');
select pg_temp.act_as(:'A');
select is((select count(*) from public.objective_state where objective_id = '10000000-0000-4000-8000-000000000005'), 0::bigint, 'a new objective has no snapshot');
select public.save_structure(:'course', jsonb_build_object('objectives', jsonb_build_array(
  jsonb_build_object('id', '10000000-0000-4000-8000-000000000005', 'merged_into', :'o4', 'review', 'archived'))));
select is((select count(*) from public.objective_state where objective_id = '10000000-0000-4000-8000-000000000005'), 1::bigint,
  'merging it creates a stale snapshot for it');
select results_eq($$select accumulator, rules_version, stale from public.objective_state where objective_id = '10000000-0000-4000-8000-000000000005'$$,
  $$values (null::jsonb, null::integer, true)$$, 'with no accumulator, plainly not a computed one');

-- Re-tagging a question moves its answers.
select pg_temp.as_server();
select public.save_snapshot(:'A', :'o4', '{}', 1, (select version from pg_temp.snap(:'o4'))),
       public.save_snapshot(:'A', :'o3', '{}', 1, (select version from pg_temp.snap(:'o3')));
select pg_temp.act_as(:'A');
select public.save_structure(:'course', jsonb_build_object('questions', jsonb_build_array(jsonb_build_object('id', :'q3', 'objective_id', :'o4', 'topic_id', :'topic2'))));
select results_eq(format($$select stale from pg_temp.snap(%L) union all select stale from pg_temp.snap(%L)$$, :'o3', :'o4'),
  $$values (true), (true)$$, 're-tagging a question marks its old and new objective');

-- Mechanism-tier questions: only the first and the last one matter.
select pg_temp.as_server();
select public.save_snapshot(:'A', :'o4', '{}', 1, (select version from pg_temp.snap(:'o4')));
select pg_temp.act_as(:'A');
select public.save_structure(:'course', jsonb_build_object('questions', jsonb_build_array(jsonb_build_object('id', :'q4', 'tier', 'retrieval'))));
select is((select stale from pg_temp.snap(:'o4')), false, 'a tier change that doesn''t touch mechanism leaves it alone');
select public.save_structure(:'course', jsonb_build_object('questions', jsonb_build_array(jsonb_build_object(
  'id', '20000000-0000-4000-8000-000000000005', 'topic_id', :'topic2', 'sort_order', 3, 'objective_id', :'o4', 'kind', 'True or false',
  'tier', 'mechanism', 'topic_name', 'K-maps', 'prompt', 'p', 'options', jsonb_build_array('True', 'False'), 'answer', 0, 'explanation', 'e'))));
select is((select stale from pg_temp.snap(:'o4')), true, 'the first mechanism-tier question marks its objective');
select pg_temp.as_server();
select public.save_snapshot(:'A', :'o4', '{}', 1, (select version from pg_temp.snap(:'o4')));
select pg_temp.act_as(:'A');
select public.save_structure(:'course', jsonb_build_object('questions', jsonb_build_array(jsonb_build_object('id', :'q4', 'tier', 'mechanism'))));
select is((select stale from pg_temp.snap(:'o4')), false, 'a second one doesn''t');
select public.save_structure(:'course', jsonb_build_object('questions', jsonb_build_array(jsonb_build_object('id', :'q4', 'tier', 'retrieval'))));
select is((select stale from pg_temp.snap(:'o4')), false, 'losing one of two doesn''t');
select public.save_structure(:'course', jsonb_build_object('questions', jsonb_build_array(jsonb_build_object('id', '20000000-0000-4000-8000-000000000005', 'tier', 'application'))));
select is((select stale from pg_temp.snap(:'o4')), true, 'losing the last one does');

-- Archiving a topic takes its objectives off the trail.
select pg_temp.as_server();
select public.save_snapshot(:'A', :'o4', '{}', 1, (select version from pg_temp.snap(:'o4')));
select pg_temp.act_as(:'A');
select public.save_structure(:'course', jsonb_build_object('topics', jsonb_build_array(jsonb_build_object('id', :'topic2', 'review', 'archived'))));
select is((select stale from pg_temp.snap(:'o4')), true, 'archiving a topic marks its objectives');
select is((select stale from pg_temp.snap(:'o2')) is not null, true, 'objectives elsewhere keep their rows');

-- Rejecting an objective (archive without merge).
select pg_temp.as_server();
select public.save_snapshot(:'A', :'o4', '{}', 1, (select version from pg_temp.snap(:'o4')));
select pg_temp.act_as(:'A');
select public.save_structure(:'course', jsonb_build_object('objectives', jsonb_build_array(jsonb_build_object('id', :'o4', 'review', 'archived'))));
select is((select stale from pg_temp.snap(:'o4')), true, 'archiving an objective marks it');

-- A timezone change moves day boundaries for every snapshot of that student.
select pg_temp.as_server();
update public.objective_state set stale = false where accumulator is not null;
select pg_temp.act_as(:'A');
update public.profiles set timezone = 'UTC';
select is((select count(*) from public.objective_state where stale and accumulator is not null), 0::bigint, 'saving the same timezone marks nothing');
update public.profiles set timezone = 'America/New_York';
select is((select count(*) from public.objective_state where not stale), 0::bigint, 'a new timezone marks every snapshot of the student stale');

-- A version a stale mark moved on can't be written by a writer that read it before the mark.
select pg_temp.as_server();
select is(public.save_snapshot(:'A', :'o1', '{}', 1, 1), false, 'a rebuild started before a stale mark is not saved');

select * from finish();
rollback;
