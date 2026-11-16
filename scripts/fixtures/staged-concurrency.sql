-- Disposable-database fixture for two separate psql connections; never used against hosted data.
insert into auth.users(id,email) values('aaaaaaaa-0000-4000-8000-000000000299','stage-concurrency@example.com');
insert into public.courses(id,owner_id,slug,name,short,variant,pos_x,pos_y) values('c0000000-0000-4000-8000-000000000299','aaaaaaaa-0000-4000-8000-000000000299','parallel','Parallel','PAR','ald',0,0);
select public.pipeline_enable('{"enabled":true}');
insert into public.materials(id,owner_id,course_id,filename,type,status) values
 ('f0000000-0000-4000-8000-000000000298','aaaaaaaa-0000-4000-8000-000000000299','c0000000-0000-4000-8000-000000000299','A.pdf','Lecture','ready'),
 ('f0000000-0000-4000-8000-000000000299','aaaaaaaa-0000-4000-8000-000000000299','c0000000-0000-4000-8000-000000000299','B.pdf','Lecture','ready');
insert into public.pipeline_runs(id,owner_id,course_id,material_id,kind,at,model,status,protocol_version) values
 ('b0000000-0000-4000-8000-000000000298','aaaaaaaa-0000-4000-8000-000000000299','c0000000-0000-4000-8000-000000000299','f0000000-0000-4000-8000-000000000298','upload',now(),'gpt-6.1-sol','queued',2),
 ('b0000000-0000-4000-8000-000000000299','aaaaaaaa-0000-4000-8000-000000000299','c0000000-0000-4000-8000-000000000299','f0000000-0000-4000-8000-000000000299','upload',now(),'gpt-6.1-sol','queued',2);
insert into public.pipeline_items(id,batch_id,owner_id,course_id,sequence,source,name,material_id,run_id,state) values
 ('e0000000-0000-4000-8000-000000000298','e0000000-0000-4000-8000-000000000298','aaaaaaaa-0000-4000-8000-000000000299','c0000000-0000-4000-8000-000000000299',1,'browser','A.pdf','f0000000-0000-4000-8000-000000000298','b0000000-0000-4000-8000-000000000298','active'),
 ('e0000000-0000-4000-8000-000000000299','e0000000-0000-4000-8000-000000000298','aaaaaaaa-0000-4000-8000-000000000299','c0000000-0000-4000-8000-000000000299',2,'browser','B.pdf','f0000000-0000-4000-8000-000000000299','b0000000-0000-4000-8000-000000000299','active');
insert into public.pipeline_tasks(run_id,owner_id,course_id,material_id,phase) values
 ('b0000000-0000-4000-8000-000000000298','aaaaaaaa-0000-4000-8000-000000000299','c0000000-0000-4000-8000-000000000299','f0000000-0000-4000-8000-000000000298','structure'),
 ('b0000000-0000-4000-8000-000000000299','aaaaaaaa-0000-4000-8000-000000000299','c0000000-0000-4000-8000-000000000299','f0000000-0000-4000-8000-000000000299','structure');
