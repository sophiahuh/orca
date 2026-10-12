-- Cost guard (Task 7c): model_usage and the rate-limit counters are the server's alone; the counter
-- is atomic and only the server may call it; one job runs at a time per student.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

\set A aaaaaaaa-0000-4000-8000-000000000081
\set B bbbbbbbb-0000-4000-8000-000000000082
\set course c0000000-0000-4000-8000-000000000081
\set m1 d0000000-0000-4000-8000-000000000081
\set m2 d0000000-0000-4000-8000-000000000082

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  select set_config('role', 'authenticated', true);
$$;

insert into auth.users (id, email) values (:'A', 'a8@example.com'), (:'B', 'b8@example.com');
insert into public.courses (id, owner_id, slug, name, short, variant, pos_x, pos_y, review_config, weights)
  values (:'course', :'A', 'ald', 'ALD', 'ALD', 'ald', 0, 0, '{}', '{}');
insert into public.materials (id, owner_id, course_id, filename, type) values (:'m1', :'A', :'course', 'L01.pdf', 'Lecture'), (:'m2', :'A', :'course', 'L02.pdf', 'Lecture');
-- The server's record of a call made for A.
insert into public.model_usage (owner_id, kind, model, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, cost_usd)
  values (:'A', 'upload', 'claude-opus-5-5', 1000, 200, 0, 0, 0.008);

-- Closed to students, their own rows included.
select pg_temp.act_as(:'A');
select is((select count(*) from public.model_usage), 0::bigint, 'A cannot read their own model usage');
select throws_ok(format($$insert into public.model_usage (owner_id, kind, model, input_tokens, output_tokens, cost_usd) values (%L, 'grade', 'x', 1, 1, 0)$$, :'A'),
  '42501', null, 'A cannot write model usage');
select is((select count(*) from public.rate_limits), 0::bigint, 'A cannot read the rate-limit counters');
select throws_ok(format($$insert into public.rate_limits (owner_id, action, window_start, count) values (%L, 'upload', now(), 0)$$, :'A'),
  '42501', null, 'A cannot write a counter');
select throws_ok(format($$select public.hit_rate_limit(%L, 'upload', 60, 20)$$, :'A'),
  '42501', null, 'A cannot call hit_rate_limit');
reset role;

set local role anon;
select throws_ok(format($$select public.hit_rate_limit(%L, 'upload', 60, 20)$$, :'A'), '42501', null, 'a signed-out caller cannot call hit_rate_limit');
reset role;

-- The counter, as the server calls it: counts up within a window, says no past the limit, and
-- keeps students and actions apart.
select is((public.hit_rate_limit(:'A', 'grade', 3600, 2)) ->> 'count', '1', 'the first hit counts 1');
select is((public.hit_rate_limit(:'A', 'grade', 3600, 2)) -> 'allowed', 'true'::jsonb, 'the second hit of two is allowed');
select is((public.hit_rate_limit(:'A', 'grade', 3600, 2)) -> 'allowed', 'false'::jsonb, 'the third is refused');
select ok(((public.hit_rate_limit(:'A', 'grade', 3600, 2)) ->> 'retry_after_seconds')::int between 1 and 3600, 'retry-after is within the window');
select is((public.hit_rate_limit(:'A', 'reflect', 3600, 2)) -> 'allowed', 'true'::jsonb, 'another action has its own count');
select is((public.hit_rate_limit(:'B', 'grade', 3600, 2)) -> 'allowed', 'true'::jsonb, 'another student has their own count');
select throws_ok($$select public.hit_rate_limit(null, 'grade', 60, 1)$$, 'P0001', 'hit_rate_limit: bad arguments', 'bad arguments are refused');

-- One running job per student.
insert into public.pipeline_runs (id, owner_id, course_id, material_id, kind, at, model, status)
  values (gen_random_uuid(), :'A', :'course', :'m1', 'upload', now(), 'claude-opus-5-5', 'running');
select throws_ok(format($$insert into public.pipeline_runs (id, owner_id, course_id, material_id, kind, at, model, status) values (gen_random_uuid(), %L, %L, %L, 'upload', now(), 'x', 'running')$$, :'A', :'course', :'m2'),
  '23505', null, 'a second running run for the same student is refused (it stays queued)');

select * from finish();
rollback;
