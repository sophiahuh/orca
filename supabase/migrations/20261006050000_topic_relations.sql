-- Relations connect topics, not objectives (owner, 2026-10-06): the Concept Atlas draws a course's
-- topics as nodes and these as its edges. Four kinds, `from` → `to`:
--   used-in         A is used in B (B builds on A); a topic used in more topics is drawn bigger
--   has-a-kind      A has a kind B (B is a kind of A)
--   alternative-to  A is an alternative to B (either can do the job; stored once, read both ways)
--   related         any other link worth drawing (an unlabelled edge)
-- Extraction proposes them between the new and existing topics of each upload. The old
-- objective-to-objective relations are dropped with their table: nothing reads them any more.
drop table public.relations;

create table public.relations (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  course_id uuid not null,
  from_topic uuid not null,
  to_topic uuid not null,
  type text not null check (type in ('used-in', 'has-a-kind', 'alternative-to', 'related')),
  -- { locator, excerpt }: where the material shows it
  anchor jsonb,
  review text not null check (review in ('proposed', 'confirmed', 'archived')),
  material_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (course_id, owner_id) references public.courses (id, owner_id) on delete cascade,
  foreign key (from_topic, course_id) references public.topics (id, course_id) deferrable initially deferred,
  foreign key (to_topic, course_id) references public.topics (id, course_id) deferrable initially deferred,
  foreign key (material_id, owner_id) references public.materials (id, owner_id) deferrable initially deferred,
  check (from_topic <> to_topic)
);
create index on public.relations (owner_id);
create index on public.relations (course_id);

alter table public.relations enable row level security;
create policy "own relations: read" on public.relations for select to authenticated using (owner_id = (select auth.uid()));
create policy "own relations: add" on public.relations for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "own relations: change" on public.relations for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
