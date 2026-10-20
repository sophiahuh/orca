-- An unfinished session, saved after every question so it can be resumed (owner, 2026-10-19;
-- docs/superpowers/plans/2026-10-19-resume-sessions.md). One per student, course and kind; cleared
-- when the session finishes. Answers themselves are evidence, saved as they're graded.
create table public.session_progress (
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  course_id uuid not null,
  kind text not null check (kind in ('quick', 'deep')),
  session_id uuid not null,
  -- [{"questionId": …, "topicId": …}, …] in the order they're asked.
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  position integer not null check (position >= 0),
  correct integer not null default 0 check (correct >= 0),
  skipped integer not null default 0 check (skipped >= 0),
  ungraded integer not null default 0 check (ungraded >= 0),
  missed uuid[] not null default '{}',
  seconds integer not null default 0 check (seconds >= 0),
  title text not null check (char_length(title) <= 200),
  updated_at timestamptz not null default now(),
  primary key (owner_id, course_id, kind),
  foreign key (course_id, owner_id) references public.courses (id, owner_id) on delete cascade
);

alter table public.session_progress enable row level security;
create policy "own progress: read" on public.session_progress for select to authenticated using (owner_id = (select auth.uid()));
create policy "own progress: add" on public.session_progress for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "own progress: change" on public.session_progress for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "own progress: remove" on public.session_progress for delete to authenticated using (owner_id = (select auth.uid()));

-- The student's unfinished sessions come with the rest of their data.
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
    'question_feedback', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at, r.question_id) from public.question_feedback r where r.owner_id = (select auth.uid())), '[]'::jsonb),
    'session_progress', coalesce((select jsonb_agg(to_jsonb(r) order by r.updated_at) from public.session_progress r where r.owner_id = (select auth.uid())), '[]'::jsonb),
    'evidence', coalesce((select jsonb_agg(to_jsonb(r) order by r.at, r.id) from public.evidence_events r where r.owner_id = (select auth.uid())), '[]'::jsonb),
    'snapshots', coalesce((select jsonb_agg(to_jsonb(r) order by r.objective_id) from public.objective_state r where r.owner_id = (select auth.uid())), '[]'::jsonb));
$$;
