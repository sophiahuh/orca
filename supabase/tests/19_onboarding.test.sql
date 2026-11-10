-- Onboarding tips (2026-11-10): profiles.onboarding starts empty, its owner can save it, a
-- malformed value is refused, and nobody else can change it.
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

\set A aaaaaaaa-0000-4000-8000-000000000191
\set B bbbbbbbb-0000-4000-8000-000000000191

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  select set_config('role', 'authenticated', true);
$$;

insert into auth.users (id, email) values (:'A', 'a19@example.com'), (:'B', 'b19@example.com');

select is((select onboarding from public.profiles where owner_id = :'A'), '{"seen":[],"skipped":false}'::jsonb,
  'a new profile has seen no tips and skipped none');

select pg_temp.act_as(:'A');
select lives_ok($$update public.profiles set onboarding = '{"seen":["add-course"],"skipped":true}'$$, 'A saves their own tips');
select throws_ok($$update public.profiles set onboarding = '{"seen":"all"}'$$, '23514', null, 'a malformed value is refused');

select pg_temp.act_as(:'B');
update public.profiles set onboarding = '{"seen":[],"skipped":false}' where owner_id = :'A';
reset role;
select is((select onboarding from public.profiles where owner_id = :'A'), '{"seen":["add-course"],"skipped":true}'::jsonb,
  'B can''t change A''s tips');

select * from finish();
rollback;
