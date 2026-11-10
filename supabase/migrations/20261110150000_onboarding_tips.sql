-- Onboarding tips (2026-11-10): which tips the student has seen and whether they skipped them all.
-- Kept on the account so another device doesn't replay them. The browser writes it under the
-- profile's own update policy, as it does the avatar. my_data() sends the whole profile row, so it
-- needs no change.
alter table public.profiles
  add column onboarding jsonb not null default '{"seen":[],"skipped":false}'::jsonb
  check (
    jsonb_typeof(onboarding) = 'object'
    and jsonb_typeof(onboarding -> 'seen') = 'array'
    and jsonb_typeof(onboarding -> 'skipped') = 'boolean'
    and pg_column_size(onboarding) < 4000
  );
