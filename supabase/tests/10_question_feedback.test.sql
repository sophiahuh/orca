-- Thumbs up / down on questions: one rating per student per question, owner-only, reasons only on a
-- thumbs down, and the student's ratings come back with my_data().
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

\set A aaaaaaaa-0000-4000-8000-000000000001
\set B bbbbbbbb-0000-4000-8000-000000000002
\set course c0000000-0000-4000-8000-00000000000a
\set topic f0000000-0000-4000-8000-00000000000a
\set q 90000000-0000-4000-8000-00000000000a

insert into auth.users (id, email) values (:'A', 'a@example.com'), (:'B', 'b@example.com');
insert into public.courses (id, owner_id, slug, name, short, variant, pos_x, pos_y, review_config)
  values (:'course', :'A', 'ald', 'ALD', 'ALD', 'ald', 0, 0, '{}');
insert into public.topics (id, owner_id, course_id, sort_order, name, review, pos_x, pos_y)
  values (:'topic', :'A', :'course', 0, 'Boolean algebra', 'proposed', 0, 0);
insert into public.objectives (id, owner_id, course_id, topic_id, name, description, origin, review)
  values ('10000000-0000-4000-8000-00000000000a', :'A', :'course', :'topic', 'Simplify', 'd', 'material', 'proposed');
insert into public.questions (id, owner_id, course_id, topic_id, sort_order, objective_id, kind, topic_name, prompt, options, answer, explanation, anchor)
  values (:'q', :'A', :'course', :'topic', 0, '10000000-0000-4000-8000-00000000000a', 'True or false', 'Boolean algebra', 'p', '{True,False}', 0, 'e', '{"locator": "slide 3", "excerpt": "x"}');

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
$$;

select pg_temp.act_as(:'A');
select lives_ok(format($$insert into public.question_feedback (question_id, course_id, rating, reason) values (%L, %L, 'down', 'unclear')$$, :'q', :'course'), 'a student rates their own question, with a reason');
select throws_ok(format($$insert into public.question_feedback (question_id, course_id, rating) values (%L, %L, 'up')$$, :'q', :'course'), '23505', null, 'one rating per question: a second is an update, not a new row');
select lives_ok(format($$update public.question_feedback set rating = 'up', reason = null where question_id = %L$$, :'q'), 'changing the rating');
select throws_ok(format($$update public.question_feedback set reason = 'unclear' where question_id = %L$$, :'q'), '23514', null, 'a reason only goes with a thumbs down');
select is((public.my_data() -> 'question_feedback' -> 0 ->> 'rating'), 'up', 'my_data returns the student''s ratings');
select lives_ok(format($$update public.question_feedback set rating = 'down', reason = 'wrong-answer', note = 'The key says 1011 but it should be 1010.' where question_id = %L$$, :'q'), 'a thumbs down can carry a note');
select throws_ok(format($$update public.question_feedback set rating = 'up', reason = null where question_id = %L$$, :'q'), '23514', null, 'a note only goes with a thumbs down');

reset role;
select pg_temp.act_as(:'B');
select is((select count(*) from public.question_feedback)::int, 0, 'another student sees none of them');
select throws_ok(format($$insert into public.question_feedback (question_id, course_id, rating) values (%L, %L, 'down')$$, :'q', :'course'), null, null, 'and can''t rate a question that isn''t theirs');

select * from finish();
rollback;
