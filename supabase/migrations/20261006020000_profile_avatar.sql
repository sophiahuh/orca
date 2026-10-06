-- Figma sync (2026-10-06): the sign-up screen asks for a name and a "sea buddy" avatar (Header &
-- Nav Assets → Avatars; Screens → 13 · Sign up), and the top bar shows the avatar on every screen.
-- Both live on the profile. The avatar is one of five creatures; the name is optional.
alter table public.profiles
  add column name text check (name is null or length(name) between 1 and 80),
  add column avatar text not null default 'orca' check (avatar in ('orca', 'dolphin', 'octopus', 'turtle', 'jellyfish'));

-- Sign-up metadata carries them (like the timezone); anything unusable falls back, so sign-up
-- never fails over a decoration.
create or replace function private.create_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  tz text := coalesce(new.raw_user_meta_data ->> 'timezone', 'UTC');
  creature text := coalesce(new.raw_user_meta_data ->> 'avatar', 'orca');
  given_name text := nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'name', '')), 80), '');
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = tz) then
    tz := 'UTC';
  end if;
  if creature not in ('orca', 'dolphin', 'octopus', 'turtle', 'jellyfish') then
    creature := 'orca';
  end if;
  insert into public.profiles (owner_id, timezone, avatar, name) values (new.id, tz, creature, given_name);
  return new;
end;
$$;
