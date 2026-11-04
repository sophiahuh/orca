-- Canvas import (2026-11-04, docs/superpowers/plans/2026-11-04-canvas-import.md): a student's Canvas
-- site and access token (encrypted by the server; never read by the browser), and the Canvas objects
-- already imported, so importing again adds only what's new.
create table public.canvas_connections (
  owner_id uuid primary key references auth.users on delete cascade,
  base_url text not null check (base_url ~ '^https://[^/]+$'),
  token_enc text not null,
  canvas_user text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
alter table public.canvas_connections enable row level security;

create table public.canvas_links (
  owner_id uuid not null references auth.users on delete cascade,
  kind text not null check (kind in ('course', 'file', 'assignment', 'syllabus')),
  canvas_id text not null,
  orca_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, kind, canvas_id)
);
create index on public.canvas_links (owner_id, orca_id);
alter table public.canvas_links enable row level security;
