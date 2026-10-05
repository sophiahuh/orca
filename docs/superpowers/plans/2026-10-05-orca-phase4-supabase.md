# Orca Phase 4: Accounts, Supabase and the Server Pipeline

> **Status: approved 2026-10-05, in progress on branch `phase-4`** (from `backend-implementation`;
> merge back into it, as Phase 3 was). CI doesn't run on `phase-4`, so run every check by hand.
> The owner accepted decisions 4 (load everything, revisit later), 5 (no guest mode) and 10 (300
> pages a day, revisit later); 4 and 10 are under "Watch" in `docs/TO-DISCUSS.md`.
>
> - **Task 1 done (2026-10-05, local):** the full local stack (database, auth, Storage, Realtime,
>   Mailpit) starts in a cloud container from Docker Hub; edge functions and analytics are off.
>   Local auth requires email confirmation and 8-character passwords. `.env.example` uses
>   Supabase's newer key names (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`)
>   where this plan says anon and service-role keys; they do the same jobs. The guard tests
>   (`supabase/tests/00_guards.test.sql`: RLS and a non-null `owner_id` on every public table, the
>   `private` schema closed to API roles) were checked to fail on a bad table.
> - **Task 2 done (2026-10-05, local):** five migrations (profiles, courses and materials,
>   structure, activity, storage) and 64 pgTAP checks. Differences from the plan: every id is a
>   UUID, so course ids (now `slug-time`) and calendar ids (`ev-…`) switch to UUIDs in Task 5;
>   children reference their parent by (id, owner_id) or (id, course_id), so a row can't hang off
>   another student's course or another course's topic; the browser can't insert evidence at all
>   (only `/api/evidence` will, Task 3) nor change a finished session; nothing has a delete policy
>   except calendar entries (deleting the account removes everything); topics and questions carry
>   a `sort_order` (the trail and the stock are ordered lists); a question with no objective needs
>   an anchor. `save_structure` upserts only the keys a row gives (a left-out key keeps its value),
>   so the store can send just what changed. `supabase db lint` reports one false positive on
>   `save_structure` (it can't follow the dynamic table name).

Roadmap: `docs/BACKEND-ROADMAP.md`, Phase 4. Decided before this plan (`docs/TO-DISCUSS.md`,
Decided): sign-in is email + password through Supabase Auth, Google later; accounts start fresh
(no import of localStorage data); the server pipeline uses Orca's own Anthropic key only; jobs run
on Trigger.dev; the original file in Supabase Storage is the source of truth for material, with
page text in a `material_pages` table.

**Goal.** A student signs up with email and password, and everything Orca knows about them
(courses, uploads, questions, answers) lives in Supabase under row-level security, so it follows
them to any browser. Uploads go to Storage and are processed on the server by a job that
survives long files, with live progress on screen. Screens don't change: they still read
`useOrca()`. Learner state stays derived, with a stored snapshot per objective so reads don't
replay the whole log.

## Global constraints

- Everything in `CLAUDE.md` "Invariants". Learner state is derived: the snapshot is a cache of
  the fold (`applyAnswer`), never a place that writes mastery. A snapshot can always be rebuilt
  from the evidence log, and tests prove the rebuilt one equals the stored one.
- Pure modules (`src/lib/mastery`, `src/lib/course`, `src/lib/pipeline` except the callers) stay
  pure and keep their Node-loadable imports. New server code imports them; it doesn't fork them.
- Every table has `owner_id uuid not null references auth.users on delete cascade` and RLS
  `owner_id = auth.uid()`. Nothing trusts an `owner_id` sent from the browser.
- Nothing is faked: with no Supabase configured the app says so; a failed save says it failed
  and doesn't count the answer; a job that fails says why on the review screen.
- Live claims need live checks (invariant): "works against local Supabase" and "works against
  the hosted project" are different claims, and the plan's status notes say which one was made.
- Before every commit: `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run test:db` once it
  exists, and `npm run test:e2e` when a screen, the store or a route changed.

## What needs the owner, and when

| Needed | For | Blocks |
|---|---|---|
| Nothing | Tasks 1–9 against local Supabase (the CLI's Docker stack) and an inline job runner | nothing |
| Supabase project (URL, anon key, service-role key, DB password) | Task 10: push migrations, RLS with two real users, Storage, auth emails | the live check only |
| Trigger.dev project (secret key, project ref) | Task 10: deploy and run the jobs | the live check only |
| `ANTHROPIC_API_KEY` | Task 10: a real upload end to end | the live check only |
| Email provider (Resend, Postmark or similar) as Supabase's SMTP | real students receiving confirmation and reset emails | launch, not the build |

Local Supabase in a cloud container: Docker works (start `dockerd`), Docker Hub pulls work but
are rate-limited, and the AWS image registry the CLI uses by default is blocked. Task 1 pins
image sources so `supabase start` pulls from Docker Hub; if the rate limit still blocks the full
stack, DB tests run against the `supabase/postgres` image alone, and the auth and Storage e2e
wait for CI (GitHub runners pull freely).

## Decisions taken in this plan

Ones marked **(review)** are judgement calls worth a second look; they go into
`docs/TO-DISCUSS.md` when they land.

1. **One write path per kind of data.**
   - **Course structure** (topics, objectives, questions, relations, runs): the pure ops and
     `applyUploadPlan` still compute the new structure in TypeScript. The changed rows are saved
     through one Postgres function, `save_structure(course_id, rows jsonb)`, that upserts them in
     one transaction. Both the browser (`editStructure`, under RLS) and the jobs (service role)
     use it. Nothing is deleted (archive or merge, as now).
   - **Evidence**: only through `POST /api/evidence` (decision 3).
   - **Everything else** (course settings, calendar events, finished sessions, reflections,
     onboarding): direct inserts and updates from the browser under RLS.
2. **Tables** (one migration per group, ported from the platform's 0001/0003/0004/0012/0015/
   0016/0017 where they exist, with its two `artifacts` bugs fixed: students get an UPDATE policy,
   and `status` is in the column grant):
   - `profiles` (id = auth user, timezone, onboarded), created by a trigger on sign-up.
   - `courses` (slug unique per owner, name, short, variant, pos, trail, `review_config` jsonb,
     `weights` jsonb). Config and sliders stay jsonb: they're read and written whole, and zod
     validates them on both sides.
   - `topics`, `objectives`, `relations`, `questions`: one column per field the TypeScript types
     have; nested parts that are always read whole (`signals`, `uncertain`, `source`, `rubric`,
     `table`, `anchor`) are jsonb. Questions get a trigger enforcing "an anchor unless its
     objective is inferred" (the roadmap's check constraint; a plain CHECK can't see the
     objective).
   - `materials` (filename, type, assigned, due, reflect, reflection, `storage_path`,
     `content_hash`, size, mime, `status`: uploaded → reading → processing → ready | failed,
     `error`), `material_pages` (material, number, text; primary key (material, number)).
   - `pipeline_runs` (today's `PipelineRun` plus `status`, `progress` jsonb, `job_id`, `error`).
   - `session_results` (today's `QuizResult`), `calendar_events`.
   - `evidence_events` (answers and confusion, one table with a `kind` column). Insert-only:
     no UPDATE or DELETE policy for anyone but the service role.
   - `objective_state` (decision 3).
3. **Snapshots** (`objective_state`: objective, course, `accumulator` jsonb, `rules_version`,
   `stale`, `version`, `last_event_at`).
   - `POST /api/evidence` takes the answer, stamps `at` with the server's clock (a browser's
     clock can't be trusted for spacing), loads the objective's snapshot, runs `applyAnswer`, and
     calls `record_evidence(event, accumulator, expected_version)`, which inserts the event and
     updates the snapshot in one transaction only if the version still matches. On a mismatch
     (two tabs answering at once) the route rebuilds from the log and retries once.
   - `RULES_VERSION` lives next to `MASTERY_RULES`; changing a rule means bumping it (a test
     fails if `MASTERY_RULES` changes without a bump, by hashing it). A snapshot with an older
     version counts as stale.
   - A merge, un-merge or re-tag marks only the objectives involved stale (trigger on
     `objectives.merged_into` and on `questions.objective_id`).
   - Stale snapshots are rebuilt on read: `GET /api/state?course=` returns every snapshot of a
     course, replaying the log for stale ones and saving the result. Reads never replay
     otherwise.
4. **The browser store keeps its shape.** `OrcaProvider` loads the signed-in student's data
   once (courses, structure, materials, sessions, events, snapshots) into the same `OrcaState`
   screens read now, and every action becomes an optimistic local update plus a save. A save
   that fails rolls the update back and shows "Couldn't save: …"; an answer that couldn't be saved
   isn't counted. Objective state comes from snapshots; the other derived reads (streak, last
   seen, poor sessions, deep-review cadence) still compute from the loaded events. Loading every
   event is fine at one student's scale (thousands of rows); windowing it is later work
   (accepted; "Watch" in `docs/TO-DISCUSS.md` says when to revisit).
5. **No signed-out mode in the product.** With Supabase configured, every page except sign-in,
   sign-up, reset and the email callback redirects to sign-in. Without the env vars the app shows
   "Orca isn't connected to its database" instead of falling back to the browser. localStorage
   keeps only per-device conveniences (none today); `orca:v3`–`orca:v8` keys are cleared on load,
   and `materialPages` in the browser is removed. No offline or guest mode (accepted).
6. **Auth** (Supabase Auth, `@supabase/ssr`): sign up with email and password (minimum 8
   characters; Supabase's leaked-password check too if the project's plan includes it), confirm by email,
   sign in, sign out, forgot and reset password. Errors are generic ("Invalid email or
   password."). `src/proxy.ts` refreshes the session cookie on every request and does nothing
   when the env vars are missing. Auth screens are drawn in Orca's style (parchment card, lip
   buttons, the orca). The student's timezone is read from the browser at sign-up and editable in
   Settings.
7. **Uploads.** The browser asks `POST /api/materials` for a signed upload URL (25 MB limit,
   PDF only for now, filename sanitised `/[^a-zA-Z0-9._-]/g → "_"`, path
   `${userId}/${materialId}/${safeName}` in a private `materials` bucket with owner-folder
   policies), uploads the file straight to Storage, then calls `POST /api/materials/:id/process`.
   A file with the same content hash as one already in the course is recognised and not
   processed again (what re-uploading does today, now by hash).
8. **Jobs.** The pipeline's logic stays the pure `runUpload` / `runTopUp` with an injected step
   caller. Two plain server functions wrap them, `processMaterial(materialId)` (read the PDF with
   pdf.js in Node into `material_pages`, run the pipeline with the server caller, apply the plan
   and save it with `save_structure`) and `topUp(sessionId)`. Trigger.dev tasks call these
   functions and nothing else. `ORCA_JOBS=inline` runs them inside the route instead (local dev,
   e2e and CI, where no Trigger.dev project exists); `ORCA_JOBS=trigger` is production. Progress
   goes into `pipeline_runs.progress`, which the browser follows through Supabase Realtime, so
   both modes show progress the same way (`pipeline_runs` joins the Realtime publication, still
   under RLS).
9. **Model calls are server-only, with Orca's key.** `/api/pipeline/[step]` and the browser
   pipeline (`client.ts`, browser-only providers, Ollama) are removed; the step caller moves into
   a server module the jobs use. `/api/grade` stays a route but needs a signed-in student. The
   "Your AI" section of Settings is hidden (its code stays until "Bring-your-own model" is
   decided). Without `ANTHROPIC_API_KEY` uploads are saved and read into pages but nothing is
   generated, and prose answers are self-marked, as today.
10. **Cost guard.** Each student can have the model process at most 300 pages a day (uploads and
    top-ups together); past that, an upload is stored and read but waits with "Daily limit
    reached, processing resumes tomorrow". (Accepted for now; "Watch" in `docs/TO-DISCUSS.md`
    says when to revisit the number.)
11. **Day boundaries** use the student's timezone from their profile everywhere, including the
    server's fold: `localDayKey` gets a `dayKeyIn(timeZone)` sibling built on `Intl`, and the
    server always passes it (the Phase 1 carry-over).
12. **Testing.**
    - `npm run test:db`: SQL tests (pgTAP, bundled in Supabase's Postgres) for every policy with
      two users, the anchor trigger, `save_structure`, `record_evidence`'s version check and the
      stale triggers.
    - Unit tests: the snapshot path (a stored accumulator plus new events equals a full replay),
      the rules-version hash, `dayKeyIn` across DST, the jobs with a fake caller and an
      in-memory database double.
    - e2e against local Supabase with a fake Anthropic API: a small HTTP server that answers the
      Messages API with canned tool outputs per pipeline step, pointed at by the SDK's base URL.
      Fixtures are seeded through the service role instead of localStorage. Every existing e2e
      keeps its meaning.
    - CI: a job that starts the Supabase CLI stack and runs `test:db` and e2e.
13. **New dependencies**, each recorded in the roadmap: `@supabase/supabase-js` and
    `@supabase/ssr` (client and cookie session), `supabase` CLI as a dev dependency (local stack,
    migrations, generated types), `@trigger.dev/sdk` (jobs). No ORM; generated types
    (`supabase gen types`) instead of hand-written ones.

## Tasks

### Task 1 — Local stack and tooling
`supabase init`; image sources pinned so `supabase start` works from Docker Hub; scripts
`db:start`, `db:reset`, `db:types`, `test:db`; `.env.example` with every variable; `CLAUDE.md`
"Environment gotchas" for starting Docker in a cloud container. Proves: an empty migration
applies and a pgTAP smoke test passes locally.

### Task 2 — Schema and RLS
Migrations for decision 2, owner policies on every table, the Storage bucket and its policies,
the profile trigger, the anchor trigger, `save_structure`. Generated types committed. Proves
(`test:db`): user B can't read, update or insert into anything of user A's, including Storage
objects; evidence can't be updated or deleted; a question without an anchor is refused unless its
objective is inferred.

### Task 3 — Snapshots and evidence writes
`objective_state`, `record_evidence`, stale triggers, `RULES_VERSION` with its hash test,
`dayKeyIn`, `/api/evidence`, `/api/state`. Proves: snapshot plus events equals replay; a version
conflict retries from the log; a rules bump and a merge mark the right snapshots stale and the
next read rebuilds them.

### Task 4 — Auth
Supabase clients (browser, server, service role), `src/proxy.ts`, auth screens and server
actions, the email callback, sign-out, redirect when signed out, timezone in Settings. Proves
(e2e on local Supabase, which captures emails in its local inbox): sign up, confirm, sign in,
reset password, sign out, signed-out redirect.

### Task 5 — The store on Supabase
`OrcaProvider` loads from Supabase and saves through decision 1's paths; rollback and error on a
failed save; the old localStorage keys cleared; the not-configured screen. The e2e fixture seeds
through the service role. Proves: every existing e2e passes against local Supabase, and a second
browser signed into the same account sees the same courses and progress.

### Task 6 — Uploads to Storage
`/api/materials` (signed upload), the upload screen sending the file there, content-hash
recognition, `material_pages` read on the server. Proves: the ALD deck uploads, its pages land in
`material_pages`, and re-uploading it adds nothing.

### Task 7 — Jobs
The server step caller, `processMaterial`, `topUp`, the inline runner, the Trigger.dev tasks
(`trigger.config.ts`, `src/trigger/`), progress through Realtime on the review screen and the
session end card, the daily page limit. Remove `client.ts`, `/api/pipeline/[step]` and the
browser pipeline path; hide "Your AI". Proves: the upload and top-up e2e pass with the fake
Anthropic API in inline mode; unit tests cover the limit and a failed job's message.

### Task 8 — Model routes behind sign-in
`/api/grade` and `/api/llm/status` need a session; the grade route uses Orca's key only.
Proves: signed out gets 401; a prose answer is graded through the fake API.

### Task 9 — CI and docs
CI job with the Supabase stack; roadmap (Phase 4 built, dependencies and why), `CLAUDE.md`
(stack, routes, env, how to run locally), `docs/TO-DISCUSS.md` (the review items). Proves: CI
green on the merge into `backend-implementation`.

### Task 10 — Live verification (needs the owner's projects)
Link the hosted Supabase project and push migrations; prove RLS with two real accounts; deploy
the Trigger.dev tasks; set Vercel env vars; one real ALD upload end to end with
`ANTHROPIC_API_KEY`; confirm sign-up and reset emails arrive once SMTP is set. Status notes say
which of these ran.

## Acceptance

- A new student signs up with email and password, confirms, signs in, and lands on an empty map.
- Uploading an ALD deck stores the file, shows live progress, and produces the same review
  screen as today; the questions survive a sign-out and sign-in on another browser.
- Answers save through `/api/evidence`; objective state read from snapshots matches a full
  replay; a stale snapshot is rebuilt on its next read.
- A second account can't see or change anything of the first, in tables or Storage (`test:db`).
- No page works signed out, no model call works signed out, and nothing reads or writes
  application data in localStorage.
- All checks, `test:db` and the e2e suite pass locally and in CI; Task 10's live checks are
  either done or listed as not yet run.
