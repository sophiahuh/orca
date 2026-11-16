begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email) values('aaaaaaaa-0000-4000-8000-000000000211','stage21@example.com'),('bbbbbbbb-0000-4000-8000-000000000211','other21@example.com');
insert into public.courses(id,owner_id,slug,name,short,variant,pos_x,pos_y) values('c0000000-0000-4000-8000-000000000211','aaaaaaaa-0000-4000-8000-000000000211','stage21','Stage','ST','ald',0,0);
select public.pipeline_enable('{"enabled":true}');
create temp table calls(name text primary key, value jsonb);
insert into calls values('admit',public.pipeline_admit('{"ownerId":"aaaaaaaa-0000-4000-8000-000000000211","courseId":"c0000000-0000-4000-8000-000000000211","batchId":"d0000000-0000-4000-8000-000000000211","source":"browser","items":[{"id":"e0000000-0000-4000-8000-000000000211","name":"First.pdf"},{"id":"e0000000-0000-4000-8000-000000000212","name":"Second.pdf"}]}'));
select is((select count(*) from public.pipeline_items),2::bigint,'two ordered manifest entries');
select is((select sequence from public.pipeline_items where name='First.pdf'),1::bigint,'first order reserved before bytes');
select is((select sequence from public.pipeline_items where name='Second.pdf'),2::bigint,'second order reserved before bytes');
select throws_ok($$select public.pipeline_admit('{"ownerId":"bbbbbbbb-0000-4000-8000-000000000211","courseId":"c0000000-0000-4000-8000-000000000211","batchId":"d0000000-0000-4000-8000-000000000212","source":"browser","items":[{"id":"e0000000-0000-4000-8000-000000000213","name":"Stolen.pdf"}]}')$$,'42501',null,'another owner cannot admit into this course');
insert into public.materials(id,owner_id,course_id,filename,type,status,content_hash) values
 ('f0000000-0000-4000-8000-000000000211','aaaaaaaa-0000-4000-8000-000000000211','c0000000-0000-4000-8000-000000000211','First.pdf','Lecture','ready','first-hash'),
 ('f0000000-0000-4000-8000-000000000212','aaaaaaaa-0000-4000-8000-000000000211','c0000000-0000-4000-8000-000000000211','Second.pdf','Lecture','ready','second-hash');
select public.pipeline_charge_item('{"ownerId":"aaaaaaaa-0000-4000-8000-000000000211","itemId":"e0000000-0000-4000-8000-000000000211"}');
select public.pipeline_charge_item('{"ownerId":"aaaaaaaa-0000-4000-8000-000000000211","itemId":"e0000000-0000-4000-8000-000000000212"}');
-- Second bytes arrive first, but that cannot change the structure lane order.
insert into calls values('second',public.pipeline_attach('{"ownerId":"aaaaaaaa-0000-4000-8000-000000000211","itemId":"e0000000-0000-4000-8000-000000000212","materialId":"f0000000-0000-4000-8000-000000000212","model":"gpt-6.1-sol"}'));
insert into calls values('prep2',public.pipeline_claim('{"ownerId":"aaaaaaaa-0000-4000-8000-000000000211"}'));
select public.pipeline_task((select value from calls where name='prep2'));
select public.pipeline_finish((select value from calls where name='prep2')||'{"checkpoint":{}}');
select is(public.pipeline_claim('{"ownerId":"aaaaaaaa-0000-4000-8000-000000000211"}'),null::jsonb,'second structure waits for first ingestion');
insert into calls values('first',public.pipeline_attach('{"ownerId":"aaaaaaaa-0000-4000-8000-000000000211","itemId":"e0000000-0000-4000-8000-000000000211","materialId":"f0000000-0000-4000-8000-000000000211","model":"gpt-6.1-sol"}'));
insert into calls values('prep1',public.pipeline_claim('{"ownerId":"aaaaaaaa-0000-4000-8000-000000000211"}'));
select public.pipeline_task((select value from calls where name='prep1'));
select public.pipeline_finish((select value from calls where name='prep1')||'{"checkpoint":{}}');
insert into calls values('structure1',public.pipeline_claim('{"ownerId":"aaaaaaaa-0000-4000-8000-000000000211"}'));
select is((select material_id::text from public.pipeline_tasks where id=((select value from calls where name='structure1')->>'taskId')::uuid),'f0000000-0000-4000-8000-000000000211','first file owns structure lane');
select is(public.pipeline_claim('{"ownerId":"aaaaaaaa-0000-4000-8000-000000000211"}'),null::jsonb,'one active structure per course');
select public.pipeline_task((select value from calls where name='structure1'));
select throws_ok(format('select public.pipeline_commit_structure(%L::jsonb)',(select value from calls where name='structure1')||'{"revision":999,"rows":{}}'),'40001',null,'stale taxonomy revision cannot save');
select public.pipeline_commit_structure((select value from calls where name='structure1')||jsonb_build_object('revision',(select structure_revision from public.courses where slug='stage21'),'rows','{}'::jsonb,'summary','{}'::jsonb,'targets','[]'::jsonb,'warmup','[]'::jsonb,'flags','[]'::jsonb));
-- Claim questions first; the old parent remains running but it must no longer block second structure.
insert into calls values('questions1',public.pipeline_claim('{"ownerId":"aaaaaaaa-0000-4000-8000-000000000211"}'));
insert into calls values('structure2',public.pipeline_claim('{"ownerId":"aaaaaaaa-0000-4000-8000-000000000211"}'));
select is((select material_id::text from public.pipeline_tasks where id=((select value from calls where name='structure2')->>'taskId')::uuid),'f0000000-0000-4000-8000-000000000212','next structure starts while first questions are running');
select public.pipeline_control_run(jsonb_build_object('ownerId','aaaaaaaa-0000-4000-8000-000000000211','runId',(select value->>'runId' from calls where name='second'),'action','stop'));
select throws_ok(format('select public.pipeline_checkpoint(%L::jsonb)',(select value from calls where name='structure2')||'{"checkpoint":{"late":true}}'),'40001',null,'stopped worker cannot checkpoint');
select public.pipeline_task((select value from calls where name='questions1'));
select public.pipeline_finish((select value from calls where name='questions1'));
select is((select status from public.pipeline_runs where id=((select value from calls where name='first')->>'runId')::uuid),'done','parent completes after question phase');
-- Question appends do not change taxonomy revision; browser counters are server-owned.
select ok(not has_function_privilege('authenticated','public.pipeline_claim(jsonb)','EXECUTE'),'browser cannot claim workers');
select ok(not has_function_privilege('authenticated','public.pipeline_commit_structure(jsonb)','EXECUTE'),'browser cannot commit worker results');
select ok(not has_function_privilege('authenticated','public.pipeline_reserve_call(jsonb)','EXECUTE'),'browser cannot reserve model spend');
-- Shared budget reservations count outstanding attempts, and unknown attempts stay charged.
insert into calls values('budget',jsonb_build_object('ownerId','aaaaaaaa-0000-4000-8000-000000000211','dayStart',date_trunc('day',now()),'utcStart',date_trunc('day',now()),'tokens',100,'usd',0.01,'globalCap',100));
select is((public.pipeline_reserve_call((select value from calls where name='budget')||jsonb_build_object('id','a1000000-0000-4000-8000-000000000211'))->>'ok')::boolean,true,'first provider attempt admitted');
select is((public.pipeline_reserve_call((select value from calls where name='budget')||jsonb_build_object('id','a1000000-0000-4000-8000-000000000212'))->>'ok')::boolean,true,'second provider attempt admitted');
select is((public.pipeline_reserve_call((select value from calls where name='budget')||jsonb_build_object('id','a1000000-0000-4000-8000-000000000213'))->>'ok')::boolean,true,'third provider attempt admitted');
select is((public.pipeline_reserve_call((select value from calls where name='budget')||jsonb_build_object('id','a1000000-0000-4000-8000-000000000214'))->>'ok')::boolean,true,'fourth provider attempt admitted');
select is(public.pipeline_reserve_call((select value from calls where name='budget')||jsonb_build_object('id','a1000000-0000-4000-8000-000000000215'))->>'reason','capacity','fifth concurrent call deferred');
select public.pipeline_settle_call('{"ownerId":"aaaaaaaa-0000-4000-8000-000000000211","id":"a1000000-0000-4000-8000-000000000211","known":false}');
select is((select state from public.pipeline_call_reservations where id='a1000000-0000-4000-8000-000000000211'),'unknown','lost reply not refunded as free');
select is(public.pipeline_reserve_call((select value from calls where name='budget')||jsonb_build_object('id','a1000000-0000-4000-8000-000000000216','tokens',2000000))->>'reason','daily-tokens','unknown and active reservations protect token ceiling');
select is(public.pipeline_reserve_call((select value from calls where name='budget')||jsonb_build_object('id','a1000000-0000-4000-8000-000000000217','globalCap',0.02))->>'reason','global-budget','global ceiling includes held dollars');

-- Objective claims are shared by uploads/top-ups, not just exact prompt deduplication.
insert into public.topics(id,owner_id,course_id,name,review,pos_x,pos_y,sort_order) values('a2000000-0000-4000-8000-000000000211','aaaaaaaa-0000-4000-8000-000000000211','c0000000-0000-4000-8000-000000000211','Logic','confirmed',0,0,0);
insert into public.objectives(id,owner_id,course_id,topic_id,name,description,origin,review) values('a3000000-0000-4000-8000-000000000211','aaaaaaaa-0000-4000-8000-000000000211','c0000000-0000-4000-8000-000000000211','a2000000-0000-4000-8000-000000000211','Simplify','Absorption','material','confirmed');
insert into public.pipeline_runs(id,owner_id,course_id,kind,model,at,status,protocol_version,deep_minutes) values
 ('a4000000-0000-4000-8000-000000000211','aaaaaaaa-0000-4000-8000-000000000211','c0000000-0000-4000-8000-000000000211','top-up','gpt-6.1-sol',now(),'queued',2,null),
 ('a4000000-0000-4000-8000-000000000212','aaaaaaaa-0000-4000-8000-000000000211','c0000000-0000-4000-8000-000000000211','deep-review','gpt-6.1-sol',now(),'queued',2,30);
insert into calls values('quickLease',public.pipeline_claim_run('{"ownerId":"aaaaaaaa-0000-4000-8000-000000000211","runId":"a4000000-0000-4000-8000-000000000211"}'));
insert into calls values('deepLease',public.pipeline_claim_run('{"ownerId":"aaaaaaaa-0000-4000-8000-000000000211","runId":"a4000000-0000-4000-8000-000000000212"}'));
insert into calls values('quickRequest',(select value from calls where name='quickLease')||'{"ownerId":"aaaaaaaa-0000-4000-8000-000000000211","runId":"a4000000-0000-4000-8000-000000000211","policy":"top-up","targets":[{"objectiveId":"a3000000-0000-4000-8000-000000000211","need":2}]}');
select is((public.pipeline_claim_questions((select value from calls where name='quickRequest'))->0->>'need')::integer,2,'session top-up reserves ADD TWO, not fill-to-two');
select lives_ok(format('select public.pipeline_claim_questions(%L::jsonb)',(select value from calls where name='deepLease')||'{"ownerId":"aaaaaaaa-0000-4000-8000-000000000211","runId":"a4000000-0000-4000-8000-000000000212","policy":"deep-review","deep":true,"targets":[{"objectiveId":"a3000000-0000-4000-8000-000000000211","need":3}]}'),'deep stock is separate from ordinary stock');
select throws_ok(format('select public.pipeline_claim_questions(%L::jsonb)',(select value from calls where name='deepLease')||'{"ownerId":"aaaaaaaa-0000-4000-8000-000000000211","runId":"a4000000-0000-4000-8000-000000000212","policy":"upload","deep":false,"targets":[{"objectiveId":"a3000000-0000-4000-8000-000000000211","need":2,"desired":2}]}'),'55P03',null,'another writer cannot also fill the same quick stock');
select public.pipeline_commit_questions((select value from calls where name='quickRequest')||'{"questions":[{"id":"a5000000-0000-4000-8000-000000000211","objective_id":"a3000000-0000-4000-8000-000000000211","topic_id":"a2000000-0000-4000-8000-000000000211","topic_name":"Logic","material_id":"f0000000-0000-4000-8000-000000000211","kind":"Short answer","prompt":"Simplify case 1?","prompt_key":"simplify case 1","answer":-1,"exact":["x"],"options":[],"explanation":"Absorption","deep":false,"sort_order":0}]}');
select is((select count(*) from public.questions where objective_id='a3000000-0000-4000-8000-000000000211'),1::bigint,'fenced append inserts validated owned question');
select is((public.pipeline_claim_questions((select value from calls where name='quickRequest'))->0->>'need')::integer,2,'one unseen question still requests two additional questions');
select is(public.pipeline_prompt_key('  Simplify CASE 1?  '),'simplify case 1','prompt normalization matches the writer key');

-- A frozen Canvas session survives continuation with different newly fetched descriptors.
select public.pipeline_canvas_session('{"ownerId":"aaaaaaaa-0000-4000-8000-000000000211","courseId":"c0000000-0000-4000-8000-000000000211","sessionId":"a6000000-0000-4000-8000-000000000211","canvasCourseId":"101","site":"https://canvas.example.com","summary":{"course":{"id":"c0000000-0000-4000-8000-000000000211"}},"items":[{"id":"a7000000-0000-4000-8000-000000000211","name":"Lecture1.pdf","metadata":{"sourceId":"11"}},{"id":"a7000000-0000-4000-8000-000000000212","name":"Lecture2.pdf","metadata":{"sourceId":"12"}}]}');
select public.pipeline_canvas_session('{"ownerId":"aaaaaaaa-0000-4000-8000-000000000211","courseId":"c0000000-0000-4000-8000-000000000211","sessionId":"a6000000-0000-4000-8000-000000000211","canvasCourseId":"101","site":"https://canvas.example.com","summary":{},"items":[{"id":"a7000000-0000-4000-8000-000000000213","name":"Newly posted.pdf","metadata":{"sourceId":"13"}}]}');
select is((select count(*) from public.pipeline_items where batch_id='a6000000-0000-4000-8000-000000000211'),2::bigint,'continuation keeps the original two selected files');
insert into calls values('canvas1',public.pipeline_canvas_claim('{"ownerId":"aaaaaaaa-0000-4000-8000-000000000211","sessionId":"a6000000-0000-4000-8000-000000000211"}'));
insert into calls values('canvas2',public.pipeline_canvas_claim('{"ownerId":"aaaaaaaa-0000-4000-8000-000000000211","sessionId":"a6000000-0000-4000-8000-000000000211"}'));
select is((select value->>'id' from calls where name='canvas1'),'a7000000-0000-4000-8000-000000000211','Canvas claims first frozen file first');
select is((select value->>'id' from calls where name='canvas2'),'a7000000-0000-4000-8000-000000000212','second continuation cannot claim first file again');
select is(public.pipeline_canvas_claim('{"ownerId":"aaaaaaaa-0000-4000-8000-000000000211","sessionId":"a6000000-0000-4000-8000-000000000211"}'),null::jsonb,'at most two Canvas ingestion claims per owner');
select public.pipeline_canvas_session('{"ownerId":"aaaaaaaa-0000-4000-8000-000000000211","courseId":"c0000000-0000-4000-8000-000000000211","sessionId":"a6000000-0000-4000-8000-000000000212","canvasCourseId":"101","site":"https://canvas.example.com","summary":{},"items":[{"id":"a7000000-0000-4000-8000-000000000214","name":"Lecture1.pdf","metadata":{"sourceId":"11"}}]}');
select is((select state from public.pipeline_items where id='a7000000-0000-4000-8000-000000000214'),'alias','second import session aliases the already claimed Canvas source');
select is((public.pipeline_canvas_summary('{"ownerId":"aaaaaaaa-0000-4000-8000-000000000211","sessionId":"a6000000-0000-4000-8000-000000000212"}')->'files'->>'duplicates')::integer,1,'duplicate summary is session-wide, not counted again on each continuation');

-- Atomic rate receipts cover legacy clients and process-only fallback admissions too.
select public.pipeline_charge_item('{"ownerId":"aaaaaaaa-0000-4000-8000-000000000211","itemId":"e0000000-0000-4000-8000-000000000211"}');
select is((select count from public.rate_limits where owner_id='aaaaaaaa-0000-4000-8000-000000000211' and action='upload'),2,'repeated admission does not charge the upload rate twice');
select public.hit_rate_limit('aaaaaaaa-0000-4000-8000-000000000211','upload',86400,20) from generate_series(1,19);
select public.pipeline_admit('{"ownerId":"aaaaaaaa-0000-4000-8000-000000000211","courseId":"c0000000-0000-4000-8000-000000000211","batchId":"d0000000-0000-4000-8000-000000000299","source":"browser","items":[{"id":"e0000000-0000-4000-8000-000000000299","name":"Over limit.pdf"}]}');
select is(public.pipeline_charge_item('{"ownerId":"aaaaaaaa-0000-4000-8000-000000000211","itemId":"e0000000-0000-4000-8000-000000000299"}'),false,'rate denial is stored atomically with admission receipt');
select throws_ok($$select public.pipeline_attach('{"ownerId":"aaaaaaaa-0000-4000-8000-000000000211","itemId":"e0000000-0000-4000-8000-000000000299","materialId":"f0000000-0000-4000-8000-000000000211","model":"stub"}')$$,'42501',null,'a denied admission cannot bypass the limit by attaching directly');

select public.pipeline_ingestion('{"ownerId":"aaaaaaaa-0000-4000-8000-000000000211","itemId":"e0000000-0000-4000-8000-000000000299","action":"retry"}');
select is((select rate_charged from public.pipeline_items where id='e0000000-0000-4000-8000-000000000299'),false,'retry after rate denial requires a new atomic rate check');

select * from finish();
rollback;
