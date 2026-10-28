-- Removed material (2026-10-28): a status of its own, kept as a row so objectives can still point at it.
begin;
create extension if not exists pgtap with schema extensions;
select plan(2);

\set A aaaaaaaa-0000-4000-8000-000000000141
\set course c0000000-0000-4000-8000-000000000141
\set material d0000000-0000-4000-8000-000000000141

insert into auth.users (id, email) values (:'A', 'a14@example.com');
insert into public.courses (id, owner_id, slug, name, short, variant, pos_x, pos_y, review_config)
  values (:'course', :'A', 'ald', 'ALD', 'ALD', 'ald', 0, 0, '{}');
insert into public.materials (id, owner_id, course_id, filename, type, status) values (:'material', :'A', :'course', 'L01.pdf', 'Lecture', 'ready');

select lives_ok(format($$update public.materials set status = 'removed', storage_path = null, content_hash = null where id = %L$$, :'material'), 'a material can be marked removed');
select throws_ok(format($$update public.materials set status = 'gone' where id = %L$$, :'material'), '23514', null, 'other statuses are still refused');

select * from finish();
rollback;
