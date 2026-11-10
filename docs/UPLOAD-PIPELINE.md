# Staged upload pipeline

Implemented on `upload-pipeline-parallelism`, based on main. Activation is explicit; the default
is the existing whole-upload queue. This branch has not activated hosted processing.

## Execution and ownership

`/api/materials/admit` reserves an ordered manifest before a browser hashes/uploads files.
Single files, pasted notes, chat text and websites use singleton admissions. Folder ingestion uses
two workers. Canvas freezes the selected files and syllabus in a durable import session before
claiming up to two downloads; continuations reuse the session rather than selecting again.
Byte verification binds each item to its canonical material and parent run. Verified duplicates
become aliases and release the ordering barrier.

The phase path is `uploads.ts` / `server/canvas.ts` → `server/materials.ts` →
`server/jobs/start.ts` → `server/staged/schedule.ts` → `server/staged/run.ts`:

1. **Prepare:** two files per owner may read scans/figures concurrently. Successful batches and
   schema-checked model responses are checkpointed.
2. **Structure:** one writer per course holds the lane through extraction/reconciliation and an
   atomic save. The earliest unresolved admission is the barrier. A coherent snapshot and course
   revision reject stale writes; a conflict gets at most two retries. Existing semantic topic and
   objective reconciliation remains in the model pipeline. Saving releases the lane immediately.
3. **Questions:** workers use the latest canonical objective, source pages and stock. Uploads,
   top-ups and dives share objective/flavor leases and append-only commits. Fresh stock and source
   checks at commit discard duplicate, surplus or removed-source output. Initial warm-up is
   allocated once per course (up to ten objectives). Quick/deep stock stays distinct; session
   top-ups retain the existing add-two behavior.

Task rows are the durable dispatch outbox. Both inline mode and Trigger use the same database
claims. Trigger completion dispatches successors; the hourly sweep and `/api/runs/check` recover
lost dispatches and expired attempts. Browser ingestion expires after fifteen minutes and is
recoverable only if the actual stored bytes exist. Expiry cannot reconstruct an abandoned upload.
Pause lets an active phase settle and blocks subsequent phases. Stop fences the attempt; already
saved structure remains. Retry resumes unfinished phases without replaying a committed structure.

The database owns ordering, leases, revision checks and committing transactions. Browser roles
can read their own manifest items but cannot mutate pipeline internals. Server RPCs are
service-role-only and verify owner/course/material consistency and live execution tokens.

## Model costs and limits

Each paid provider attempt reserves a conservative input/output token and dollar bound before
calling the model, including retries and calls outside uploads. Limits are four active calls per
owner and `ORCA_MODEL_CONCURRENCY` globally (default twenty), plus existing daily page/token and
global dollar limits. Owner days use the student's timezone; global dollars use UTC. Page charges
are idempotent. Usage retains the attempt's admission time across midnight.

Known usage settles the reservation; a lost response retains an unknown-usage hold for its budget
day. Reservation estimates can cause earlier waiting than actual billing would require. There is
no strict round-robin provider fairness or reserved interactive capacity in this implementation.
A capacity miss parks the phase instead of holding an execution worker polling the provider.

Parallelism does not itself add model calls. Successful paid calls are cached by prompt, model and
budget. Conflicting structure edits can require extra extraction calls, and source removal or
objective merges during writing can discard already-paid surplus. There is no new semantic
postprocessing/deduplication pass. Actual latency and dollar savings require a separately
approved real-model benchmark; fake tests establish correctness, not production speedups.

Completed response caches are retained seven days, failed-run caches thirty days; completed large
task checkpoints are cleared by the sweep. Settled reservation records are retained thirty days.
Unknown holds remain auditable. Parent runs and canonical course data are retained normally.

## Activation and rollback

Use the same flag on the web server and Trigger workers. Do not switch a running deployment's
flag independently of its workers. The migration is additive with its control row disabled.

1. Finish the repository merge gate and apply
   `supabase/migrations/20261110150000_staged_upload_pipeline.sql` to the intended environment
   through the normal reviewed migration workflow. Deploy compatible web and worker code.
2. Stop new admissions temporarily and drain legacy running or handed-off jobs. Inspect
   `npm run pipeline:uploads -- status`. The database refuses cutover while legacy workers remain.
3. Convert pending legacy uploads/top-ups/dives using
   `npm run pipeline:uploads -- backfill --project-ref <expected-project-ref>`.
4. Enable the database gate using
   `npm run pipeline:uploads -- enable --project-ref <expected-project-ref>`.
5. Set `ORCA_UPLOAD_PIPELINE=staged` for web and workers, then reopen admissions. Production uses
   `ORCA_JOBS=trigger`; local development may use inline mode. Monitor phase failures, unknown
   reservations and budget waiting.

The CLI reads `.env.local` / `.env` and requires the exact project ref for mutations. Status is
read-only. Enabling replaces the old owner-wide upload running index with a legacy-only index;
the per-course phase constraint provides the staged structure exclusion.

For rollback, stop new admissions, keep compatible workers and the staged flag until all protocol-2
work has settled or been explicitly stopped, then disable the database gate with
`npm run pipeline:uploads -- disable --project-ref <expected-project-ref>` and return both web
and workers to the legacy flag. Do not drop tables, restore the old index while staged jobs run,
or send protocol-2 parents through old whole-upload workers. Disabling admission does not undo
saved structure or migrate protocol-2 work backwards.

## Verification

- `npm test`, `npx tsc --noEmit`, `npm run lint`.
- `npm run test:uploads:db`: schema-only disposable database, all repository pgTAP specs, plus
  two real concurrent connections contending for one course lane. Copies only Storage bucket
  configuration; does not reset the shared local stack or copy student rows.
- `npm run test:uploads:integration`: isolated disposable database/PostgREST and fake provider;
  executes the real phase workers, folder overlap, topic reuse, source union, once-only warm-up,
  and question-only retry. Outbound model requests are restricted to the local fake server.

The local production build is blocked by this environment denying Turbopack's internal process
port bind while processing KaTeX CSS. Browser, HTTP isolation and evidence merge-gate suites still
need to run in the normal locked local stack before merge. No real-model benchmark or hosted
activation has been performed.
