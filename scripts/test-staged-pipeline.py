#!/usr/bin/env python3
"""Run real phase workers against schema-only scratch PostgREST and a fake model.
No existing database is reset; no real model/provider request is permitted.
"""
import json, os, pathlib, subprocess, tempfile, time, urllib.request, uuid
root = pathlib.Path(__file__).resolve().parents[1]
container = os.environ.get('ORCA_TEST_DB_CONTAINER', 'supabase_db_orca')
name = 'orca_pipeline_integration_' + str(os.getpid())
rest_name = name + '_rest'
processes = []
created = False

def run(args, **kwargs):
    return subprocess.run(args, check=True, cwd=root, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kwargs)
def sql(statement):
    return run(['docker','exec','-i',container,'psql','-U','supabase_admin','-d',name,'-v','ON_ERROR_STOP=1'],input=statement.encode()).stdout
try:
    config = json.loads(run(['docker','inspect','supabase_rest_orca']).stdout)[0]
    env = dict(item.split('=',1) for item in config['Config']['Env'] if '=' in item)
    network = next(iter(config['NetworkSettings']['Networks']))
    run(['docker','exec',container,'createdb','-U','supabase_admin',name]); created = True
    schema = run(['docker','exec',container,'pg_dump','-U','supabase_admin','--schema-only','--no-owner','--no-privileges','postgres']).stdout
    sql(schema.decode())
    if sql("select exists(select 1 from information_schema.columns where table_schema='public' and table_name='materials' and column_name='held_back');").decode().splitlines()[2].strip() != 't':
        sql((root/'supabase/migrations/20261110130000_cram_mode.sql').read_text())
    sql((root/'supabase/migrations/20261110160000_staged_upload_pipeline.sql').read_text())
    sql("grant usage on schema public,private,auth to service_role; grant all on all tables in schema public to service_role; grant execute on all functions in schema public to service_role;")
    sql("""create function public.pipeline_test_seed(payload jsonb) returns jsonb language plpgsql security definer as $$ begin
      insert into auth.users(id,email) values((payload->>'ownerId')::uuid,'stage-integration@example.com');
      insert into public.courses(id,owner_id,slug,name,short,variant,pos_x,pos_y) values((payload->>'courseId')::uuid,(payload->>'ownerId')::uuid,'integration','Logic','LOG','ald',0,0);
      return '{}'; end; $$; grant execute on function public.pipeline_test_seed(jsonb) to service_role;""")
    # Use the test stack's signing secret privately; never print it or persist it in source.
    import base64, hashlib, hmac, secrets
    signing_secret = secrets.token_hex(32)
    encode=lambda x:base64.urlsafe_b64encode(json.dumps(x,separators=(',',':')).encode()).rstrip(b'=')
    header=encode({'alg':'HS256','typ':'JWT'}); claims=encode({'role':'service_role','iss':'supabase','exp':int(time.time())+3600})
    unsigned=header+b'.'+claims
    token=(unsigned+b'.'+base64.urlsafe_b64encode(hmac.new(signing_secret.encode(),unsigned,hashlib.sha256).digest()).rstrip(b'=')).decode()
    uri=env['PGRST_DB_URI'].rsplit('/',1)[0]+'/'+name
    run(['docker','run','--detach','--rm','--name',rest_name,'--network',network,'-p','127.0.0.1:55329:3000','-e','PGRST_DB_URI='+uri,'-e','PGRST_DB_SCHEMAS=public','-e','PGRST_JWT_SECRET='+signing_secret,'-e','PGRST_DB_ANON_ROLE=anon',config['Config']['Image']])
    with tempfile.TemporaryDirectory(prefix='orca-pipeline-integration-') as temporary:
        log=open(pathlib.Path(temporary)/'fake.log','w')
        fake=subprocess.Popen(['node','--experimental-strip-types','e2e/fake-anthropic.ts','55331'],cwd=root,stdout=log,stderr=log); processes.append(fake)
        for port in [55329,55331]:
            for _ in range(100):
                try: urllib.request.urlopen('http://127.0.0.1:'+str(port)+('/__health' if port==55331 else '/'),timeout=.3); break
                except Exception: time.sleep(.1)
            else: raise RuntimeError('Isolated test server did not start')
        child_env=dict(os.environ,ORCA_UPLOAD_PIPELINE='staged',ORCA_MODEL_PROVIDER='anthropic',ORCA_MODEL='claude-opus-5-5',ORCA_READ_MODEL='',ANTHROPIC_API_KEY='fake-test-key',ANTHROPIC_BASE_URL='http://127.0.0.1:55331',NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:55329',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=token,SUPABASE_SECRET_KEY=token,OPENAI_API_KEY='',ORCA_DAILY_BUDGET_USD='100')
        result=run(['node','--experimental-strip-types','--import','./tests/support/register.mjs','scripts/staged-pipeline-integration.ts'],env=child_env)
        print(result.stdout.decode())
except subprocess.CalledProcessError as error:
    # Do not print argv: a Docker environment argument can contain the temporary signing secret.
    print(error.stdout.decode()[-4000:]); print(error.stderr.decode()[-4000:]); raise SystemExit(1)
finally:
    for process in processes:
        process.terminate()
        try: process.wait(timeout=5)
        except subprocess.TimeoutExpired: process.kill()
    subprocess.run(['docker','rm','--force',rest_name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    if created: subprocess.run(['docker','exec',container,'dropdb','-U','supabase_admin','--force',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
