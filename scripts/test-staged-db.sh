#!/usr/bin/env bash
# Schema-only copy into a disposable database. NEVER resets the shared Supabase stack.
set -euo pipefail
container="${ORCA_TEST_DB_CONTAINER:-supabase_db_orca}"
scratch="orca_pipeline_test_${$}"
folder="$(mktemp -d /tmp/orca-pipeline-db.XXXXXX)"
cleanup() { docker exec "$container" dropdb -U supabase_admin --if-exists "$scratch" >/dev/null 2>&1 || true; rm -rf "$folder"; }
trap cleanup EXIT
# Supabase's migration role can restore extension function settings; postgres cannot.
docker exec "$container" pg_dump -U supabase_admin --schema-only --no-owner postgres > "$folder/schema.sql"
docker exec "$container" createdb -U supabase_admin "$scratch"
docker exec -i "$container" psql -U supabase_admin -d "$scratch" -v ON_ERROR_STOP=1 < "$folder/schema.sql" > "$folder/schema.log" 2>&1 || { tail -30 "$folder/schema.log"; exit 1; }
# The shared local stack can lag main. Bring ONLY this scratch copy up to the branch baseline.
for pair in 'profiles:is_admin:20261110120000_admin.sql' 'materials:held_back:20261110130000_cram_mode.sql' 'profiles:onboarding:20261110150000_onboarding_tips.sql'; do
 table="${pair%%:*}"
 rest="${pair#*:}"
 column="${rest%%:*}"
 migration="${rest#*:}"
 if ! docker exec "$container" psql -U supabase_admin -d "$scratch" -Atc "select exists(select 1 from information_schema.columns where table_schema='public' and table_name='$table' and column_name='$column')" | rg -q '^t$'; then
  docker exec -i "$container" psql -U supabase_admin -d "$scratch" -v ON_ERROR_STOP=1 < "supabase/migrations/$migration" > "$folder/baseline-$column.log" 2>&1 || { tail -30 "$folder/baseline-$column.log"; exit 1; }
 fi
done
if ! docker exec "$container" psql -U supabase_admin -d "$scratch" -Atc "select to_regclass('public.pipeline_tasks') is not null" | rg -q '^t$'; then
 docker exec -i "$container" psql -U supabase_admin -d "$scratch" -v ON_ERROR_STOP=1 < supabase/migrations/20261110160000_staged_upload_pipeline.sql > "$folder/migration.log" 2>&1 || { tail -30 "$folder/migration.log"; exit 1; }
fi
if [ -n "${ORCA_TYPES_OUTPUT:-}" ]; then
 npx supabase gen types typescript --db-url "postgresql://supabase_admin:postgres@127.0.0.1:54322/$scratch" --schema public > "$ORCA_TYPES_OUTPUT"
fi
# Configuration rows are deliberately absent from the schema-only clone; copy bucket
# settings (never object rows or student data) for the existing Storage policy tests.
docker exec "$container" pg_dump -U supabase_admin --data-only --table=storage.buckets postgres > "$folder/buckets.sql"
docker exec -i "$container" psql -U supabase_admin -d "$scratch" -v ON_ERROR_STOP=1 < "$folder/buckets.sql" > "$folder/buckets.log" 2>&1
for spec in supabase/tests/*.sql; do
 docker exec -i -e PGOPTIONS='-c search_path=public,extensions' "$container" psql -U supabase_admin -d "$scratch" -v ON_ERROR_STOP=1 < "$spec" >> "$folder/tests.log" 2>&1 || { tail -40 "$folder/tests.log"; exit 1; }
done
cat "$folder/tests.log"
if rg -q 'not ok|Looks like you failed|Looks like you planned' "$folder/tests.log"; then exit 1; fi
# Two REAL connections contend for the lane; the first holds its transaction while the second arrives.
docker exec -i "$container" psql -U supabase_admin -d "$scratch" -v ON_ERROR_STOP=1 < scripts/fixtures/staged-concurrency.sql > "$folder/fixture.log"
claim="begin; select public.pipeline_claim('{\"ownerId\":\"aaaaaaaa-0000-4000-8000-000000000299\"}'); select pg_sleep(0.3); commit;"
docker exec "$container" psql -U supabase_admin -d "$scratch" -At -v ON_ERROR_STOP=1 -c "$claim" > "$folder/first.log" &
first=$!
docker exec "$container" psql -U supabase_admin -d "$scratch" -At -v ON_ERROR_STOP=1 -c "$claim" > "$folder/second.log" &
second=$!
wait "$first"
wait "$second"
count=$(cat "$folder/first.log" "$folder/second.log" | rg -c 'taskId')
[ "$count" = 1 ] || { echo "Concurrent claims violated one-structure-per-course: $count"; exit 1; }
echo "Two-connection structure claim race passed."
