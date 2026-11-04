-- The Claude connector (2026-11-04): a student mints one secret link in Settings that Claude calls
-- as an MCP server. Only the token's hash is stored; the link itself is shown once.
create table public.connector_tokens (
  owner_id uuid primary key references auth.users on delete cascade,
  token_hash text not null unique check (length(token_hash) = 64),
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
-- Service role only: the browser never reads or writes tokens (no policies).
alter table public.connector_tokens enable row level security;

-- Answers Claude asks and grades through the connector are evidence of their own source.
alter table public.evidence_events drop constraint evidence_events_source_check;
alter table public.evidence_events add constraint evidence_events_source_check
  check (source in ('quiz', 'quick-review', 'deep-review', 'requiz', 'connector'));
