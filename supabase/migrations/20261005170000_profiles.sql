-- One profile per account, created when the account is. Holds what isn't course data: the
-- student's timezone (every day boundary uses it) and whether they finished onboarding.
create table public.profiles (
  owner_id uuid primary key references auth.users on delete cascade,
  -- An IANA name; an unknown one fails the cast below.
  timezone text not null default 'UTC' check ((now() at time zone timezone) is not null),
  onboarded boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create policy "own profile: read" on public.profiles for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "own profile: update" on public.profiles for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
-- No insert or delete: the trigger creates it and deleting the account removes it.

-- The browser sends its timezone as sign-up metadata; an unknown or missing one falls back to UTC
-- (the student can change it in Settings), so sign-up never fails over it.
create function private.create_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  tz text := coalesce(new.raw_user_meta_data ->> 'timezone', 'UTC');
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = tz) then
    tz := 'UTC';
  end if;
  insert into public.profiles (owner_id, timezone) values (new.id, tz);
  return new;
end;
$$;

revoke execute on function private.create_profile() from public, anon, authenticated;

create trigger create_profile after insert on auth.users
  for each row execute function private.create_profile();
