-- Uploaded files: a private bucket where each student reads and writes only their own folder.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

\set A aaaaaaaa-0000-4000-8000-000000000001
\set B bbbbbbbb-0000-4000-8000-000000000002

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  select set_config('role', 'authenticated', true);
$$;

insert into auth.users (id, email) values (:'A', 'a@example.com'), (:'B', 'b@example.com');

select results_eq($$select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'materials'$$,
  $$values (false, 26214400::bigint, array['application/pdf', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'])$$, 'the materials bucket is private, 25 MB, PDF and .pptx only');

select pg_temp.act_as(:'A');
select lives_ok(format($$insert into storage.objects (bucket_id, name, owner_id) values ('materials', %L, %L)$$, :'A' || '/m1/L01.pdf', :'A'),
  'A uploads into their own folder');
select throws_ok(format($$insert into storage.objects (bucket_id, name, owner_id) values ('materials', %L, %L)$$, :'B' || '/m1/x.pdf', :'A'),
  '42501', null, 'A cannot upload into B''s folder');
select throws_ok(format($$insert into storage.objects (bucket_id, name, owner_id) values ('materials', 'loose.pdf', %L)$$, :'A'),
  '42501', null, 'A cannot upload outside a folder of their own');
select is((select count(*) from storage.objects where bucket_id = 'materials'), 1::bigint, 'A sees their file');
reset role;

select pg_temp.act_as(:'B');
select is((select count(*) from storage.objects where bucket_id = 'materials'), 0::bigint, 'B cannot see A''s file');
update storage.objects set name = :'B' || '/m1/L01.pdf' where bucket_id = 'materials';
reset role;
select is((select name from storage.objects where bucket_id = 'materials' and (name like :'A' || '/%' or name like :'B' || '/%')), :'A' || '/m1/L01.pdf', 'B cannot move A''s file');

set local role anon;
select is((select count(*) from storage.objects where bucket_id = 'materials'), 0::bigint, 'signed out sees no files');
reset role;

select * from finish();
rollback;
