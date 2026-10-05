-- Questions for course material carry a source anchor; questions for inferred objectives carry
-- none (CLAUDE.md invariants). The check runs at commit; `set constraints ... immediate` runs it
-- now so each case can be tested inside this transaction.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

\set A aaaaaaaa-0000-4000-8000-000000000001
\set course c0000000-0000-4000-8000-00000000000a
\set topic f0000000-0000-4000-8000-00000000000a
\set obj 10000000-0000-4000-8000-00000000000a
\set inferred 10000000-0000-4000-8000-00000000000b

insert into auth.users (id, email) values (:'A', 'a@example.com');
insert into public.courses (id, owner_id, slug, name, short, variant, pos_x, pos_y, review_config, weights)
  values (:'course', :'A', 'ald', 'ALD', 'ALD', 'ald', 0, 0, '{}', '{}');
insert into public.topics (id, owner_id, course_id, sort_order, name, review, pos_x, pos_y)
  values (:'topic', :'A', :'course', 0, 'Boolean algebra', 'proposed', 0, 0);
insert into public.objectives (id, owner_id, course_id, topic_id, name, description, origin, review) values
  (:'obj', :'A', :'course', :'topic', 'Simplify', 'd', 'material', 'proposed'),
  (:'inferred', :'A', :'course', :'topic', 'De Morgan', 'd', 'inferred', 'proposed');
set constraints question_anchor immediate;

create function pg_temp.add_question(objective uuid, anchor jsonb) returns void language sql as $$
  insert into public.questions (id, owner_id, course_id, topic_id, sort_order, objective_id, kind, topic_name, prompt, options, answer, explanation, anchor)
  values (gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-00000000000a',
          'f0000000-0000-4000-8000-00000000000a', 0, objective, 'True or false', 'Boolean algebra', 'p', '{True,False}', 0, 'e', anchor);
$$;

select lives_ok(format($$select pg_temp.add_question(%L, '{"locator": "slide 3", "excerpt": "x"}')$$, :'obj'), 'a material objective''s question with an anchor is accepted');
select throws_ok(format($$select pg_temp.add_question(%L, null)$$, :'obj'), '23514', null, 'a material objective''s question without an anchor is refused');
select lives_ok(format($$select pg_temp.add_question(%L, null)$$, :'inferred'), 'an inferred objective''s question without an anchor is accepted');
select throws_ok(format($$select pg_temp.add_question(%L, '{"locator": "slide 3", "excerpt": "x"}')$$, :'inferred'), '23514', null, 'an inferred objective''s question with an anchor is refused');
select throws_ok($$select pg_temp.add_question(null, null)$$, '23514', null, 'a question with no objective needs an anchor');
select throws_ok(format($$update public.questions set anchor = null where objective_id = %L$$, :'obj'), '23514', null, 'removing an anchor later is refused too');

select * from finish();
rollback;
