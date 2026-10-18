-- Thumbs up / down on questions (owner, 2026-10-18; docs/superpowers/plans/2026-10-18-question-feedback.md).
-- One rating per student per question; a later tap replaces it. A thumbs down hides the question from
-- that student's sessions. Owner-only like every table; Orca reads across students with the secret key.
create table public.question_feedback (
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  question_id uuid not null,
  course_id uuid not null,
  rating text not null check (rating in ('up', 'down')),
  -- Why, for a thumbs down (optional).
  reason text check (reason is null or reason in ('wrong-answer', 'unclear', 'too-easy', 'too-hard', 'not-my-course')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, question_id),
  foreign key (question_id, owner_id) references public.questions (id, owner_id) on delete cascade,
  foreign key (course_id, owner_id) references public.courses (id, owner_id) on delete cascade,
  check (rating = 'down' or reason is null)
);
create index on public.question_feedback (course_id);
create index on public.question_feedback (rating, created_at);

alter table public.question_feedback enable row level security;
create policy "own feedback: read" on public.question_feedback for select to authenticated using (owner_id = (select auth.uid()));
create policy "own feedback: add" on public.question_feedback for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "own feedback: change" on public.question_feedback for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "own feedback: remove" on public.question_feedback for delete to authenticated using (owner_id = (select auth.uid()));

-- The student's ratings come with the rest of their data.
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
    'evidence', coalesce((select jsonb_agg(to_jsonb(r) order by r.at, r.id) from public.evidence_events r where r.owner_id = (select auth.uid())), '[]'::jsonb),
    'snapshots', coalesce((select jsonb_agg(to_jsonb(r) order by r.objective_id) from public.objective_state r where r.owner_id = (select auth.uid())), '[]'::jsonb));
$$;
