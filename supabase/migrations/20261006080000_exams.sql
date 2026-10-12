-- Exams (owner, 2026-10-06): each course's exams, with their dates and, optionally, the topics they
-- cover. They show on the calendar and set the exam-driven cadences ("1 wk before exam"). Until now
-- an exam was a calendar entry of kind 'exam'; the ones added by hand (no upload behind them) move
-- here. An uploaded past or practice exam's due date stays a calendar entry.
create table public.exams (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  course_id uuid not null,
  title text not null check (length(btrim(title)) between 1 and 120),
  date date not null,
  -- Topics it covers (may be empty). Not foreign keys: the app leaves out ids that are no longer live topics.
  topic_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  foreign key (course_id, owner_id) references public.courses (id, owner_id) on delete cascade
);
create index on public.exams (owner_id);
create index on public.exams (course_id, date);

alter table public.exams enable row level security;
create policy "own exams: read" on public.exams for select to authenticated using (owner_id = (select auth.uid()));
create policy "own exams: add" on public.exams for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "own exams: change" on public.exams for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "own exams: remove" on public.exams for delete to authenticated using (owner_id = (select auth.uid()));

insert into public.exams (id, owner_id, course_id, title, date, created_at)
  select id, owner_id, course_id, title, date, created_at from public.calendar_events
  where kind = 'exam' and material_id is null and course_id is not null;
delete from public.calendar_events where kind = 'exam' and material_id is null and course_id is not null;

-- The app's one consistent read gains the exams.
create or replace function public.my_data() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'profile', (select to_jsonb(p) from public.profiles p where p.owner_id = (select auth.uid())),
    'courses', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at, r.id) from public.courses r where r.owner_id = (select auth.uid())), '[]'::jsonb),
    'materials', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at, r.id) from public.materials r where r.owner_id = (select auth.uid())), '[]'::jsonb),
    'runs', coalesce((select jsonb_agg(to_jsonb(r) order by r.at, r.id) from public.pipeline_runs r where r.owner_id = (select auth.uid())), '[]'::jsonb),
    'topics', coalesce((select jsonb_agg(to_jsonb(r) order by r.course_id, r.sort_order, r.id) from public.topics r where r.owner_id = (select auth.uid())), '[]'::jsonb),
    'objectives', coalesce((select jsonb_agg(to_jsonb(r) order by r.course_id, r.created_at, r.id) from public.objectives r where r.owner_id = (select auth.uid())), '[]'::jsonb),
    'relations', coalesce((select jsonb_agg(to_jsonb(r) order by r.course_id, r.created_at, r.id) from public.relations r where r.owner_id = (select auth.uid())), '[]'::jsonb),
    'questions', coalesce((select jsonb_agg(to_jsonb(r) order by r.course_id, r.topic_id, r.sort_order, r.id) from public.questions r where r.owner_id = (select auth.uid())), '[]'::jsonb),
    'sessions', coalesce((select jsonb_agg(to_jsonb(r) order by r.finished_at, r.id) from public.session_results r where r.owner_id = (select auth.uid())), '[]'::jsonb),
    'calendar', coalesce((select jsonb_agg(to_jsonb(r) order by r.date, r.created_at, r.id) from public.calendar_events r where r.owner_id = (select auth.uid())), '[]'::jsonb),
    'exams', coalesce((select jsonb_agg(to_jsonb(r) order by r.course_id, r.date, r.created_at, r.id) from public.exams r where r.owner_id = (select auth.uid())), '[]'::jsonb),
    'evidence', coalesce((select jsonb_agg(to_jsonb(r) order by r.at, r.id) from public.evidence_events r where r.owner_id = (select auth.uid())), '[]'::jsonb),
    'snapshots', coalesce((select jsonb_agg(to_jsonb(r) order by r.objective_id) from public.objective_state r where r.owner_id = (select auth.uid())), '[]'::jsonb));
$$;
