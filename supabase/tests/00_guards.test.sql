-- Guards that hold for every table Orca adds: RLS on, an owner column, and nothing in `private`
-- reachable by API roles. They pass trivially until tables exist and keep later migrations honest.
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

select has_schema('private', 'the private schema exists');

select is(
  (select array_agg(tablename::text order by tablename) from pg_tables where schemaname = 'public' and not rowsecurity),
  null,
  'every table in public has row-level security enabled'
);

select is(
  (select array_agg(t.tablename::text order by t.tablename)
     from pg_tables t
    where t.schemaname = 'public'
      and not exists (
        select 1 from information_schema.columns c
         where c.table_schema = 'public' and c.table_name = t.tablename
           and c.column_name = 'owner_id' and c.is_nullable = 'NO')),
  null,
  'every table in public has a non-null owner_id'
);

select ok(
  not has_schema_privilege('authenticated', 'private', 'usage') and not has_schema_privilege('anon', 'private', 'usage'),
  'API roles cannot use the private schema'
);

select * from finish();
rollback;
