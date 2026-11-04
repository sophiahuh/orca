-- The Claude connector (2026-11-04): tokens are service-role only, and 'connector' is an evidence source.
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

\set A aaaaaaaa-0000-4000-8000-000000000151
\set course c0000000-0000-4000-8000-000000000151
\set topic  e0000000-0000-4000-8000-000000000151
\set obj    f0000000-0000-4000-8000-000000000151

insert into auth.users (id, email) values (:'A', 'a15@example.com');
insert into public.courses (id, owner_id, slug, name, short, variant, pos_x, pos_y, review_config)
  values (:'course', :'A', 'ald', 'ALD', 'ALD', 'ald', 0, 0, '{}');
insert into public.topics (id, owner_id, course_id, name, review, sort_order, pos_x, pos_y) values (:'topic', :'A', :'course', 'Adders', 'confirmed', 0, 0, 0);
insert into public.objectives (id, owner_id, course_id, topic_id, name, description, origin, review)
  values (:'obj', :'A', :'course', :'topic', 'Explain carry-save', '', 'inferred', 'confirmed');
insert into public.questions (id, owner_id, course_id, topic_id, sort_order, objective_id, kind, topic_name, prompt, options, answer, exact, explanation)
  values ('a0000000-0000-4000-8000-000000000151', :'A', :'course', :'topic', 0, :'obj', 'Short answer', 'Adders', 'Why is carry-save faster?', '{}', -1, '{"no ripple"}', 'No ripple.');

select lives_ok(format($$insert into public.connector_tokens (owner_id, token_hash) values (%L, repeat('a', 64))$$, :'A'), 'a token hash can be stored');
select throws_ok(format($$insert into public.connector_tokens (owner_id, token_hash) values (%L, repeat('b', 64))$$, :'A'), '23505', null, 'one token per student');

-- The browser (an authenticated role) can't see tokens.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'A', 'role', 'authenticated')::text, true);
select is((select count(*) from public.connector_tokens), 0::bigint, 'tokens are invisible to the student''s own session');
reset role;

select lives_ok(format($$insert into public.evidence_events (id, owner_id, kind, at, course_id, topic_id, objective_id, question_id, outcome, grader, source, session_id)
  values ('b0000000-0000-4000-8000-000000000151', %L, 'answer', now(), %L, %L, %L, 'a0000000-0000-4000-8000-000000000151', 'correct', 'self', 'connector', 'claude')$$, :'A', :'course', :'topic', :'obj'),
  'connector is an evidence source');

select * from finish();
rollback;
