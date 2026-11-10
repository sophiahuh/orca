-- Cram mode (2026-11-10): work and signal evidence, help on an answer, a connector-struggled flag,
-- held-back materials, cramming exams with a scope, questions with a source, all read by my_data.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

\set A aaaaaaaa-0000-4000-8000-000000000191
\set course c0000000-0000-4000-8000-000000000191
\set topic  e0000000-0000-4000-8000-000000000191
\set obj    f0000000-0000-4000-8000-000000000191
\set mat    d0000000-0000-4000-8000-000000000191
\set exam   b0000000-0000-4000-8000-000000000191
\set q      a0000000-0000-4000-8000-000000000191

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  select set_config('role', 'authenticated', true);
$$;

insert into auth.users (id, email) values (:'A', 'a19@example.com');
insert into public.courses (id, owner_id, slug, name, short, variant, pos_x, pos_y, review_config)
  values (:'course', :'A', 'ald', 'ALD', 'ALD', 'ald', 0, 0, '{}');
insert into public.topics (id, owner_id, course_id, name, review, sort_order, pos_x, pos_y) values (:'topic', :'A', :'course', 'Adders', 'confirmed', 0, 0, 0);
insert into public.objectives (id, owner_id, course_id, topic_id, name, description, origin, review)
  values (:'obj', :'A', :'course', :'topic', 'Explain carry-save', '', 'inferred', 'confirmed');
insert into public.materials (id, owner_id, course_id, filename, type) values (:'mat', :'A', :'course', 'midterm-2025.pdf', 'Past exam');
insert into public.exams (id, owner_id, course_id, title, date, topic_ids) values (:'exam', :'A', :'course', 'Midterm', '2026-11-20', '{}');
insert into public.questions (id, owner_id, course_id, topic_id, sort_order, objective_id, kind, topic_name, prompt, options, answer, exact, explanation)
  values (:'q', :'A', :'course', :'topic', 0, :'obj', 'Short answer', 'Adders', 'Why is carry-save faster?', '{}', -1, '{"no ripple"}', 'No ripple.');

/* ── columns and defaults ── */

select is((select held_back from public.materials where id = :'mat'), false, 'held_back defaults to false');
select is((select cramming from public.exams where id = :'exam'), false, 'cramming defaults to false');
select is((select scope from public.exams where id = :'exam'), null, 'scope defaults to null');
select is((select source from public.questions where id = :'q'), 'orca', 'a question''s source defaults to orca');
select throws_ok(format($$update public.exams set scope = '"all"'::jsonb where id = %L$$, :'exam'), '23514', null, 'scope must be an object');
select throws_ok(format($$update public.questions set source = 'gpt' where id = %L$$, :'q'), '23514', null, 'source is orca or claude');
select lives_ok(format($$update public.exams set cramming = true, scope = '{"objectives": [], "sources": ["professor"]}'::jsonb where id = %L$$, :'exam'), 'an exam can be crammed for with a scope');

/* ── evidence ── */

select lives_ok(format($$insert into public.evidence_events (id, owner_id, kind, at, course_id, topic_id, objective_id, problem, basis, outcome, source, session_id, help, confidence, error_type)
  values ('b1000000-0000-4000-8000-000000000191', %L, 'work', now(), %L, %L, %L, 'Add 0110 and 0011 with a carry-save adder.', 'known-answer', 'partial', 'connector', 'claude', 'hint', 2, 'arithmetic')$$, :'A', :'course', :'topic', :'obj'),
  'a work row: a problem, its basis, an outcome, the connector session, and what Claude reported');
select throws_ok(format($$insert into public.evidence_events (id, owner_id, kind, at, course_id, topic_id, objective_id, basis, outcome, source, session_id)
  values ('b2000000-0000-4000-8000-000000000191', %L, 'work', now(), %L, %L, %L, 'claude', 'correct', 'connector', 'claude')$$, :'A', :'course', :'topic', :'obj'),
  '23514', null, 'a work row needs its problem');
select throws_ok(format($$insert into public.evidence_events (id, owner_id, kind, at, course_id, topic_id, objective_id, problem, basis, outcome, source, session_id)
  values ('b3000000-0000-4000-8000-000000000191', %L, 'work', now(), %L, %L, %L, 'p', 'claude', 'correct', 'quiz', 's')$$, :'A', :'course', :'topic', :'obj'),
  '23514', null, 'work comes only through the connector');
select lives_ok(format($$insert into public.evidence_events (id, owner_id, kind, at, course_id, topic_id, objective_id, signal, note, source, session_id)
  values ('b4000000-0000-4000-8000-000000000191', %L, 'signal', now(), %L, %L, %L, 'lost', 'went quiet after the second step', 'connector', 'claude')$$, :'A', :'course', :'topic', :'obj'),
  'a signal row: what the student did, in the connector session');
select throws_ok(format($$insert into public.evidence_events (id, owner_id, kind, at, course_id, topic_id, objective_id, source, session_id)
  values ('b5000000-0000-4000-8000-000000000191', %L, 'signal', now(), %L, %L, %L, 'connector', 'claude')$$, :'A', :'course', :'topic', :'obj'),
  '23514', null, 'a signal row needs its signal');
select throws_ok(format($$insert into public.evidence_events (id, owner_id, kind, at, course_id, topic_id, objective_id, signal, source, session_id, help)
  values ('b6000000-0000-4000-8000-000000000191', %L, 'signal', now(), %L, %L, %L, 'got-it', 'connector', 'claude', 'none')$$, :'A', :'course', :'topic', :'obj'),
  '23514', null, 'help belongs to answers and work only');
select lives_ok(format($$insert into public.evidence_events (id, owner_id, kind, at, course_id, topic_id, objective_id, question_id, outcome, grader, source, session_id, help, confidence)
  values ('b7000000-0000-4000-8000-000000000191', %L, 'answer', now(), %L, %L, %L, %L, 'correct', 'claude', 'connector', 'claude', 'none', 3)$$, :'A', :'course', :'topic', :'obj', :'q'),
  'an answer Claude graded against the key, with help and confidence');
select throws_ok(format($$insert into public.evidence_events (id, owner_id, kind, at, course_id, topic_id, objective_id, question_id, outcome, grader, source, session_id, help)
  values ('b8000000-0000-4000-8000-000000000191', %L, 'answer', now(), %L, %L, %L, %L, 'correct', 'choice', 'quiz', 's', 'lots')$$, :'A', :'course', :'topic', :'obj', :'q'),
  '23514', null, 'help is none, hint or shown');
select lives_ok(format($$insert into public.evidence_events (id, owner_id, kind, at, course_id, topic_id, objective_id, note, flag_source)
  values ('b9000000-0000-4000-8000-000000000191', %L, 'confusion', now(), %L, %L, %L, 'I keep losing the carry', 'connector-struggled')$$, :'A', :'course', :'topic', :'obj'),
  'a connector-struggled flag needs no material, like a connector flag');

/* ── my_data carries the new columns ── */

select pg_temp.act_as(:'A');
select is(public.my_data() -> 'materials' -> 0 ->> 'held_back', 'false', 'my_data returns held_back');
select is(public.my_data() -> 'exams' -> 0 ->> 'cramming', 'true', 'my_data returns cramming');
select is(public.my_data() -> 'exams' -> 0 -> 'scope' -> 'sources' ->> 0, 'professor', 'my_data returns scope');
select is(public.my_data() -> 'questions' -> 0 ->> 'source', 'orca', 'my_data returns a question''s source');
reset role;

select * from finish();
rollback;
