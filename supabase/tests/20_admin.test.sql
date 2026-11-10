-- The admin view (2026-11-10): is_admin is false until the owner sets it in the database, a
-- student's own session can't change it (nor last_active_at), and the view's functions are the
-- server's alone.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

\set A aaaaaaaa-0000-4000-8000-000000000201
\set B bbbbbbbb-0000-4000-8000-000000000202
\set course c0000000-0000-4000-8000-000000000201

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  select set_config('role', 'authenticated', true);
$$;

insert into auth.users (id, email) values (:'A', 'a20@example.com'), (:'B', 'b20@example.com');
insert into public.courses (id, owner_id, slug, name, short, variant, pos_x, pos_y, review_config)
  values (:'course', :'A', 'ald', 'ALD', 'ALD', 'ald', 0, 0, '{}');

select is((select is_admin from public.profiles where owner_id = :'A'), false, 'a new account is not an admin');
select is((select last_active_at from public.profiles where owner_id = :'A'), null, 'and has not been seen yet');

/* ── a student can't promote themselves or fake being seen ── */

select pg_temp.act_as(:'A');
select throws_ok($$update public.profiles set is_admin = true where owner_id = auth.uid()$$, '42501', null, 'a student can''t set their own is_admin');
select throws_ok($$update public.profiles set last_active_at = now() where owner_id = auth.uid()$$, '42501', null, 'nor their own last_active_at');
select lives_ok($$update public.profiles set name = 'Ada' where owner_id = auth.uid()$$, 'they can still change the rest of their profile');
select is((select is_admin from public.profiles where owner_id = auth.uid()), false, 'and the flag stays false');
select throws_ok($$select public.admin_users()$$, '42501', null, 'the view''s functions aren''t theirs to call');
select throws_ok($$select public.admin_overview()$$, '42501', null, 'not even the overview');
reset role;

/* ── the owner sets it in the database; the server reads the view ── */

update public.profiles set is_admin = true where owner_id = :'A';
select is((select is_admin from public.profiles where owner_id = :'A'), true, 'the database role can set it');
update public.profiles set last_active_at = now() where owner_id = :'A';
select is((select count(*) from jsonb_array_elements(public.admin_users()) u where u ->> 'email' = 'a20@example.com' and (u ->> 'courses')::int = 1), 1::bigint,
  'admin_users lists the account with its email and course count');
select is((public.admin_overview() ->> 'users')::int, 2, 'admin_overview counts every profile');
select lives_ok(format($$insert into public.security_events (owner_id, kind, "check", quote) values (%L, 'admin_read', 'route', '/api/admin/users')$$, :'A'), 'an admin read is a security event');

select * from finish();
rollback;
