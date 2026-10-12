-- Settings holds the student's defaults for new courses (owner, 2026-10-06): a review cadence and
-- material weights, copied into each course when it's created. Each course's own values stay on
-- the course and are edited from that course. Null means Orca's built-in defaults (DEFAULT_CONFIG,
-- DEFAULT_WEIGHTS in src/lib/data.ts). The profile's existing update policy covers these columns.
alter table public.profiles
  add column default_review_config jsonb check (default_review_config is null or jsonb_typeof(default_review_config) = 'object'),
  add column default_weights jsonb check (default_weights is null or jsonb_typeof(default_weights) = 'object');
