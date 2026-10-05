-- Uploads: a student can change what they said about a material, never the server's record of
-- the file (path, hash, status, hidden text), and never writes or sees another student's pages.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

\set A aaaaaaaa-0000-4000-8000-000000000001
\set B bbbbbbbb-0000-4000-8000-000000000002
\set course c0000000-0000-4000-8000-00000000000a
\set material d0000000-0000-4000-8000-00000000000a

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  select set_config('role', 'authenticated', true);
$$;

insert into auth.users (id, email) values (:'A', 'a@example.com'), (:'B', 'b@example.com');
insert into public.courses (id, owner_id, slug, name, short, variant, pos_x, pos_y, review_config, weights)
  values (:'course', :'A', 'ald', 'ALD', 'ALD', 'ald', 0, 0, '{}', '{}');
-- As the server leaves it after reading the file.
insert into public.materials (id, owner_id, course_id, filename, type, storage_path, content_hash, size_bytes, mime, status, hidden_text)
  values (:'material', :'A', :'course', 'L01.pdf', 'Lecture', :'A' || '/' || :'material' || '/L01.pdf', 'abc', 100, 'application/pdf', 'ready', '{"items": 2, "pages": [3]}');
insert into public.material_pages (owner_id, material_id, n, text) values (:'A', :'material', 1, 'Page one');

select throws_ok($$insert into public.materials (id, owner_id, course_id, filename, type, hidden_text)
  values (gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-00000000000a', 'x.pdf', 'Lecture', '{"items": "lots"}')$$,
  '23514', null, 'the hidden-text record has a fixed shape');

select pg_temp.act_as(:'A');
select lives_ok(format($$update public.materials set reflection = '{"at": "2026-10-05", "note": "n", "objectiveIds": []}', due = '2026-10-20' where id = %L$$, :'material'),
  'A changes their reflection and due date');
select throws_ok(format($$update public.materials set status = 'uploaded' where id = %L$$, :'material'), '42501', null, 'A cannot reset the reading status');
select throws_ok(format($$update public.materials set content_hash = 'other' where id = %L$$, :'material'), '42501', null, 'A cannot change the file''s hash');
select throws_ok(format($$update public.materials set storage_path = %L where id = %L$$, :'A' || '/' || :'material' || '/other.pdf', :'material'), '42501', null, 'A cannot repoint the file');
select throws_ok(format($$update public.materials set hidden_text = null where id = %L$$, :'material'), '42501', null, 'A cannot clear the hidden-text record');
select throws_ok(format($$insert into public.material_pages (material_id, n, text) values (%L, 2, 'planted')$$, :'material'), '42501', null, 'A cannot write pages (the server reads them)');
select is((select count(*) from public.material_pages), 1::bigint, 'A reads their pages');
reset role;

select pg_temp.act_as(:'B');
select is((select count(*) from public.material_pages), 0::bigint, 'B reads none of A''s pages');
reset role;

select * from finish();
rollback;
