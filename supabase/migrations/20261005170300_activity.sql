-- What the student does: finished sessions, calendar entries, and the evidence log.

-- A finished session (QuizResult). "The last deep review" and quick-review cadence read these;
-- they can't be derived from answers alone. Written once, never changed.
create table public.session_results (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  course_id uuid not null,
  -- The topic for a topic quiz; null for a scheduled session.
  topic_id uuid,
  mode text not null check (mode in ('topic', 'quick', 'deep', 'requiz')),
  -- The session_id on this session's evidence.
  session_id text not null,
  correct integer not null check (correct >= 0),
  total integer not null check (total >= correct),
  seconds integer not null check (seconds >= 0),
  finished_at timestamptz not null default now(),
  foreign key (course_id, owner_id) references public.courses (id, owner_id) on delete cascade,
  foreign key (topic_id, course_id) references public.topics (id, course_id),
  check ((mode = 'topic') = (topic_id is not null))
);
create index on public.session_results (owner_id);
create index on public.session_results (course_id);

create table public.calendar_events (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  date date not null,
  kind text not null check (kind in ('hw', 'lab', 'rev', 'exam')),
  title text not null,
  course_id uuid,
  -- Set when the entry is an upload's due date.
  material_id uuid,
  created_at timestamptz not null default now(),
  foreign key (course_id, owner_id) references public.courses (id, owner_id) on delete cascade,
  foreign key (material_id, owner_id) references public.materials (id, owner_id) on delete cascade
);
create index on public.calendar_events (owner_id);

-- The append-only learner log. Every learner-facing state (objective status, topic progress,
-- island looks, what's due, the streak) is computed from it and the clock. Answers and
-- self-reported confusion share the table. Nobody updates or deletes a row; the browser can't
-- insert either: answers arrive through the server, which stamps the time and keeps the
-- objective's snapshot in step (Task 3).
create table public.evidence_events (
  id uuid primary key,
  owner_id uuid not null references auth.users on delete cascade,
  kind text not null check (kind in ('answer', 'confusion')),
  at timestamptz not null,
  course_id uuid not null,
  topic_id uuid not null,
  objective_id uuid not null,
  -- answer
  question_id uuid,
  tier text check (tier in ('retrieval', 'mechanism', 'application', 'connection', 'transfer')),
  outcome text check (outcome in ('correct', 'partial', 'incorrect')),
  grader text check (grader in ('choice', 'exact', 'rubric', 'self')),
  source text check (source in ('quiz', 'quick-review', 'deep-review', 'requiz')),
  session_id text,
  -- confusion
  material_id uuid,
  note text,
  foreign key (course_id, owner_id) references public.courses (id, owner_id) on delete cascade,
  foreign key (topic_id, course_id) references public.topics (id, course_id),
  foreign key (objective_id, course_id) references public.objectives (id, course_id),
  foreign key (question_id, owner_id) references public.questions (id, owner_id),
  foreign key (material_id, owner_id) references public.materials (id, owner_id),
  check (kind <> 'answer' or (question_id is not null and outcome is not null and grader is not null and source is not null and session_id is not null)),
  check (kind <> 'confusion' or (material_id is not null and note is not null and question_id is null))
);
create index on public.evidence_events (owner_id);
create index on public.evidence_events (course_id, at);
create index on public.evidence_events (objective_id, at);

alter table public.session_results enable row level security;
alter table public.calendar_events enable row level security;
alter table public.evidence_events enable row level security;

create policy "own sessions: read" on public.session_results for select to authenticated using (owner_id = (select auth.uid()));
create policy "own sessions: add" on public.session_results for insert to authenticated with check (owner_id = (select auth.uid()));

create policy "own calendar: read" on public.calendar_events for select to authenticated using (owner_id = (select auth.uid()));
create policy "own calendar: add" on public.calendar_events for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "own calendar: change" on public.calendar_events for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "own calendar: remove" on public.calendar_events for delete to authenticated using (owner_id = (select auth.uid()));

create policy "own evidence: read" on public.evidence_events for select to authenticated using (owner_id = (select auth.uid()));

-- Belt and braces on the log: even a future policy can't open these up for API roles.
revoke insert, update, delete, truncate on public.evidence_events from anon, authenticated;
revoke update, delete, truncate on public.session_results from anon, authenticated;
