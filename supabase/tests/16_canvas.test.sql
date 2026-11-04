-- Canvas import (2026-11-04): connections and links are service-role only; one link per Canvas object.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

\set A aaaaaaaa-0000-4000-8000-000000000161

insert into auth.users (id, email) values (:'A', 'a16@example.com');

select lives_ok(format($$insert into public.canvas_connections (owner_id, base_url, token_enc) values (%L, 'https://courseworks2.columbia.edu', 'x')$$, :'A'), 'a connection can be stored');
select throws_ok(format($$insert into public.canvas_connections (owner_id, base_url, token_enc) values (%L, 'http://canvas.example/', 'x')$$, :'A'), '23514', null, 'the site is https with no path');
select lives_ok(format($$insert into public.canvas_links (owner_id, kind, canvas_id, orca_id) values (%L, 'file', '123', gen_random_uuid())$$, :'A'), 'a link can be stored');
select throws_ok(format($$insert into public.canvas_links (owner_id, kind, canvas_id, orca_id) values (%L, 'file', '123', gen_random_uuid())$$, :'A'), '23505', null, 'one link per Canvas object');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'A', 'role', 'authenticated')::text, true);
select is((select count(*) from public.canvas_connections) + (select count(*) from public.canvas_links), 0::bigint, 'the student''s own session sees neither');
reset role;

select * from finish();
rollback;
