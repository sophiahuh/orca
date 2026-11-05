-- Weak points first (2026-11-05): confusion events are struggle flags with a source and an
-- optional page; old rows read as homework; answers carry neither.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

\set A aaaaaaaa-0000-4000-8000-000000000171
\set course c0000000-0000-4000-8000-000000000171
\set topic  e0000000-0000-4000-8000-000000000171
\set obj    f0000000-0000-4000-8000-000000000171
\set mat    d0000000-0000-4000-8000-000000000171

insert into auth.users (id, email) values (:'A', 'a17@example.com');
insert into public.courses (id, owner_id, slug, name, short, variant, pos_x, pos_y, review_config)
  values (:'course', :'A', 'ald', 'ALD', 'ALD', 'ald', 0, 0, '{}');
insert into public.topics (id, owner_id, course_id, name, review, sort_order, pos_x, pos_y) values (:'topic', :'A', :'course', 'Adders', 'confirmed', 0, 0, 0);
insert into public.objectives (id, owner_id, course_id, topic_id, name, description, origin, review)
  values (:'obj', :'A', :'course', :'topic', 'Explain carry-save', '', 'inferred', 'confirmed');
insert into public.materials (id, owner_id, course_id, filename, type) values (:'mat', :'A', :'course', 'w3.pdf', 'Lecture');

select has_column('public', 'evidence_events', 'flag_source', 'flag_source exists');
select has_column('public', 'evidence_events', 'page', 'page exists');

select lives_ok(format($$insert into public.evidence_events (id, owner_id, kind, at, course_id, topic_id, objective_id, material_id, note, flag_source)
  values ('b1000000-0000-4000-8000-000000000171', %L, 'confusion', now(), %L, %L, %L, %L, 'lost on carries', 'homework')$$, :'A', :'course', :'topic', :'obj', :'mat'),
  'a homework flag with its material and note');
select lives_ok(format($$insert into public.evidence_events (id, owner_id, kind, at, course_id, topic_id, objective_id, flag_source)
  values ('b2000000-0000-4000-8000-000000000171', %L, 'confusion', now(), %L, %L, %L, 'manual')$$, :'A', :'course', :'topic', :'obj'),
  'a manual flag needs no material and no note');
select lives_ok(format($$insert into public.evidence_events (id, owner_id, kind, at, course_id, topic_id, objective_id, material_id, flag_source, page)
  values ('b3000000-0000-4000-8000-000000000171', %L, 'confusion', now(), %L, %L, %L, %L, 'slide', 4)$$, :'A', :'course', :'topic', :'obj', :'mat'),
  'a slide flag names its page');
select throws_ok(format($$insert into public.evidence_events (id, owner_id, kind, at, course_id, topic_id, objective_id, flag_source)
  values ('b4000000-0000-4000-8000-000000000171', %L, 'confusion', now(), %L, %L, %L, 'slide')$$, :'A', :'course', :'topic', :'obj'),
  '23514', null, 'a slide flag needs its material');
select throws_ok(format($$insert into public.evidence_events (id, owner_id, kind, at, course_id, topic_id, objective_id, material_id, note)
  values ('b5000000-0000-4000-8000-000000000171', %L, 'confusion', now(), %L, %L, %L, %L, 'x')$$, :'A', :'course', :'topic', :'obj', :'mat'),
  '23514', null, 'a confusion row needs its source');
select throws_ok(format($$insert into public.evidence_events (id, owner_id, kind, at, course_id, topic_id, objective_id, question_id, outcome, grader, source, session_id, flag_source)
  values ('b6000000-0000-4000-8000-000000000171', %L, 'answer', now(), %L, %L, %L, 'a6000000-0000-4000-8000-000000000171', 'correct', 'choice', 'quiz', 's', 'manual')$$, :'A', :'course', :'topic', :'obj'),
  '23514', null, 'an answer carries no flag source');
select lives_ok(format($$insert into public.security_events (owner_id, kind, "check", quote) values (%L, 'marker_notes', 'p', 'x')$$, :'A'),
  'security_events accepts marker_notes (reserved for Plan B)');

-- A flag recorded before the objective had questions (no snapshot) is folded once a question arrives.
\set obj2 f1000000-0000-4000-8000-000000000171
insert into public.objectives (id, owner_id, course_id, topic_id, name, description, origin, review)
  values (:'obj2', :'A', :'course', :'topic', 'Explain ripple carry', '', 'inferred', 'confirmed');
insert into public.evidence_events (id, owner_id, kind, at, course_id, topic_id, objective_id, flag_source)
  values ('b7000000-0000-4000-8000-000000000171', :'A', 'confusion', now(), :'course', :'topic', :'obj2', 'manual');
select is((select count(*) from public.objective_state where objective_id = :'obj2'), 0::bigint, 'no snapshot while the objective has no questions');
insert into public.questions (id, owner_id, course_id, topic_id, sort_order, objective_id, kind, topic_name, prompt, options, answer, exact, explanation)
  values ('a7000000-0000-4000-8000-000000000171', :'A', :'course', :'topic', 0, :'obj2', 'Short answer', 'Adders', 'Why does carry ripple?', '{}', -1, '{"chain"}', 'Chain.');
select is((select stale from public.objective_state where objective_id = :'obj2'), true, 'its first question leaves a stale placeholder, so the next read folds the flag');

select * from finish();
rollback;
