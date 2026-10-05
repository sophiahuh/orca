-- Course structure: pipeline runs, topics, objectives, relations, questions. Created by uploads
-- (the server) and edited by the student's review actions (the browser); both save through
-- save_structure() so a change lands whole or not at all. Nothing is deleted: archive or merge.
-- References inside a course are deferrable so one save can add rows in any order.

create table public.pipeline_runs (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  course_id uuid not null,
  material_id uuid not null,
  kind text not null check (kind in ('upload', 'top-up')),
  at timestamptz not null,
  model text not null,
  -- queued → running → done | failed; waiting = held by the daily processing limit.
  status text not null default 'done' check (status in ('queued', 'waiting', 'running', 'done', 'failed')),
  progress jsonb,
  job_id text,
  error text,
  topics_created uuid[] not null default '{}',
  objectives_created uuid[] not null default '{}',
  objectives_attached uuid[] not null default '{}',
  questions_added integer not null default 0 check (questions_added >= 0),
  -- [{ prompt, reason }]: questions that failed a check or duplicated one, with why.
  dropped jsonb not null default '[]' check (jsonb_typeof(dropped) = 'array'),
  unique (id, owner_id),
  foreign key (course_id, owner_id) references public.courses (id, owner_id) on delete cascade,
  foreign key (material_id, owner_id) references public.materials (id, owner_id) on delete cascade deferrable initially deferred,
  check ((status = 'failed') = (error is not null))
);
create index on public.pipeline_runs (owner_id);
create index on public.pipeline_runs (course_id);

create table public.topics (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  course_id uuid not null,
  -- Position on the trail (the course's topics are an ordered list).
  sort_order integer not null,
  name text not null check (length(trim(name)) > 0),
  aliases text[] not null default '{}',
  review text not null check (review in ('proposed', 'confirmed', 'archived')),
  merged_into uuid,
  material_id uuid,
  -- { candidateId, reasoning } when reconciliation couldn't tell whether it's a duplicate.
  uncertain jsonb,
  pos_x double precision not null,
  pos_y double precision not null,
  summary text,
  -- { filename, slideStart, slideEnd }
  source jsonb,
  created_at timestamptz not null default now(),
  unique (id, owner_id),
  unique (id, course_id),
  foreign key (course_id, owner_id) references public.courses (id, owner_id) on delete cascade,
  foreign key (merged_into, course_id) references public.topics (id, course_id) deferrable initially deferred,
  foreign key (material_id, owner_id) references public.materials (id, owner_id) deferrable initially deferred,
  check (merged_into is null or (merged_into <> id and review = 'archived'))
);
create index on public.topics (owner_id);
create index on public.topics (course_id);

create table public.objectives (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  course_id uuid not null,
  topic_id uuid not null,
  name text not null check (length(trim(name)) > 0),
  description text not null,
  aliases text[] not null default '{}',
  -- material: taught in an upload; inferred: general knowledge, no anchor; authored: by hand.
  origin text not null check (origin in ('material', 'inferred', 'authored')),
  review text not null check (review in ('proposed', 'confirmed', 'archived')),
  merged_into uuid,
  material_id uuid,
  run_id uuid,
  archived_with_topic boolean not null default false,
  uncertain jsonb,
  -- [ObjectiveSignal]: what each upload said about it; code computes the weight from these.
  signals jsonb not null default '[]' check (jsonb_typeof(signals) = 'array'),
  created_at timestamptz not null default now(),
  unique (id, owner_id),
  unique (id, course_id),
  foreign key (course_id, owner_id) references public.courses (id, owner_id) on delete cascade,
  foreign key (topic_id, course_id) references public.topics (id, course_id) deferrable initially deferred,
  foreign key (merged_into, course_id) references public.objectives (id, course_id) deferrable initially deferred,
  foreign key (material_id, owner_id) references public.materials (id, owner_id) deferrable initially deferred,
  foreign key (run_id, owner_id) references public.pipeline_runs (id, owner_id) deferrable initially deferred,
  check (merged_into is null or merged_into <> id)
);
create index on public.objectives (owner_id);
create index on public.objectives (course_id);
create index on public.objectives (topic_id);

create table public.relations (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  course_id uuid not null,
  from_objective uuid not null,
  to_objective uuid not null,
  type text not null check (type in ('builds-on', 'implies', 'contrasts-with', 'applies-to')),
  -- { locator, excerpt }
  anchor jsonb,
  review text not null check (review in ('proposed', 'confirmed', 'archived')),
  material_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (course_id, owner_id) references public.courses (id, owner_id) on delete cascade,
  foreign key (from_objective, course_id) references public.objectives (id, course_id) deferrable initially deferred,
  foreign key (to_objective, course_id) references public.objectives (id, course_id) deferrable initially deferred,
  foreign key (material_id, owner_id) references public.materials (id, owner_id) deferrable initially deferred,
  check (from_objective <> to_objective)
);
create index on public.relations (owner_id);
create index on public.relations (course_id);

create table public.questions (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  course_id uuid not null,
  -- The topic whose stock it's in (moves with an objective merge across topics).
  topic_id uuid not null,
  -- Order within the topic's stock ("unseen first, in stock order").
  sort_order integer not null,
  objective_id uuid,
  kind text not null check (kind in ('Multiple choice', 'True or false', 'Short answer')),
  tier text check (tier in ('retrieval', 'mechanism', 'application', 'connection', 'transfer')),
  -- The topic name shown on the quiz.
  topic_name text not null,
  prompt text not null,
  -- { headers, rows }: an inline truth table.
  "table" jsonb,
  options text[] not null default '{}',
  answer integer not null,
  exact text[],
  -- AnswerRubric for prose answers graded by a model.
  rubric jsonb,
  explanation text not null,
  -- { locator, excerpt }: required unless the objective is inferred (trigger below).
  anchor jsonb,
  -- { src, alt }
  figure jsonb,
  material_id uuid,
  created_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (course_id, owner_id) references public.courses (id, owner_id) on delete cascade,
  foreign key (topic_id, course_id) references public.topics (id, course_id) deferrable initially deferred,
  foreign key (objective_id, course_id) references public.objectives (id, course_id) deferrable initially deferred,
  foreign key (material_id, owner_id) references public.materials (id, owner_id) deferrable initially deferred,
  check ((kind = 'Short answer') = (answer = -1)),
  check (kind = 'Short answer' or cardinality(options) >= 2),
  check (kind <> 'Short answer' or exact is not null or rubric is not null)
);
create index on public.questions (owner_id);
create index on public.questions (course_id);
create index on public.questions (objective_id);

-- Course-specific questions carry a source anchor; questions for inferred objectives carry none
-- (they must not present themselves as course-specific). Checked at commit, so one save can add
-- an objective and its questions in any order.
create function private.check_question_anchor() returns trigger
language plpgsql set search_path = '' as $$
declare
  origin text;
begin
  select o.origin into origin from public.objectives o where o.id = new.objective_id;
  if origin = 'inferred' and new.anchor is not null then
    raise exception 'Question % is for an inferred objective and must not carry a source anchor', new.id
      using errcode = 'check_violation';
  elsif coalesce(origin, '') <> 'inferred' and new.anchor is null then
    raise exception 'Question % needs a source anchor into the course material', new.id
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

revoke execute on function private.check_question_anchor() from public, anon, authenticated;

create constraint trigger question_anchor after insert or update of anchor, objective_id on public.questions
  deferrable initially deferred for each row execute function private.check_question_anchor();

alter table public.pipeline_runs enable row level security;
alter table public.topics enable row level security;
alter table public.objectives enable row level security;
alter table public.relations enable row level security;
alter table public.questions enable row level security;

create policy "own runs: read" on public.pipeline_runs for select to authenticated using (owner_id = (select auth.uid()));
create policy "own runs: add" on public.pipeline_runs for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "own runs: change" on public.pipeline_runs for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy "own topics: read" on public.topics for select to authenticated using (owner_id = (select auth.uid()));
create policy "own topics: add" on public.topics for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "own topics: change" on public.topics for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy "own objectives: read" on public.objectives for select to authenticated using (owner_id = (select auth.uid()));
create policy "own objectives: add" on public.objectives for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "own objectives: change" on public.objectives for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy "own relations: read" on public.relations for select to authenticated using (owner_id = (select auth.uid()));
create policy "own relations: add" on public.relations for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "own relations: change" on public.relations for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy "own questions: read" on public.questions for select to authenticated using (owner_id = (select auth.uid()));
create policy "own questions: add" on public.questions for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "own questions: change" on public.questions for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

-- Save a change to one course's structure in one transaction, upserting rows by id. A key left
-- out of a row keeps the column's default on insert and its current value on update. Security
-- invoker: the browser runs it under RLS, jobs with the service role. The owner and course come
-- from the course row, never from the rows passed in, and a row that already belongs to another
-- course is refused.
--
-- rows: { "runs": [...], "topics": [...], "objectives": [...], "relations": [...], "questions": [...] }
-- with keys named as the table columns (owner_id, course_id and created_at are ignored).
create function public.save_structure(course uuid, rows jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  owner uuid;
  tbl text;
  list jsonb;
  item jsonb;
  cols text;
  sets text;
  moved uuid;
  found_row boolean;
  updated integer;
begin
  select c.owner_id into owner from public.courses c where c.id = course;
  if owner is null then
    raise exception 'No course %', course using errcode = 'no_data_found';
  end if;

  foreach tbl in array array['pipeline_runs', 'topics', 'objectives', 'relations', 'questions'] loop
    list := rows -> (case tbl when 'pipeline_runs' then 'runs' else tbl end);
    continue when list is null;
    if jsonb_typeof(list) <> 'array' then
      raise exception 'save_structure: % must be an array', tbl using errcode = 'invalid_parameter_value';
    end if;

    execute format(
      'select t.id from jsonb_array_elements($1) e join public.%I t on t.id = (e ->> ''id'')::uuid where t.course_id <> $2 limit 1', tbl)
      into moved using list, course;
    if moved is not null then
      raise exception '% row % belongs to another course', tbl, moved using errcode = 'check_violation';
    end if;

    for item in select * from jsonb_array_elements(list) loop
      if item ->> 'id' is null then
        raise exception 'save_structure: a % row has no id', tbl using errcode = 'invalid_parameter_value';
      end if;
      item := item || jsonb_build_object('owner_id', owner, 'course_id', course);
      select string_agg(quote_ident(a.attname), ', ' order by a.attnum),
             string_agg(format('%1$I = r.%1$I', a.attname), ', ' order by a.attnum)
                filter (where a.attname not in ('id', 'owner_id', 'course_id'))
        into cols, sets
        from pg_catalog.pg_attribute a
       where a.attrelid = format('public.%I', tbl)::regclass and a.attnum > 0 and not a.attisdropped
         and a.attname <> 'created_at' and item ? a.attname;
      -- Update when the row exists (only the given columns), insert otherwise. Not one
      -- INSERT ... ON CONFLICT: that checks NOT NULL on the insert attempt, so a partial update
      -- of an existing row would fail.
      found_row := false;
      if sets is not null then
        execute format(
          'update public.%1$I t set %2$s from jsonb_populate_record(null::public.%1$I, $1) r where t.id = r.id', tbl, sets)
          using item;
        -- FOUND isn't set by EXECUTE; the row count is.
        get diagnostics updated = row_count;
        found_row := updated > 0;
      end if;
      if not found_row then
        execute format(
          'insert into public.%1$I (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I, $1) on conflict (id) do nothing',
          tbl, cols)
          using item;
      end if;
    end loop;
  end loop;
end;
$$;

revoke execute on function public.save_structure(uuid, jsonb) from public, anon;
grant execute on function public.save_structure(uuid, jsonb) to authenticated, service_role;
