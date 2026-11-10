-- The admin view (2026-11-10): an owner-only, read-only look at how every account uses Orca.
--
-- 1. `profiles.is_admin` says who may open /admin and /api/admin/*. Nothing in the app writes it:
--    the owner sets it by SQL in the Supabase dashboard (docs/SETUP-HOSTED.md §10). A student's
--    own session may change its profile under RLS (name, timezone, …) but never this column: the
--    trigger below refuses it, as `courses.deleted_at` is kept from the browser.
alter table public.profiles add column is_admin boolean not null default false;

-- 2. When the student was last seen: POST /api/heartbeat sets it for the verified user, at most
--    every few minutes while a signed-in tab is open. Only the server writes it.
alter table public.profiles add column last_active_at timestamptz;

create function private.profiles_keep_admin() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.is_admin is distinct from old.is_admin then
      raise exception 'is_admin is set only in the database, by the owner' using errcode = '42501';
    end if;
    if new.last_active_at is distinct from old.last_active_at then
      raise exception 'last_active_at is set by Orca''s server' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function private.profiles_keep_admin() from public, anon, authenticated;
create trigger keep_admin before update on public.profiles
  for each row execute function private.profiles_keep_admin();

-- 3. Every admin read is logged as a security event: kind `admin_read`, the route in `quote`.
alter table public.security_events drop constraint security_events_kind_check;
alter table public.security_events add constraint security_events_kind_check
  check (kind in ('upload', 'reflection_note', 'student_answer', 'generated', 'orca_notes', 'marker_notes', 'admin_read'));

-- 4. The view's figures, summed in the database so no page pulls whole tables. Service role only:
--    the server calls them after the admin gate (src/lib/server/admin.ts), and every one is revoked
--    from students. Days are UTC, as the cost log's queries count them (docs/COST-LOG.md).

-- The overview tiles.
create function public.admin_overview() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'courses', (select count(*) from public.courses where deleted_at is null),
    'uploads', (select count(*) from public.materials where status <> 'removed'),
    'spend_today', (select coalesce(sum(cost_usd), 0) from public.model_usage where at >= date_trunc('day', now())),
    'spend_7d', (select coalesce(sum(cost_usd), 0) from public.model_usage where at >= now() - interval '7 days'),
    'spend_all', (select coalesce(sum(cost_usd), 0) from public.model_usage),
    'answers_today', (select count(*) from public.evidence_events where kind = 'answer' and at >= date_trunc('day', now())),
    'open_runs', (select count(*) from public.pipeline_runs where status in ('queued', 'waiting', 'running')),
    'paused_runs', (select count(*) from public.pipeline_runs where status = 'paused')
  );
$$;
revoke execute on function public.admin_overview() from public, anon, authenticated;

-- One row per profile, with the account's email from auth.users and its counts.
create function public.admin_users() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.owner_id,
    'name', p.name,
    'email', u.email,
    'joined', p.created_at,
    'last_active', p.last_active_at,
    'is_admin', p.is_admin,
    'courses', (select count(*) from public.courses c where c.owner_id = p.owner_id and c.deleted_at is null),
    'uploads', (select count(*) from public.materials m where m.owner_id = p.owner_id and m.status <> 'removed'),
    'pages', (select count(*) from public.material_pages g where g.owner_id = p.owner_id),
    'answers', (select count(*) from public.evidence_events e where e.owner_id = p.owner_id and e.kind = 'answer'),
    'thumbs_down', (select count(*) from public.question_feedback f where f.owner_id = p.owner_id and f.rating = 'down'),
    'spend', (select coalesce(sum(x.cost_usd), 0) from public.model_usage x where x.owner_id = p.owner_id),
    'connector', exists (select 1 from public.connector_tokens t where t.owner_id = p.owner_id),
    'canvas', exists (select 1 from public.canvas_connections k where k.owner_id = p.owner_id)
  ) order by p.created_at, p.owner_id), '[]'::jsonb)
  from public.profiles p left join auth.users u on u.id = p.owner_id;
$$;
revoke execute on function public.admin_users() from public, anon, authenticated;

-- One student's courses, deleted ones included, with what each holds.
create function public.admin_user_courses(uid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'slug', c.slug,
    'created', c.created_at,
    'deleted', c.deleted_at,
    'topics', (select count(*) from public.topics t where t.course_id = c.id and t.merged_into is null),
    'objectives', (select count(*) from public.objectives o where o.course_id = c.id and o.merged_into is null),
    'questions', (select count(*) from public.questions q where q.course_id = c.id)
  ) order by c.created_at, c.id), '[]'::jsonb)
  from public.courses c where c.owner_id = uid;
$$;
revoke execute on function public.admin_user_courses(uuid) from public, anon, authenticated;

-- One student's uploads, newest first, each with its pages and its latest upload run and that run's spend.
create function public.admin_user_uploads(uid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id,
    'course', c.name,
    'filename', m.filename,
    'type', m.type,
    'status', m.status,
    'created', m.created_at,
    'pages', (select count(*) from public.material_pages g where g.material_id = m.id),
    'run', (select jsonb_build_object('id', r.id, 'status', r.status, 'at', r.at, 'error', r.error,
                                      'cost', (select coalesce(sum(x.cost_usd), 0) from public.model_usage x where x.run_id = r.id))
            from public.pipeline_runs r where r.material_id = m.id and r.kind = 'upload' order by r.at desc limit 1)
  ) order by m.created_at desc, m.id), '[]'::jsonb)
  from public.materials m join public.courses c on c.id = m.course_id where m.owner_id = uid;
$$;
revoke execute on function public.admin_user_uploads(uuid) from public, anon, authenticated;

-- Model spend: by day (the last `days`, newest first), and by kind and by model over all time; for
-- one student when `owner` is given, else for everyone. The same grouping as the cost log's query.
create function public.admin_spend(owner uuid default null, days integer default 30) returns jsonb
language sql stable security definer set search_path = '' as $$
  with mine as (
    select * from public.model_usage u where admin_spend.owner is null or u.owner_id = admin_spend.owner
  )
  select jsonb_build_object(
    'by_day', coalesce((
      select jsonb_agg(jsonb_build_object('day', to_char(d.day, 'YYYY-MM-DD'), 'calls', d.calls, 'usd', d.usd, 'tokens', d.tokens) order by d.day desc)
      from (
        select date_trunc('day', at) as day, count(*) as calls, sum(cost_usd) as usd,
               sum(input_tokens + output_tokens + cache_write_tokens + cache_read_tokens) as tokens
        from mine where at >= date_trunc('day', now()) - make_interval(days => greatest(admin_spend.days, 1) - 1)
        group by 1
      ) d), '[]'::jsonb),
    'by_kind', coalesce((
      select jsonb_agg(jsonb_build_object('kind', k.kind, 'calls', k.calls, 'usd', k.usd, 'tokens', k.tokens) order by k.usd desc, k.kind)
      from (
        select kind, count(*) as calls, sum(cost_usd) as usd, sum(input_tokens + output_tokens + cache_write_tokens + cache_read_tokens) as tokens
        from mine group by kind
      ) k), '[]'::jsonb),
    'by_model', coalesce((
      select jsonb_agg(jsonb_build_object('model', m.model, 'calls', m.calls, 'usd', m.usd, 'tokens', m.tokens) order by m.usd desc, m.model)
      from (
        select model, count(*) as calls, sum(cost_usd) as usd, sum(input_tokens + output_tokens + cache_write_tokens + cache_read_tokens) as tokens
        from mine group by model
      ) m), '[]'::jsonb)
  );
$$;
revoke execute on function public.admin_spend(uuid, integer) from public, anon, authenticated;

-- One student's evidence, newest first, a page at a time, with the course's and objective's names.
create function public.admin_user_evidence(uid uuid, lim integer default 200, off integer default 0) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.at desc, x.id), '[]'::jsonb) from (
    select e.id, e.at, e.kind, c.name as course, o.name as objective, e.outcome, e.grader, e.source, e.tier,
           e.note, e.flag_source, e.page, e.question_id
    from public.evidence_events e
    left join public.courses c on c.id = e.course_id
    left join public.objectives o on o.id = e.objective_id
    where e.owner_id = uid
    order by e.at desc, e.id
    limit greatest(least(lim, 500), 1) offset greatest(off, 0)
  ) x;
$$;
revoke execute on function public.admin_user_evidence(uuid, integer, integer) from public, anon, authenticated;

-- Question feedback with the question beside it, newest first, a page at a time: everyone's thumbs
-- down (optionally one reason), or one student's ratings of every kind.
create function public.admin_feedback(owner uuid default null, reason text default null, down_only boolean default true, lim integer default 100, off integer default 0) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc, x.question_id), '[]'::jsonb) from (
    select f.created_at, f.rating, f.reason, f.note, f.question_id, f.owner_id,
           q.prompt, q.kind, q.tier, q.deep, o.name as objective, c.name as course, u.email as student
    from public.question_feedback f
    join public.questions q on q.id = f.question_id
    left join public.objectives o on o.id = q.objective_id
    left join public.courses c on c.id = f.course_id
    left join auth.users u on u.id = f.owner_id
    where (admin_feedback.owner is null or f.owner_id = admin_feedback.owner)
      and (not admin_feedback.down_only or f.rating = 'down')
      and (admin_feedback.reason is null or f.reason = admin_feedback.reason)
    order by f.created_at desc, f.question_id
    limit greatest(least(lim, 500), 1) offset greatest(off, 0)
  ) x;
$$;
revoke execute on function public.admin_feedback(uuid, text, boolean, integer, integer) from public, anon, authenticated;

-- Thumbs up and down per course, across students.
create function public.admin_feedback_counts() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.downs desc, x.ups desc, x.course), '[]'::jsonb) from (
    select c.id as course_id, c.name as course, u.email as student,
           count(*) filter (where f.rating = 'up') as ups,
           count(*) filter (where f.rating = 'down') as downs
    from public.question_feedback f
    join public.courses c on c.id = f.course_id
    left join auth.users u on u.id = f.owner_id
    group by c.id, c.name, u.email
  ) x;
$$;
revoke execute on function public.admin_feedback_counts() from public, anon, authenticated;
