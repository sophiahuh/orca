-- Opt-in protocol: additive until pipeline_enable is called after legacy workers are drained.
-- All worker writes are fenced in their committing transaction, not a preceding HTTP read.
alter table public.courses add column structure_revision bigint not null default 0;
alter table public.courses add column upload_sequence bigint not null default 0;
alter table public.pipeline_runs add column protocol_version integer not null default 1;
alter table public.pipeline_runs add column structure_committed_at timestamptz;
alter table public.pipeline_runs add column phase text;

create table public.pipeline_control (id boolean primary key default true check(id), enabled boolean not null default false);
insert into public.pipeline_control default values;
alter table public.pipeline_control enable row level security;

create table public.pipeline_items (
 id uuid primary key, batch_id uuid not null, owner_id uuid not null references auth.users on delete cascade,
 course_id uuid not null references public.courses on delete cascade, sequence bigint not null,
 source text not null check(source in ('browser','canvas','text','web')), name text not null,
 metadata jsonb not null default '{}', material_id uuid references public.materials on delete set null,
 run_id uuid references public.pipeline_runs on delete set null,
 state text not null default 'ingesting' check(state in ('ingesting','active','alias','failed','cancelled')),
 paused boolean not null default false, error text, expires_at timestamptz not null default now()+interval '15 minutes',
 created_at timestamptz not null default now(), unique(course_id,sequence)
);
create index on public.pipeline_items(owner_id,batch_id);
create table public.pipeline_tasks (
 id uuid primary key default gen_random_uuid(), run_id uuid not null references public.pipeline_runs on delete cascade,
 owner_id uuid not null references auth.users on delete cascade, course_id uuid not null references public.courses on delete cascade,
 material_id uuid not null references public.materials on delete cascade,
 phase text not null check(phase in ('prepare','structure','questions')),
 state text not null default 'queued' check(state in ('queued','dispatched','running','waiting','done','failed','cancelled')),
 epoch integer not null default 0, token uuid, lease_until timestamptz, started_at timestamptz, finished_at timestamptz, created_at timestamptz not null default now(),
 checkpoint jsonb, revision bigint, attempts integer not null default 0, error text,
 available_at timestamptz not null default now(), unique(run_id,phase)
);
create unique index pipeline_one_structure_per_course on public.pipeline_tasks(course_id) where phase='structure' and state in ('dispatched','running');
create index on public.pipeline_tasks(owner_id,state,available_at);
create table public.pipeline_results (
 task_id uuid not null references public.pipeline_tasks on delete cascade,
 input_hash text not null, result jsonb not null, primary key(task_id,input_hash)
);
create table public.pipeline_warmups (
 course_id uuid primary key references public.courses on delete cascade,
 run_id uuid not null references public.pipeline_runs on delete cascade, targets jsonb not null
);
create table public.pipeline_flag_intents (
 id uuid primary key, task_id uuid not null references public.pipeline_tasks on delete cascade,
 owner_id uuid not null references auth.users on delete cascade, event jsonb not null, recorded boolean not null default false
);
create table public.pipeline_question_claims (
 objective_id uuid not null references public.objectives on delete cascade, deep boolean not null,
 run_id uuid not null references public.pipeline_runs on delete cascade, owner_id uuid not null references auth.users on delete cascade,
 token uuid not null, need integer not null check(need>=0), baseline integer not null,
 lease_until timestamptz not null, primary key(objective_id,deep)
);
create table public.pipeline_call_reservations (
 id uuid primary key, owner_id uuid not null references auth.users on delete cascade,
 run_id uuid references public.pipeline_runs on delete set null, task_id uuid references public.pipeline_tasks on delete set null,
 task_token uuid, day_start timestamptz not null, utc_start timestamptz not null,
 tokens bigint not null, usd numeric not null, state text not null default 'active' check(state in ('active','settled','unknown')),
 lease_until timestamptz not null, created_at timestamptz not null default now()
);
create index on public.pipeline_call_reservations(owner_id,day_start);
create table public.pipeline_page_charges (
 owner_id uuid not null references auth.users on delete cascade, material_id uuid not null references public.materials on delete cascade,
 day_start timestamptz not null, pages integer not null, primary key(material_id,day_start)
);
create table public.pipeline_source_claims (
 owner_id uuid not null references auth.users on delete cascade, course_id uuid not null references public.courses on delete cascade,
 source_key text not null, item_id uuid not null references public.pipeline_items on delete cascade,
 primary key(owner_id,course_id,source_key)
);

-- Private checkpoints and budget records never have browser policies. Items are read-only to their owner.
alter table public.pipeline_items enable row level security;
create policy "read own pipeline items" on public.pipeline_items for select to authenticated using(owner_id=(select auth.uid()));
alter table public.pipeline_tasks enable row level security;
alter table public.pipeline_results enable row level security;
alter table public.pipeline_warmups enable row level security;
alter table public.pipeline_flag_intents enable row level security;
alter table public.pipeline_question_claims enable row level security;
alter table public.pipeline_call_reservations enable row level security;
alter table public.pipeline_page_charges enable row level security;
alter table public.pipeline_source_claims enable row level security;

create function private.pipeline_revision() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if TG_OP='UPDATE' and (to_jsonb(new)-'pos_x'-'pos_y'-'sort_order') = (to_jsonb(old)-'pos_x'-'pos_y'-'sort_order') then return new; end if;
 update public.courses set structure_revision=structure_revision+1 where id=coalesce(new.course_id,old.course_id);
 return coalesce(new,old);
end; $$;
create trigger pipeline_topics_revision after insert or update or delete on public.topics for each row execute function private.pipeline_revision();
create trigger pipeline_objectives_revision after insert or update or delete on public.objectives for each row execute function private.pipeline_revision();
create trigger pipeline_relations_revision after insert or update or delete on public.relations for each row execute function private.pipeline_revision();

-- Internal assertions lock the parent and course as well as the attempt. Stop/delete serialize with commits.
create function private.pipeline_task(payload jsonb) returns public.pipeline_tasks language plpgsql set search_path='' as $$
declare t public.pipeline_tasks; r public.pipeline_runs; m public.materials;
begin
 select * into t from public.pipeline_tasks where id=(payload->>'taskId')::uuid;
 if t.id is null or t.owner_id<>(payload->>'ownerId')::uuid or t.token is distinct from (payload->>'token')::uuid or t.state not in ('running','dispatched') or t.lease_until<now() then raise exception 'Stale pipeline attempt' using errcode='40001'; end if;
 perform 1 from public.courses where id=t.course_id and owner_id=t.owner_id and deleted_at is null for update;
 if not found then raise exception 'Course deleted' using errcode='40001'; end if;
 select * into r from public.pipeline_runs where id=t.run_id for update;
 select * into t from public.pipeline_tasks where id=t.id for update;
 if t.token is distinct from (payload->>'token')::uuid or t.state not in ('running','dispatched') or t.lease_until<now() then raise exception 'Stale pipeline attempt' using errcode='40001'; end if;
 select * into m from public.materials where id=t.material_id;
 if r.status in ('failed','done') or m.status<>'ready' or m.id is null then raise exception 'Pipeline cancelled or material removed' using errcode='40001'; end if;
 return t;
end; $$;

create function public.pipeline_enable(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.pipeline_control where id=true for update;
 if (payload->>'enabled')::boolean and exists(select 1 from public.pipeline_runs where protocol_version=1 and (status='running' or (status='queued' and started_at is not null))) then raise exception 'Drain legacy workers before enabling staged uploads'; end if;
 if (payload->>'enabled')::boolean then
  drop index if exists public.pipeline_runs_one_running_per_student;
  create unique index if not exists pipeline_runs_legacy_one_running on public.pipeline_runs(owner_id) where status='running' and kind<>'deep-review' and protocol_version=1;
 end if;
 update public.pipeline_control set enabled=(payload->>'enabled')::boolean where id=true;
 return jsonb_build_object('enabled',(payload->>'enabled')::boolean);
end; $$;

create function public.pipeline_admit(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.courses; e jsonb; item public.pipeline_items; result jsonb='[]'; b uuid=(payload->>'batchId')::uuid; o uuid=(payload->>'ownerId')::uuid;
begin
 if not (select enabled from public.pipeline_control) then raise exception 'Staged pipeline is not enabled'; end if;
 select * into c from public.courses where id=(payload->>'courseId')::uuid and owner_id=o and deleted_at is null for update;
 if c.id is null then raise exception 'No live course' using errcode='42501'; end if;
 if jsonb_array_length(payload->'items') not between 1 and 1000 then raise exception 'Invalid batch size'; end if;
 for e in select * from jsonb_array_elements(payload->'items') loop
  select * into item from public.pipeline_items where id=(e->>'id')::uuid;
  if item.id is not null then
   if item.owner_id<>o or item.course_id<>c.id or item.batch_id<>b then raise exception 'Admission belongs to another batch' using errcode='42501'; end if;
   if item.state='failed' and item.run_id is null and coalesce((e->'metadata'->>'retry')::boolean,false) then
    update public.pipeline_items set state='ingesting',error=null,expires_at=now()+interval '15 minutes',
     rate_charged=case when item.error like 'Daily upload limit%' then false else rate_charged end,
     material_id=case when exists(select 1 from public.materials where id=item.material_id and status='failed') then null else material_id end
     where id=item.id returning * into item;
   end if;
  else
   update public.courses set upload_sequence=upload_sequence+1 where id=c.id returning upload_sequence into c.upload_sequence;
   insert into public.pipeline_items(id,batch_id,owner_id,course_id,sequence,source,name,metadata) values((e->>'id')::uuid,b,o,c.id,c.upload_sequence,payload->>'source',left(e->>'name',255),coalesce(e->'metadata','{}')) returning * into item;
  end if;
  result=result||jsonb_build_array(jsonb_build_object('id',item.id,'sequence',item.sequence,'materialId',item.material_id,'runId',item.run_id,'state',item.state,'metadata',item.metadata));
 end loop;
 return jsonb_build_object('batchId',b,'items',result);
end; $$;

create function public.pipeline_ingestion(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.pipeline_items; k text=payload->>'action';
begin
 select * into i from public.pipeline_items where id=(payload->>'itemId')::uuid and owner_id=(payload->>'ownerId')::uuid for update;
 if i.id is null then raise exception 'No admission' using errcode='42501'; end if;
 if k='bind' and i.source='browser' and not i.rate_charged then raise exception 'Upload admission rate check incomplete' using errcode='42501'; end if;
 if k='renew' then
  update public.pipeline_items set expires_at=now()+interval '15 minutes' where batch_id=i.batch_id and owner_id=i.owner_id and state='ingesting';
 elsif k='fail' then
  update public.pipeline_items set state='failed',error=left(payload->>'error',500) where id=i.id and state='ingesting';
 elsif k='bind' then
  if not exists(select 1 from public.materials where id=(payload->>'materialId')::uuid and owner_id=i.owner_id and course_id=i.course_id and status<>'removed') then raise exception 'Wrong material' using errcode='42501'; end if;
  update public.pipeline_items set material_id=(payload->>'materialId')::uuid,expires_at=now()+interval '15 minutes' where id=i.id and state='ingesting';
 elsif k='retry' then
  update public.pipeline_items set state='ingesting',error=null,expires_at=now()+interval '15 minutes',rate_charged=case when i.error like 'Daily upload limit%' then false else rate_charged end where id=i.id and state='failed' and run_id is null;
 end if;
 return to_jsonb(i);
end; $$;

-- Canonicalize only after verifying Storage bytes. An alias releases its lane immediately.
create function public.pipeline_attach(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.pipeline_items; m public.materials; canonical uuid; rid uuid; existing public.pipeline_runs;
begin
 select * into i from public.pipeline_items where id=(payload->>'itemId')::uuid and owner_id=(payload->>'ownerId')::uuid for update;
 if i.id is null or i.state in ('failed','cancelled') then raise exception 'No active admission' using errcode='42501'; end if;
 if i.source='browser' and not i.rate_charged then raise exception 'Upload admission rate check incomplete' using errcode='42501'; end if;
 if i.run_id is not null then return jsonb_build_object('runId',i.run_id,'materialId',i.material_id,'alias',i.state='alias'); end if;
 select * into m from public.materials where id=(payload->>'materialId')::uuid and owner_id=i.owner_id and course_id=i.course_id and status='ready';
 if m.id is null then raise exception 'Material not ready'; end if;
 if not coalesce((i.metadata->>'again')::boolean,false) and m.content_hash is not null then
  insert into public.pipeline_source_claims values(i.owner_id,i.course_id,'hash:'||m.content_hash,i.id) on conflict do nothing;
  select item_id into canonical from public.pipeline_source_claims where owner_id=i.owner_id and course_id=i.course_id and source_key='hash:'||m.content_hash;
  if canonical<>i.id then
   select run_id into rid from public.pipeline_items where id=canonical;
   if rid is null then raise exception 'Canonical upload is being attached; retry' using errcode='40001'; end if;
   update public.pipeline_items set state='alias',material_id=(select material_id from public.pipeline_items where id=canonical),run_id=rid where id=i.id;
   return jsonb_build_object('runId',rid,'materialId',(select material_id from public.pipeline_items where id=canonical),'alias',true);
  end if;
 end if;
 select * into existing from public.pipeline_runs where material_id=m.id and status in ('queued','running','waiting','paused','done') order by at desc limit 1;
 if existing.id is not null then
  update public.pipeline_items set state='alias',material_id=m.id,run_id=existing.id where id=i.id;
  return jsonb_build_object('runId',existing.id,'materialId',m.id,'alias',true);
 end if;
 rid=gen_random_uuid();
 insert into public.pipeline_runs(id,owner_id,course_id,material_id,kind,at,model,status,protocol_version,phase) values(rid,i.owner_id,i.course_id,m.id,'upload',i.created_at,payload->>'model','queued',2,'prepare');
 update public.pipeline_items set state='active',material_id=m.id,run_id=rid where id=i.id;
 insert into public.pipeline_tasks(run_id,owner_id,course_id,material_id,phase) values(rid,i.owner_id,i.course_id,m.id,'prepare');
 return jsonb_build_object('runId',rid,'materialId',m.id,'alias',false);
end; $$;

create function public.pipeline_claim(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.pipeline_tasks; i public.pipeline_items; claim_token uuid=gen_random_uuid(); o uuid=(payload->>'ownerId')::uuid;
begin
 -- Serialize scheduler decisions per owner; a distinct course lease is backed by a unique index.
 perform pg_advisory_xact_lock(hashtextextended(o::text,31));
 if (select count(*) from public.pipeline_tasks where owner_id=o and state in ('dispatched','running') and lease_until>now())>=6 then return null; end if;
 update public.pipeline_items set state='failed',error='Upload interrupted. Send this file again.' where owner_id=o and state='ingesting' and expires_at<now();
 update public.pipeline_tasks set state='queued',epoch=epoch+1,token=null,available_at=now(),error='Worker interrupted; resuming checkpoint' where owner_id=o and state in ('dispatched','running') and lease_until<now();
 for t in select s.* from public.pipeline_tasks s join public.pipeline_items x on x.run_id=s.run_id and x.state='active' join public.pipeline_runs r on r.id=s.run_id join public.courses c on c.id=s.course_id
  where s.owner_id=o and s.state in ('queued','waiting') and s.available_at<=now() and not x.paused and r.status not in ('done','failed') and c.deleted_at is null
  order by case s.phase when 'questions' then 0 when 'structure' then 1 else 2 end,x.sequence loop
  perform 1 from public.courses where id=t.course_id and deleted_at is null for update;
  if not found then continue; end if;
  perform 1 from public.pipeline_runs where id=t.run_id and status not in ('done','failed') for update;
  if not found or exists(select 1 from public.pipeline_items where run_id=t.run_id and paused) then continue; end if;
  if t.phase='prepare' and (select count(*) from public.pipeline_tasks where owner_id=o and phase='prepare' and state in ('dispatched','running'))>=2 then continue; end if;
  if t.phase='structure' then
   if exists(select 1 from public.pipeline_tasks where course_id=t.course_id and phase='structure' and state in ('dispatched','running')) then continue; end if;
   select * into i from public.pipeline_items where run_id=t.run_id and state='active' limit 1;
   if exists(select 1 from public.pipeline_items a left join public.pipeline_runs ar on ar.id=a.run_id where a.course_id=t.course_id and a.sequence<i.sequence and not a.paused and a.state in ('ingesting','active') and (ar.id is null or (ar.structure_committed_at is null and ar.status<>'failed'))) then continue; end if;
  end if;
  update public.pipeline_tasks set state='dispatched',epoch=epoch+1,token=claim_token,lease_until=now()+interval '12 minutes',attempts=attempts+1 where id=t.id;
  update public.pipeline_runs set status='running',phase=t.phase,started_at=now(),error=null,progress=jsonb_build_object('stage',t.phase) where id=t.run_id;
  return jsonb_build_object('ownerId',o,'taskId',t.id,'token',claim_token);
 end loop;
 return null;
end; $$;

create function public.pipeline_task(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.pipeline_tasks;
begin
 t=private.pipeline_task(payload);
 update public.pipeline_tasks set state='running',lease_until=now()+interval '12 minutes',started_at=coalesce(started_at,now()) where id=t.id;
 return jsonb_build_object('ownerId',t.owner_id,'taskId',t.id,'token',t.token,'runId',t.run_id,'courseId',t.course_id,'materialId',t.material_id,'phase',t.phase,'checkpoint',t.checkpoint,'attempt',t.attempts,'revision',t.revision);
end; $$;

create function public.pipeline_checkpoint(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.pipeline_tasks; e jsonb;
begin
 t=private.pipeline_task(payload);
 update public.pipeline_tasks set lease_until=now()+interval '12 minutes',checkpoint=coalesce(payload->'checkpoint',checkpoint) where id=t.id;
 update public.pipeline_question_claims set lease_until=now()+interval '12 minutes' where run_id=t.run_id and token=t.token;
 if payload ? 'progress' then update public.pipeline_runs set progress=payload->'progress' where id=t.run_id; end if;
 if payload ? 'pages' then
  for e in select * from jsonb_array_elements(payload->'pages') loop
   update public.material_pages set text=e->>'text',source=payload->>'source' where owner_id=t.owner_id and material_id=t.material_id and n=(e->>'n')::integer;
  end loop;
 end if;
 if payload ? 'inputHash' then insert into public.pipeline_results values(t.id,payload->>'inputHash',payload->'result') on conflict do nothing; end if;
 return '{}';
end; $$;

create function public.pipeline_finish(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.pipeline_tasks; next_phase text;
begin
 t=private.pipeline_task(payload);
 update public.pipeline_tasks set state='done',finished_at=now(),checkpoint=coalesce(payload->'checkpoint',checkpoint),lease_until=null where id=t.id;
 if t.phase='prepare' then next_phase='structure'; end if;
 if next_phase is not null then
  insert into public.pipeline_tasks(run_id,owner_id,course_id,material_id,phase,checkpoint) values(t.run_id,t.owner_id,t.course_id,t.material_id,next_phase,payload->'checkpoint') on conflict do nothing;
  update public.pipeline_runs set status=case when exists(select 1 from public.pipeline_items where run_id=t.run_id and paused) then 'paused' else 'queued' end,phase=next_phase,progress=jsonb_build_object('stage',next_phase) where id=t.run_id;
 else
  update public.pipeline_runs set status='done',phase='done',progress=null where id=t.run_id;
 end if;
 return '{}';
end; $$;

create function public.pipeline_fail(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.pipeline_tasks; waiting boolean=coalesce((payload->>'waiting')::boolean,false);
begin
 t=private.pipeline_task(payload);
 delete from public.pipeline_question_claims where run_id=t.run_id and token=t.token;
 update public.pipeline_tasks set state=case when waiting then 'waiting' else 'failed' end,error=left(payload->>'error',800),available_at=now()+interval '1 minute',lease_until=null where id=t.id;
 update public.pipeline_runs set status=case when waiting then 'waiting' else 'failed' end,error=left(payload->>'error',800),progress=case when waiting then jsonb_build_object('stage','waiting','message',payload->>'error') else null end where id=t.run_id;
 return '{}';
end; $$;


alter table public.pipeline_runs add column execution_token uuid;
-- Serialize browser edits and worker commits; preserve existing authorization of save_structure.
alter function public.save_structure(uuid,jsonb) rename to save_structure_rows;
revoke all on function public.save_structure_rows(uuid,jsonb) from public,anon,authenticated;
create function public.save_structure(course uuid, rows jsonb) returns void language plpgsql security definer set search_path='' as $$
declare c public.courses; trusted boolean=coalesce(auth.role(),'')='service_role' or (session_user in ('postgres','supabase_admin') and current_setting('role') not in ('authenticated','anon'));
begin
 select * into c from public.courses where id=course and deleted_at is null for update;
 if c.id is null or (not trusted and c.owner_id is distinct from auth.uid()) then raise exception 'No such course' using errcode='P0002'; end if;
 if exists(select 1 from jsonb_array_elements(coalesce(rows->'runs','[]')) e join public.pipeline_runs r on r.id=(e->>'id')::uuid where r.protocol_version=2) then raise exception 'Staged workers must use fenced commits' using errcode='42501'; end if;
 -- Browser may not write run records, even through this security-definer wrapper.
 if not trusted and jsonb_array_length(coalesce(rows->'runs','[]'))>0 then raise exception 'Run records are server-owned' using errcode='42501'; end if;
 perform public.save_structure_rows(course,rows);
end; $$;
revoke all on function public.save_structure(uuid,jsonb) from public,anon;
grant execute on function public.save_structure(uuid,jsonb) to authenticated,service_role;

create function public.pipeline_snapshot(payload jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.courses;
begin
 select * into c from public.courses where id=(payload->>'courseId')::uuid and owner_id=(payload->>'ownerId')::uuid and deleted_at is null;
 if c.id is null then raise exception 'No course' using errcode='42501'; end if;
 return jsonb_build_object('revision',c.structure_revision,'course',to_jsonb(c),'structure',public.course_structure(c.id,c.owner_id),
 'topics',coalesce((select jsonb_agg(to_jsonb(t)) from public.topics t where t.course_id=c.id),'[]'),
 'objectives',coalesce((select jsonb_agg(to_jsonb(t)) from public.objectives t where t.course_id=c.id),'[]'),
 'relations',coalesce((select jsonb_agg(to_jsonb(t)) from public.relations t where t.course_id=c.id),'[]'),
 'questions',coalesce((select jsonb_agg(to_jsonb(t)) from public.questions t where t.course_id=c.id),'[]'));
end; $$;

create function public.pipeline_commit_structure(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.pipeline_tasks; c public.courses; targets jsonb='[]'; warm jsonb=coalesce(payload->'warmup','[]'); e jsonb;
begin
 -- An already committed attempt is safe to acknowledge after its lease was released.
 select * into t from public.pipeline_tasks where id=(payload->>'taskId')::uuid;
 if t.state='done' and t.token=(payload->>'token')::uuid and t.owner_id=(payload->>'ownerId')::uuid then return '{}'; end if;
 t=private.pipeline_task(payload);
 select * into c from public.courses where id=t.course_id for update;
 if c.structure_revision<>(payload->>'revision')::bigint then raise exception 'Course edited during extraction' using errcode='40001'; end if;
 if t.phase<>'structure' then raise exception 'Wrong pipeline phase'; end if;
 if jsonb_array_length(warm)>10 then raise exception 'Warm-up is limited to ten objectives'; end if;
 perform public.save_structure_rows(t.course_id,(payload->'rows')-'runs'-'questions');
 targets=coalesce(payload->'targets','[]');
 if jsonb_array_length(warm)>0 and not exists(select 1 from public.questions where course_id=t.course_id) then
  insert into public.pipeline_warmups values(t.course_id,t.run_id,warm) on conflict do nothing;
  if found then targets=targets||warm; end if;
 end if;
 for e in select * from jsonb_array_elements(coalesce(payload->'flags','[]')) loop
  insert into public.pipeline_flag_intents(id,task_id,owner_id,event) values((e->>'id')::uuid,t.id,t.owner_id,e) on conflict do nothing;
 end loop;
 update public.pipeline_tasks set state='done',finished_at=now(),lease_until=null,checkpoint=payload->'plan' where id=t.id;
 update public.pipeline_runs set structure_committed_at=now(),status='queued',phase='questions',progress=jsonb_build_object('stage','questions'),
  topics_created=array(select jsonb_array_elements_text(coalesce(payload->'summary'->'topics','[]')))::uuid[],
  objectives_created=array(select jsonb_array_elements_text(coalesce(payload->'summary'->'objectives','[]')))::uuid[],
  objectives_attached=array(select jsonb_array_elements_text(coalesce(payload->'summary'->'attached','[]')))::uuid[],
  dropped=coalesce(payload->'summary'->'dropped','[]'), security=payload->'summary'->'security' where id=t.run_id;
 insert into public.pipeline_tasks(run_id,owner_id,course_id,material_id,phase,checkpoint) values(t.run_id,t.owner_id,t.course_id,t.material_id,'questions',jsonb_build_object('targets',targets)) on conflict do nothing;
 return '{}';
end; $$;

create function private.pipeline_canonical(objective uuid) returns uuid language plpgsql stable set search_path='' as $$
declare n uuid; k integer=0;
begin
 loop
  select merged_into into n from public.objectives where id=objective;
  if n is null then return objective; end if;
  objective=n; k=k+1;
  if k>50 then raise exception 'Objective merge cycle'; end if;
 end loop;
end; $$;
create function private.pipeline_topic(topic uuid) returns uuid language plpgsql stable set search_path='' as $$
declare n uuid; k integer=0;
begin
 loop
  select merged_into into n from public.topics where id=topic;
  if n is null then return topic; end if;
  topic=n; k=k+1;
  if k>50 then raise exception 'Topic merge cycle'; end if;
 end loop;
end; $$;

create function public.pipeline_claim_questions(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.pipeline_runs; e jsonb; o public.objectives; claimed public.pipeline_question_claims; count_now integer; unseen integer; needed integer; result jsonb='[]'; flavor boolean=coalesce((payload->>'deep')::boolean,false); tok uuid=(payload->>'token')::uuid;
begin
 perform 1 from public.courses where id=(select course_id from public.pipeline_runs where id=(payload->>'runId')::uuid and owner_id=(payload->>'ownerId')::uuid) for update;
 select * into r from public.pipeline_runs where id=(payload->>'runId')::uuid and owner_id=(payload->>'ownerId')::uuid and status='running' for update;
 if r.id is null then raise exception 'Question run stopped' using errcode='40001'; end if;
 if payload ? 'taskId' then perform private.pipeline_task(payload); elsif r.execution_token is distinct from tok then raise exception 'Question worker replaced' using errcode='40001'; end if;
 perform 1 from public.courses where id=r.course_id and deleted_at is null for update;
 if not found then raise exception 'Course deleted' using errcode='40001'; end if;
 for e in select * from jsonb_array_elements(payload->'targets') order by value->>'objectiveId' loop
  select * into o from public.objectives where id=private.pipeline_canonical((e->>'objectiveId')::uuid) and owner_id=r.owner_id and course_id=r.course_id for update;
  if o.id is null or o.review='archived' then continue; end if;
  if o.id<>(e->>'objectiveId')::uuid then raise exception 'Objective merged; reload targets' using errcode='40001'; end if;
  select * into claimed from public.pipeline_question_claims where objective_id=o.id and deep=flavor for update;
  if claimed.objective_id is not null and claimed.lease_until>now() and (claimed.run_id<>r.id or claimed.token<>tok) then raise exception 'Another writer is filling this objective' using errcode='55P03'; end if;
  select count(*) into count_now from public.questions q where q.course_id=r.course_id and private.pipeline_canonical(q.objective_id)=o.id and (case when payload->>'policy'='upload' then true else q.deep=flavor end);
  needed=(e->>'need')::integer;
  if payload->>'policy'='upload' then needed=greatest(0,(e->>'desired')::integer-count_now); end if;
  if payload->>'policy'='top-up' then
   select count(*) into unseen from public.questions q where q.course_id=r.course_id and private.pipeline_canonical(q.objective_id)=o.id and not q.deep
    and not exists(select 1 from public.evidence_events a where a.owner_id=r.owner_id and a.question_id=q.id and a.kind='answer')
    and not exists(select 1 from public.question_feedback f where f.owner_id=r.owner_id and f.question_id=q.id and f.rating='down');
   needed=case when unseen<2 then 2 else 0 end;
  end if;
  if needed<=0 then continue; end if;
  insert into public.pipeline_question_claims values(o.id,flavor,r.id,r.owner_id,tok,needed,count_now,now()+interval '12 minutes') on conflict(objective_id,deep) do update set run_id=excluded.run_id,token=excluded.token,need=excluded.need,baseline=excluded.baseline,lease_until=excluded.lease_until;
  result=result||jsonb_build_array(jsonb_build_object('objectiveId',o.id,'need',needed));
 end loop;
 return result;
end; $$;

create function public.pipeline_commit_questions(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.pipeline_runs; e jsonb; o public.objectives; cap integer; current_count integer; n integer=0; flavor boolean; tok uuid=(payload->>'token')::uuid; desired jsonb; qkey text; warnings jsonb='[]';
begin
 perform 1 from public.courses where id=(select course_id from public.pipeline_runs where id=(payload->>'runId')::uuid and owner_id=(payload->>'ownerId')::uuid) for update;
 select * into r from public.pipeline_runs where id=(payload->>'runId')::uuid and owner_id=(payload->>'ownerId')::uuid for update;
 if r.id is null or r.status in ('failed','done') then
  if r.status='done' then return jsonb_build_object('inserted',0); end if;
  raise exception 'Question run stopped' using errcode='40001';
 end if;
 if payload ? 'taskId' then perform private.pipeline_task(payload); elsif r.execution_token is distinct from tok then raise exception 'Question worker replaced' using errcode='40001'; end if;
 perform 1 from public.courses where id=r.course_id and deleted_at is null for update;
 if not found then raise exception 'Course deleted' using errcode='40001'; end if;
 for e in select * from jsonb_array_elements(coalesce(payload->'questions','[]')) loop
  select * into o from public.objectives where id=private.pipeline_canonical((e->>'objective_id')::uuid) and owner_id=r.owner_id and course_id=r.course_id;
  if o.id is null or o.review='archived' then warnings=warnings||jsonb_build_array(jsonb_build_object('prompt',left(e->>'prompt',1200),'reason','Objective was archived or removed while questions were written.')); continue; end if;
  flavor=coalesce((e->>'deep')::boolean,false);
  -- Both source liveness and identity are rechecked AFTER the paid call.
  if not exists(select 1 from public.materials m where m.id=(e->>'material_id')::uuid and m.course_id=r.course_id and m.owner_id=r.owner_id and m.status='ready' and not m.held_back) then warnings=warnings||jsonb_build_array(jsonb_build_object('prompt',left(e->>'prompt',1200),'reason','Its source material was removed while this question was written.')); continue; end if;
  select max(baseline+need) into cap from public.pipeline_question_claims c where c.run_id=r.id and c.token=tok and c.deep=flavor and private.pipeline_canonical(c.objective_id)=o.id and c.lease_until>now();
  if cap is null then warnings=warnings||jsonb_build_array(jsonb_build_object('prompt',left(e->>'prompt',1200),'reason','Question reservation expired or was superseded.')); continue; end if;
  select count(*) into current_count from public.questions q where q.course_id=r.course_id and private.pipeline_canonical(q.objective_id)=o.id and (case when payload->>'policy'='upload' then true else q.deep=flavor end);
  if current_count>=cap then warnings=warnings||jsonb_build_array(jsonb_build_object('prompt',left(e->>'prompt',1200),'reason','Fresh question stock already meets this request.')); continue; end if;
  qkey=e->>'prompt_key';
  if qkey is null or exists(select 1 from public.questions q where q.course_id=r.course_id and public.pipeline_prompt_key(q.prompt)=qkey) then continue; end if;
  desired=e-'prompt_key'||jsonb_build_object('objective_id',o.id,'topic_id',private.pipeline_topic(o.topic_id));
  perform public.save_structure_rows(r.course_id,jsonb_build_object('questions',jsonb_build_array(desired)));
  n=n+1;
 end loop;
 delete from public.pipeline_question_claims where run_id=r.id and token=tok;
 update public.pipeline_runs set questions_added=questions_added+n,dropped=dropped||coalesce(payload->'dropped','[]')||warnings,question_ids=case when payload ? 'questionIds' then array(select jsonb_array_elements_text(payload->'questionIds'))::uuid[] else question_ids end where id=r.id;
 return jsonb_build_object('inserted',n);
end; $$;

-- Same normalization as promptKey: NFKC, symbol whitespace, text whitespace, terminal punctuation.
create function public.pipeline_prompt_key(prompt text) returns text language sql immutable set search_path='' as $$
 select btrim(regexp_replace(regexp_replace(regexp_replace(lower(normalize(prompt,NFKC)),'\s*([^[:alnum:][:space:]])\s*','\1','g'),'\s+',' ','g'),'[.?!]+$','','g'));
$$;

create function public.pipeline_control_run(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.pipeline_runs; action text=payload->>'action';
begin
 perform 1 from public.courses where id=(select course_id from public.pipeline_runs where id=(payload->>'runId')::uuid and owner_id=(payload->>'ownerId')::uuid) for update;
 select * into r from public.pipeline_runs where id=(payload->>'runId')::uuid and owner_id=(payload->>'ownerId')::uuid for update;
 if r.id is null or r.protocol_version<>2 then raise exception 'No staged run' using errcode='42501'; end if;
 if action='pause' then
  update public.pipeline_items set paused=true where run_id=r.id and owner_id=r.owner_id;
  update public.pipeline_runs set status='paused' where id=r.id and status in ('queued','waiting');
 elsif action='resume' then
  update public.pipeline_items set paused=false where run_id=r.id and owner_id=r.owner_id;
  update public.pipeline_runs set status='queued' where id=r.id and status='paused';
 elsif action='retry' then
  update public.pipeline_items set paused=false,state='active' where run_id=r.id and owner_id=r.owner_id;
  update public.pipeline_tasks set state='queued',epoch=epoch+1,token=null,error=null,available_at=now() where run_id=r.id and state in ('failed','cancelled','waiting');
  update public.pipeline_runs set status='queued',error=null where id=r.id and status in ('failed','waiting');
 elsif action='stop' then
  update public.pipeline_tasks set state='cancelled',epoch=epoch+1,token=null,lease_until=null where run_id=r.id and state<>'done';
  delete from public.pipeline_question_claims where run_id=r.id;
  update public.pipeline_items set state='cancelled' where run_id=r.id and owner_id=r.owner_id and state='active';
  update public.pipeline_runs set status='failed',execution_token=null,error='Stopped by you. Saved topics and questions are kept.' where id=r.id and status<>'done';
 end if;
 return '{}';
end; $$;

create function public.pipeline_claim_run(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.pipeline_runs; tok uuid=gen_random_uuid();
begin
 update public.pipeline_runs set status='running',started_at=now(),execution_token=tok,progress=payload->'progress'
 where id=(payload->>'runId')::uuid and owner_id=(payload->>'ownerId')::uuid and status in ('queued','waiting') and protocol_version=2 and kind<>'upload' returning * into r;
 if r.id is null then return null; end if;
 return jsonb_build_object('token',tok);
end; $$;

create function public.pipeline_record_flag(payload jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare t public.pipeline_tasks; i public.pipeline_flag_intents; result boolean;
begin
 t=private.pipeline_task(payload);
 select i0.* into i from public.pipeline_flag_intents i0 join public.pipeline_tasks s on s.id=i0.task_id where i0.id=(payload->'event'->>'id')::uuid and i0.owner_id=t.owner_id and s.run_id=t.run_id for update of i0;
 if i.id is null then raise exception 'Unknown marker intent'; end if;
 if i.recorded then return true; end if;
 if exists(select 1 from public.evidence_events where id=i.id and owner_id=t.owner_id) then
  update public.pipeline_flag_intents set recorded=true where id=i.id; return true;
 end if;
 result=public.record_evidence(t.owner_id,payload->'event',(payload->>'objective')::uuid,payload->'accumulator',(payload->>'rules_version')::integer,(payload->>'expected_version')::integer);
 if result then update public.pipeline_flag_intents set recorded=true where id=i.id; end if;
 return result;
end; $$;

-- Prevent a browser from forging concurrency counters; ordinary course updates remain authorized by RLS.
create function private.pipeline_course_fields() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user in ('authenticated','anon') and (new.structure_revision<>old.structure_revision or new.upload_sequence<>old.upload_sequence) then raise exception 'Server-owned pipeline fields' using errcode='42501'; end if;
 return new;
end; $$;
create trigger pipeline_course_fields before update on public.courses for each row execute function private.pipeline_course_fields();

-- Generic JSON RPCs are service-only. Owner IDs come from authenticated server entry points.
revoke all on function private.pipeline_course_fields() from public,anon,authenticated;
revoke all on function private.pipeline_task(jsonb) from public,anon,authenticated;
revoke all on function private.pipeline_revision() from public,anon,authenticated;
revoke all on function private.pipeline_canonical(uuid) from public,anon,authenticated;
revoke all on function private.pipeline_topic(uuid) from public,anon,authenticated;

create function public.pipeline_cached(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.pipeline_tasks; value jsonb;
begin
 t=private.pipeline_task(payload);
 select jsonb_build_object('result',result) into value from public.pipeline_results where task_id=t.id and input_hash=payload->>'inputHash';
 return value;
end; $$;
create function public.pipeline_flags(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.pipeline_tasks;
begin
 t=private.pipeline_task(payload);
 return coalesce((select jsonb_agg(i.event) from public.pipeline_flag_intents i join public.pipeline_tasks s on s.id=i.task_id where s.run_id=t.run_id and i.owner_id=t.owner_id and not i.recorded),'[]');
end; $$;
create function public.pipeline_pages(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.pipeline_tasks; day timestamptz=(payload->>'dayStart')::timestamptz; used integer; amount integer=(payload->>'pages')::integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(payload->>'ownerId',32));
 t=private.pipeline_task(payload);
 if day is null then day=date_trunc('day',now() at time zone coalesce((select timezone from public.profiles where owner_id=t.owner_id),'UTC')) at time zone coalesce((select timezone from public.profiles where owner_id=t.owner_id),'UTC'); end if;
 perform pg_advisory_xact_lock(hashtextextended(t.owner_id::text,32));
 if exists(select 1 from public.pipeline_page_charges where material_id=t.material_id and day_start=day) or exists(select 1 from public.pipeline_runs where owner_id=t.owner_id and material_id=t.material_id and protocol_version=1 and kind='upload' and status in ('done','failed') and at>=day) then return '{}'; end if;
 select coalesce(sum(pages),0) into used from public.pipeline_page_charges where owner_id=t.owner_id and day_start=day;
 used=used+(select count(*) from public.material_pages p where p.owner_id=t.owner_id and p.material_id in (select distinct material_id from public.pipeline_runs where owner_id=t.owner_id and protocol_version=1 and kind='upload' and status in ('done','failed') and at>=day));
 if used+amount>1000 then raise exception 'Daily page allowance reached; resuming tomorrow' using errcode='55P03'; end if;
 insert into public.pipeline_page_charges values(t.owner_id,t.material_id,day,amount) on conflict do nothing;
 return '{}';
end; $$;

alter table public.model_usage add column step text;
alter table public.model_usage add column phase text;
alter table public.model_usage add column duration_ms integer;
alter table public.model_usage add column attempt_id uuid;

create function public.pipeline_reserve_call(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid=(payload->>'ownerId')::uuid; day timestamptz=(payload->>'dayStart')::timestamptz; utc timestamptz=(payload->>'utcStart')::timestamptz; spent bigint; held bigint; dollars numeric; reserved numeric; amount bigint=(payload->>'tokens')::bigint; price numeric=(payload->>'usd')::numeric; cap numeric=(payload->>'globalCap')::numeric; rid uuid=(payload->>'id')::uuid;
begin
 -- Same lock order for all owners: global dollars, then owner tokens/permits.
 perform pg_advisory_xact_lock(91337001);
 perform pg_advisory_xact_lock(hashtextextended(o::text,32));
 if amount<0 or price<0 or day is null or utc is null then raise exception 'Invalid reservation'; end if;
 if payload ? 'taskId' then perform private.pipeline_task(payload); end if;
 if payload ? 'runToken' and not exists(select 1 from public.pipeline_runs where id=(payload->>'runId')::uuid and owner_id=o and execution_token=(payload->>'runToken')::uuid and status='running') then raise exception 'Writer replaced before model call' using errcode='40001'; end if;
 update public.pipeline_call_reservations set state='unknown' where state='active' and lease_until<now();
 if (select count(*) from public.pipeline_call_reservations where owner_id=o and state='active')>=4 or (select count(*) from public.pipeline_call_reservations where state='active')>=coalesce((payload->>'providerSlots')::integer,20) then
  return jsonb_build_object('ok',false,'reason','capacity','message','Waiting for model capacity.');
 end if;
 select coalesce(sum(input_tokens::bigint+output_tokens+cache_write_tokens+cache_read_tokens),0) into spent from public.model_usage where owner_id=o and at>=day;
 select coalesce(sum(tokens),0) into held from public.pipeline_call_reservations where owner_id=o and day_start=day and state in ('active','unknown');
 if spent+held+amount>2000000 then return jsonb_build_object('ok',false,'reason','daily-tokens','message','Not enough remaining model allowance. Processing resumes tomorrow.'); end if;
 select coalesce(sum(cost_usd),0) into dollars from public.model_usage where at>=utc;
 select coalesce(sum(usd),0) into reserved from public.pipeline_call_reservations where utc_start=utc and state in ('active','unknown');
 if cap is not null and dollars+reserved+price>cap then return jsonb_build_object('ok',false,'reason','global-budget','message','Orca model budget is reserved or used for today.'); end if;
 insert into public.pipeline_call_reservations(id,owner_id,run_id,task_id,task_token,day_start,utc_start,tokens,usd,lease_until) values(rid,o,(payload->>'runId')::uuid,(payload->>'taskId')::uuid,(payload->>'token')::uuid,day,utc,amount,price,now()+interval '12 minutes') on conflict do nothing;
 return jsonb_build_object('ok',true);
end; $$;
create function public.pipeline_settle_call(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 update public.pipeline_call_reservations set state=case when coalesce((payload->>'known')::boolean,false) then 'settled' else 'unknown' end where id=(payload->>'id')::uuid and owner_id=(payload->>'ownerId')::uuid and state='active';
 return '{}';
end; $$;

-- Backfill is explicit and repeatable. Invoke only after legacy workers have been drained.
create function public.pipeline_backfill(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.pipeline_runs; seq bigint; item uuid;
begin
 if exists(select 1 from public.pipeline_runs where protocol_version=1 and (status='running' or (status='queued' and started_at is not null))) then raise exception 'Drain legacy workers first'; end if;
 for r in select * from public.pipeline_runs where protocol_version=1 and kind='upload' and status in ('queued','waiting','paused') order by at,id for update loop
  update public.courses set upload_sequence=upload_sequence+1 where id=r.course_id returning upload_sequence into seq;
  item=gen_random_uuid();
  insert into public.pipeline_items(id,batch_id,owner_id,course_id,sequence,source,name,material_id,run_id,state,paused) values(item,item,r.owner_id,r.course_id,seq,'browser',coalesce((select filename from public.materials where id=r.material_id),'Upload'),r.material_id,r.id,'active',r.status='paused');
  update public.pipeline_runs set protocol_version=2,phase='prepare' where id=r.id;
  insert into public.pipeline_tasks(run_id,owner_id,course_id,material_id,phase) values(r.id,r.owner_id,r.course_id,r.material_id,'prepare');
 end loop;
 update public.pipeline_runs set protocol_version=2 where protocol_version=1 and kind in ('top-up','deep-review') and status in ('queued','waiting');
 return '{}';
end; $$;

-- Every new entry point remains private to the service role, including later additions in this migration.

create function public.pipeline_end_run(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.pipeline_runs; state text=payload->>'state';
begin
 perform 1 from public.courses where id=(select course_id from public.pipeline_runs where id=(payload->>'runId')::uuid and owner_id=(payload->>'ownerId')::uuid) for update;
 select * into r from public.pipeline_runs where id=(payload->>'runId')::uuid and owner_id=(payload->>'ownerId')::uuid for update;
 if r.id is null or r.execution_token is distinct from (payload->>'token')::uuid or r.status<>'running' then return '{}'; end if;
 if state is not null then
  update public.pipeline_runs set status=state,error=case when state='done' then null else payload->>'error' end,progress=case when state='waiting' then jsonb_build_object('stage','waiting','message',payload->>'error') else null end,
   question_ids=case when state='done' then array(select q.id from jsonb_array_elements_text(coalesce(payload->'questionIds','[]')) x join public.questions q on q.id=x.value::uuid and q.course_id=r.course_id) else question_ids end where id=r.id;
  delete from public.pipeline_question_claims where run_id=r.id and token=r.execution_token;
 else
  if payload ? 'progress' then update public.pipeline_runs set progress=payload->'progress' where id=r.id; end if;
  update public.pipeline_question_claims set lease_until=now()+interval '12 minutes' where run_id=r.id and token=r.execution_token;
 end if;
 return '{}';
end; $$;
revoke all on function public.pipeline_end_run(jsonb) from public,anon,authenticated;
grant execute on function public.pipeline_end_run(jsonb) to service_role;
alter table public.pipeline_items add column rate_charged boolean not null default false;
create function public.pipeline_charge_item(payload jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare i public.pipeline_items; verdict jsonb;
begin
 select * into i from public.pipeline_items where id=(payload->>'itemId')::uuid and owner_id=(payload->>'ownerId')::uuid for update;
 if i.id is null then raise exception 'No admission' using errcode='42501'; end if;
 if i.rate_charged then return i.state not in ('failed','cancelled'); end if;
 verdict=public.hit_rate_limit(i.owner_id,'upload',86400,20);
 update public.pipeline_items set rate_charged=true,state=case when (verdict->>'allowed')::boolean then state else 'failed' end,error=case when (verdict->>'allowed')::boolean then error else 'Daily upload limit reached. Try again tomorrow.' end where id=i.id;
 return (verdict->>'allowed')::boolean;
end; $$;
revoke all on function public.pipeline_charge_item(jsonb) from public,anon,authenticated;
grant execute on function public.pipeline_charge_item(jsonb) to service_role;

create table public.pipeline_canvas_sessions (
 id uuid primary key,owner_id uuid not null references auth.users on delete cascade,course_id uuid not null references public.courses on delete cascade,
 canvas_course_id text not null,site text not null,summary jsonb not null,created_at timestamptz not null default now()
);
alter table public.pipeline_canvas_sessions enable row level security;
create function public.pipeline_canvas_session(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.pipeline_canvas_sessions; e jsonb; result jsonb; canonical uuid; key text;
begin
 select * into s from public.pipeline_canvas_sessions where id=(payload->>'sessionId')::uuid for update;
 if s.id is not null then
  if s.owner_id<>(payload->>'ownerId')::uuid or s.course_id<>(payload->>'courseId')::uuid or s.canvas_course_id<>payload->>'canvasCourseId' then raise exception 'Wrong import session' using errcode='42501'; end if;
  if coalesce((payload->>'resumeExpired')::boolean,false) then
   update public.pipeline_items set state='ingesting',error=null,expires_at=now()+interval '15 minutes',metadata=metadata-'claimToken'-'outcome' where batch_id=s.id and owner_id=s.owner_id and state='failed' and run_id is null and error like 'Upload interrupted%';
  end if;
  return s.summary||jsonb_build_object('importSessionId',s.id);
 end if;
 perform 1 from public.courses where id=(payload->>'courseId')::uuid and owner_id=(payload->>'ownerId')::uuid and deleted_at is null for update;
 if not found then raise exception 'No live course' using errcode='42501'; end if;
 result=public.pipeline_admit(payload||jsonb_build_object('batchId',payload->>'sessionId','source','canvas'));
 insert into public.pipeline_canvas_sessions values((payload->>'sessionId')::uuid,(payload->>'ownerId')::uuid,(payload->>'courseId')::uuid,payload->>'canvasCourseId',payload->>'site',payload->'summary',now());
 for e in select * from jsonb_array_elements(payload->'items') loop
  key='canvas:'||(payload->>'site')||':'||(payload->>'canvasCourseId')||':'||(e->'metadata'->>'sourceId');
  insert into public.pipeline_source_claims values((payload->>'ownerId')::uuid,(payload->>'courseId')::uuid,key,(e->>'id')::uuid) on conflict do nothing;
  select item_id into canonical from public.pipeline_source_claims where owner_id=(payload->>'ownerId')::uuid and course_id=(payload->>'courseId')::uuid and source_key=key;
  if canonical<>(e->>'id')::uuid then
   if exists(select 1 from public.pipeline_items where id=canonical and state in ('failed','cancelled')) then
    update public.pipeline_source_claims set item_id=(e->>'id')::uuid where owner_id=(payload->>'ownerId')::uuid and course_id=(payload->>'courseId')::uuid and source_key=key;
   else
    update public.pipeline_items set state='alias',metadata=metadata||jsonb_build_object('canonicalItemId',canonical,'outcome','duplicate') where id=(e->>'id')::uuid;
   end if;
  end if;
 end loop;
 return (payload->'summary')||jsonb_build_object('importSessionId',payload->>'sessionId');
end; $$;
create function public.pipeline_canvas_claim(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.pipeline_items; token uuid=gen_random_uuid();
begin
 perform pg_advisory_xact_lock(hashtextextended(payload->>'ownerId',33));
 if not exists(select 1 from public.pipeline_canvas_sessions s join public.courses c on c.id=s.course_id where s.id=(payload->>'sessionId')::uuid and s.owner_id=(payload->>'ownerId')::uuid and c.deleted_at is null) then raise exception 'No live import session' using errcode='42501'; end if;
 if (select count(*) from public.pipeline_items where owner_id=(payload->>'ownerId')::uuid and source='canvas' and state='ingesting' and metadata ? 'claimToken' and expires_at>now())>=2 then return null; end if;
 select * into i from public.pipeline_items where batch_id=(payload->>'sessionId')::uuid and owner_id=(payload->>'ownerId')::uuid and source='canvas' and state='ingesting' and (not metadata ? 'claimToken' or expires_at<now()) order by sequence for update skip locked limit 1;
 if i.id is null then return null; end if;
 update public.pipeline_items set metadata=metadata||jsonb_build_object('claimToken',token),expires_at=now()+interval '5 minutes' where id=i.id;
 return jsonb_build_object('id',i.id,'token',token,'metadata',i.metadata,'materialId',i.material_id);
end; $$;
create function public.pipeline_canvas_finish(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.pipeline_items;
begin
 select * into i from public.pipeline_items where id=(payload->>'itemId')::uuid and owner_id=(payload->>'ownerId')::uuid for update;
 if i.id is null or i.metadata->>'claimToken' is distinct from payload->>'token' then raise exception 'Import attempt replaced' using errcode='40001'; end if;
 update public.pipeline_items set metadata=(metadata-'claimToken')||jsonb_build_object('outcome',payload->>'outcome'),state=case when payload->>'outcome' in ('failed','skipped') then 'failed' else state end,error=payload->>'error' where id=i.id;
 return '{}';
end; $$;
create function public.pipeline_canvas_summary(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.pipeline_canvas_sessions; summary jsonb;
begin
 select * into s from public.pipeline_canvas_sessions where id=(payload->>'sessionId')::uuid and owner_id=(payload->>'ownerId')::uuid;
 if s.id is null then raise exception 'No import session' using errcode='42501'; end if;
 select jsonb_build_object('added',count(*) filter(where metadata->>'outcome'='added'),'duplicates',count(*) filter(where metadata->>'outcome'='duplicate'),'failed',count(*) filter(where state='failed' and metadata->>'outcome' is distinct from 'skipped'),'skipped',count(*) filter(where metadata->>'outcome'='skipped'),'remaining',count(*) filter(where state='ingesting'),'skippedNames',coalesce(jsonb_agg(name) filter(where state='failed'),'[]'),'total',count(*)) into summary from public.pipeline_items where batch_id=s.id and owner_id=s.owner_id and metadata->>'sourceId'<>'syllabus';
 return s.summary||jsonb_build_object('importSessionId',s.id,'files',summary);
end; $$;

grant all on public.pipeline_control,public.pipeline_items,public.pipeline_tasks,public.pipeline_results,public.pipeline_warmups,public.pipeline_flag_intents,public.pipeline_question_claims,public.pipeline_call_reservations,public.pipeline_page_charges,public.pipeline_source_claims,public.pipeline_canvas_sessions to service_role;
grant select on public.pipeline_items to authenticated;
-- Charge and persist the rate verdict under the same item lock. HTTP retry is not a new upload.
-- Material/course removal already stops parent runs. Fence their phase leases in that SAME transaction.
create function private.pipeline_parent_terminal() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.protocol_version=2 and new.status in ('failed','done') and old.status is distinct from new.status then
  update public.pipeline_tasks set state=case when new.status='failed' then 'cancelled' else state end,epoch=epoch+1,token=null,lease_until=null where run_id=new.id and state not in ('done','failed');
  delete from public.pipeline_question_claims where run_id=new.id;
 end if;
 return new;
end; $$;
create trigger pipeline_parent_terminal after update on public.pipeline_runs for each row execute function private.pipeline_parent_terminal();
revoke all on function private.pipeline_parent_terminal() from public,anon,authenticated;

-- Include held spend/pages in public-facing budget decisions; actual cost reports still use model_usage.
create function public.pipeline_budget(payload jsonb) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'pages',coalesce((select sum(pages) from public.pipeline_page_charges where owner_id=(payload->>'ownerId')::uuid and day_start=(payload->>'dayStart')::timestamptz),0)
   +(select count(*) from public.material_pages p where p.owner_id=(payload->>'ownerId')::uuid and p.material_id in (select distinct material_id from public.pipeline_runs where owner_id=p.owner_id and protocol_version=1 and kind='upload' and status in ('done','failed') and at>=(payload->>'dayStart')::timestamptz)),
  'tokens',coalesce((select sum(input_tokens::bigint+output_tokens+cache_write_tokens+cache_read_tokens) from public.model_usage where owner_id=(payload->>'ownerId')::uuid and at>=(payload->>'dayStart')::timestamptz),0)
   +coalesce((select sum(tokens) from public.pipeline_call_reservations where owner_id=(payload->>'ownerId')::uuid and day_start=(payload->>'dayStart')::timestamptz and state in ('active','unknown')),0),
  'globalUsd',coalesce((select sum(cost_usd) from public.model_usage where at>=(payload->>'utcStart')::timestamptz),0)
   +coalesce((select sum(usd) from public.pipeline_call_reservations where utc_start=(payload->>'utcStart')::timestamptz and state in ('active','unknown')),0));
$$;
revoke all on function public.pipeline_budget(jsonb) from public,anon,authenticated;
grant execute on function public.pipeline_budget(jsonb) to service_role;

-- Removal is one coherent read/modify/write transaction; sources added by another upload cannot be lost.
create function public.pipeline_remove_material(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.materials; n integer; topic public.topics; kept jsonb;
begin
 select * into m from public.materials where id=(payload->>'materialId')::uuid and owner_id=(payload->>'ownerId')::uuid;
 if m.id is null then raise exception 'No material' using errcode='42501'; end if;
 perform 1 from public.courses where id=m.course_id for update;
 select * into m from public.materials where id=m.id for update;
 if m.status='removed' then return jsonb_build_object('archivedObjectives',0); end if;
 if exists(select 1 from public.pipeline_runs where material_id=m.id and owner_id=m.owner_id and status='running') then raise exception 'Stop this upload before removing its material' using errcode='55P03'; end if;
 update public.pipeline_runs set status='failed',error='Removed by you.' where material_id=m.id and owner_id=m.owner_id and status in ('queued','waiting','paused');
 update public.pipeline_items set state='cancelled' where material_id=m.id and owner_id=m.owner_id and state='ingesting';
 update public.objectives o set review='archived',archived_with_material=true where o.owner_id=m.owner_id and o.course_id=m.course_id and o.material_id=m.id and o.review<>'archived'
  and not exists(select 1 from jsonb_array_elements(o.signals) s join public.materials other on other.id::text=s->>'materialId' where other.course_id=m.course_id and other.owner_id=m.owner_id and other.id<>m.id and other.status<>'removed');
 get diagnostics n=row_count;
 for topic in select * from public.topics where course_id=m.course_id and owner_id=m.owner_id and review<>'archived' for update loop
  select coalesce(jsonb_agg(s),'[]') into kept from jsonb_array_elements(topic.source) s where s->>'materialId' is distinct from m.id::text;
  update public.topics set source=kept,review=case when topic.material_id=m.id and not exists(select 1 from public.objectives where topic_id=topic.id and review<>'archived') then 'archived' else review end,
   archived_with_material=case when topic.material_id=m.id and not exists(select 1 from public.objectives where topic_id=topic.id and review<>'archived') then true else archived_with_material end where id=topic.id;
 end loop;
 delete from public.material_pages where material_id=m.id and owner_id=m.owner_id;
 delete from public.calendar_events where material_id=m.id and owner_id=m.owner_id;
 update public.materials set status='removed',content_hash=null,reading_since=null where id=m.id;
 update public.courses set structure_revision=structure_revision+1 where id=m.course_id;
 return jsonb_build_object('archivedObjectives',n);
end; $$;
revoke all on function public.pipeline_remove_material(jsonb) from public,anon,authenticated;
grant execute on function public.pipeline_remove_material(jsonb) to service_role;
-- Late deliveries of pre-cutover workers cannot claim a legacy run after enable.
create function private.pipeline_legacy_gate() returns trigger language plpgsql security definer set search_path='' as $$
declare enabled boolean;
begin
 if new.protocol_version=1 and new.status='running' and (TG_OP='INSERT' or old.status<>'running') then
  select c.enabled into enabled from public.pipeline_control c where c.id=true for share;
  if enabled then raise exception 'Legacy worker disabled after staged cutover' using errcode='40001'; end if;
 end if;
 return new;
end; $$;
create trigger pipeline_legacy_gate before insert or update on public.pipeline_runs for each row execute function private.pipeline_legacy_gate();
revoke all on function private.pipeline_legacy_gate() from public,anon,authenticated;

-- Worker RPCs are service-only; public request handlers authenticate and scope ownerId first.
do $$ declare f record; begin
 for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'pipeline_%' loop
 execute format('revoke all on function %s from public,anon,authenticated',f.sig);
 execute format('grant execute on function %s to service_role',f.sig);
 end loop;
end; $$;
create function public.pipeline_recoverable(payload jsonb) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'materialId',m.id,'again',coalesce((i.metadata->>'again')::boolean,false))),'[]') from
 (select x.* from public.pipeline_items x join public.courses c on c.id=x.course_id where x.owner_id=(payload->>'ownerId')::uuid and x.source='browser' and x.state='ingesting' and x.expires_at<now() and c.deleted_at is null order by x.sequence limit 2) i
 join public.materials m on m.id=i.material_id and m.owner_id=i.owner_id
 where (m.status='ready' or ((m.status='uploaded' or (m.status='reading' and m.reading_since<now()-interval '5 minutes')) and exists(select 1 from storage.objects s where s.bucket_id='materials' and s.name=m.storage_path)));
$$;
revoke all on function public.pipeline_recoverable(jsonb) from public,anon,authenticated;
grant execute on function public.pipeline_recoverable(jsonb) to service_role;
create table public.pipeline_writer_results (
 run_id uuid not null references public.pipeline_runs on delete cascade,input_hash text not null,result jsonb not null,primary key(run_id,input_hash)
);
alter table public.pipeline_writer_results enable row level security;
grant all on public.pipeline_writer_results to service_role;
create function public.pipeline_writer_result(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.pipeline_runs; result jsonb;
begin
 select * into r from public.pipeline_runs where id=(payload->>'runId')::uuid and owner_id=(payload->>'ownerId')::uuid;
 if r.id is null or r.protocol_version<>2 or r.status<>'running' or r.execution_token is distinct from (payload->>'runToken')::uuid then raise exception 'Writer replaced' using errcode='40001'; end if;
 if payload ? 'result' then
  insert into public.pipeline_writer_results values(r.id,payload->>'inputHash',payload->'result') on conflict do nothing;
 end if;
 select jsonb_build_object('result',p.result) into result from public.pipeline_writer_results p where p.run_id=r.id and p.input_hash=payload->>'inputHash';
 return result;
end; $$;
revoke all on function public.pipeline_writer_result(jsonb) from public,anon,authenticated;
grant execute on function public.pipeline_writer_result(jsonb) to service_role;

alter table public.pipeline_results add column created_at timestamptz not null default now();
alter table public.pipeline_writer_results add column created_at timestamptz not null default now();
create index on public.pipeline_call_reservations(state,lease_until) where state='active';
create function public.pipeline_cleanup(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 delete from public.pipeline_results p using public.pipeline_tasks t,public.pipeline_runs r where p.task_id=t.id and t.run_id=r.id and ((r.status='done' and p.created_at<now()-interval '7 days') or (r.status='failed' and p.created_at<now()-interval '30 days'));
 delete from public.pipeline_writer_results p using public.pipeline_runs r where p.run_id=r.id and ((r.status='done' and p.created_at<now()-interval '7 days') or (r.status='failed' and p.created_at<now()-interval '30 days'));
 update public.pipeline_tasks t set checkpoint=checkpoint-'plan'-'written' where t.finished_at<now()-interval '7 days' and t.state='done' and exists(select 1 from public.pipeline_runs r where r.id=t.run_id and r.status in ('done','failed')) and (checkpoint ? 'plan' or checkpoint ? 'written');
 delete from public.pipeline_call_reservations where state='settled' and created_at<now()-interval '30 days';
 return '{}';
end; $$;
revoke all on function public.pipeline_cleanup(jsonb) from public,anon,authenticated;
grant execute on function public.pipeline_cleanup(jsonb) to service_role;

-- Supabase default table grants are broader than these internal tables require.
revoke all on public.pipeline_control,public.pipeline_results,public.pipeline_warmups,
 public.pipeline_writer_results,public.pipeline_tasks,public.pipeline_flag_intents,
 public.pipeline_question_claims,public.pipeline_call_reservations,public.pipeline_page_charges,
 public.pipeline_source_claims,public.pipeline_canvas_sessions from anon,authenticated;
revoke all on public.pipeline_items from anon,authenticated;
grant select on public.pipeline_items to authenticated;
