# Phase 4: Parallel Execution Plan for What's Left

> **Status: done 2026-10-06** (Waves 0–3 built; Wave 3's merge into `backend-implementation` waits for
> the owner). Wave 0 ran as planned on the teammate's machine; the six Wave 1 agents then ran out of
> credits (two had finished but never pushed), so one session redid Waves 1–3 sequentially on
> `phase-4` in the merge order, one commit per workstream, and the 9b fold-in is in the Phase 4 plan's
> status block, CLAUDE.md, the roadmap, TO-DISCUSS and SETUP-HOSTED (the monitoring SQL); the
> workstream notes (`plans/notes/`) were then removed, as 9b says. The whole-branch review (R) ran
> after integration and its findings were fixed in Wave 3 (Phase 4 plan status block). Originally: Replaces the "How the rest is run" line in
> `2026-10-05-orca-phase4-supabase.md` (one subagent per task, one after another). That plan still
> defines *what* each task builds; this one defines *how* the rest is run: which agents, in which
> waves, owning which files. Scope: the 7a review and its loose ends, Tasks 7b, 7c, 8 and 9, and
> the deferred review findings listed in the Phase 4 plan's status block. Task 10 needs the
> owner's hosted projects and stays out of the waves.

The old order (7a review → 7b → 7c → 8 → 9) ran in sequence for no reason. 7b, 7c and 8 only share
contracts that one short wave can fix in place, and the deferred findings and CI have no
dependencies at all.

## A. Codebase findings

- **Pure core, thin server.** Domain logic is pure TypeScript that runs under plain Node:
  `src/lib/mastery` (the fold, snapshots), `src/lib/course`, `src/lib/pipeline`
  (`runUpload`/`runTopUp` with an injected `CallStep`) and `src/lib/jobs/jobs.ts` (the jobs, over
  a `JobStore` interface). Server adapters live in `src/lib/server/*`: `model.ts` is the step
  caller, `job-store.ts` the service-role store scoped to one owner, and `jobs/start.ts` and
  `jobs/run.ts` start and run jobs. Routes are under `src/app/api/*`.
- **Every model call goes through two functions:** `stepCaller()` and then `completeJson()` in
  `src/lib/llm-server.ts`. The one exception is `/api/grade`, which still calls `completeJson`
  directly and takes the student's own model settings, the question and the rubric from the
  request. That makes these two functions the place for the cost guard (7c), and Task 8's main
  job is to route grading through them too.
- **Prompts and schemas** are in `src/lib/pipeline/prompts.ts` and `schemas.ts`. Untrusted text
  is pasted in raw today (`[slide n]\n…`), so 7b rewrites most of the prompt builders.
  `e2e/fake-anthropic.ts` recognises each step by its system-prompt prefix and parses lines of the
  generate prompt (`- <uuid>: name`), so changing the prompt format breaks the e2e suite unless
  the fake changes with it.
- **The database layer:** 11 migrations, with owner-only RLS on every table (a guard test
  enforces it). `save_structure` is the only way structure gets written, and runs are written by
  the server only. `pipeline_runs.status` already allows `waiting`, intended for the daily limit.
  Types are generated into `src/lib/supabase/database.types.ts`.
- **What already exists for the cost guard and injection defences:** `src/lib/limits.ts` holds
  only the input limits; `src/lib/pipeline/budget.ts` sets `max_tokens` per step;
  `src/lib/untrusted/` has the sanitiser and the hidden-text check. There is no screening yet, no
  `security_events`, no `model_usage`, no rate limits and no per-student queue.
- **The browser side:** the store (`src/lib/store.tsx`, 770 lines) is one big provider.
  `src/components/quiz/QuizRunner.tsx` calls `/api/grade` and records the session result. The
  review page follows the run through `useRun`.
- **Tests:** unit tests (`node:test`), pgTAP (`supabase/tests/0x_*.sql`), e2e on a fixed port
  3100 with the fake API on 3101, `check:isolation` and `check:evidence`. They all run against
  **one local Docker Supabase stack** (`project_id = "orca"`, ports 543xx), which is the biggest
  practical limit on running agents in parallel (section D).
- **CI** runs only typecheck, lint, unit tests, build and e2e. It never starts Supabase, so its
  e2e job can't pass today, and it doesn't run on `phase-4`.
- **`e2e/global-setup.ts` calls `/api/llm/status` signed out** to make sure no real model is
  reachable. Task 8 puts that route behind sign-in, which would silently break this safety check.

## B. True dependencies

1. **The 7a review comes before 7c.** Review fixes land in `jobs.ts`, `start.ts`, `run.ts` and
   `model.ts`, the same files 7c rewrites.
2. **A model-call context before 7c and Task 8.** Usage metering and budgets need to know the
   owner and the kind of call at the `stepCaller`/`completeJson` choke point, and the grade call
   has to pass through it. If Wave 0 settles that signature, 7c and Task 8 can run side by side.
3. **The untrusted-text encoder before 7b and Task 8.** Both JSON-encode untrusted text; a
   ~30-line shared helper built in Wave 0 removes the dependency between them.
4. **Screening prose answers and turning off grading for repeat offenders** needs 7b's screen and
   Task 8's grade route. It is the only real link between those two, so it moves to Wave 2
   integration instead of sequencing them.
5. **Docs (9b) and the whole-branch review** come after everything has merged.
6. **Task 10** is blocked on the owner's hosted projects and a real key.

## C. Parallel execution plan

### Wave 0 — one agent: W0, "7a close-out and contracts"

- **End state:** 7a reviewed (base `81abfff`) and its Important findings fixed; a test for the
  no-key path; `npm run build` and `check:evidence` rerun; and the contracts merged into
  `phase-4`:
  - `ModelCtx` threaded through `stepCaller(ctx)` and `completeJson(…, { ctx })`, required and
    typed (it does nothing yet);
  - `src/lib/untrusted/encode.ts` (`untrustedBlock`, `UNTRUSTED_POLICY`) with tests;
  - `scripts/stack-lock.sh`;
  - `docs/superpowers/plans/notes/README.md` (the rules for parallel work).
- **Owns:** the 7a files, `model.ts`, `llm-server.ts`, the jobs' and routes' call sites (`ctx`
  only), `encode.ts`, the lock script.
- **Must not:** change prompts, schemas, limits or migrations, except as a review fix.

### Wave 1 — six in parallel

| | Workstream | End state | Owns | Must not touch |
|---|---|---|---|---|
| **A** | 7b injection defences | Pattern screen; untrusted text JSON-encoded in every pipeline prompt; output validators (ids, anchors, URLs/HTML/markdown links, instruction-like text dropped with a reason); `instructionsFound` and the review-screen warning; `security_events` (migration + trigger from run findings); red-team fixtures; injected-deck e2e; injected deck in `score:extraction` | `src/lib/untrusted/screen.ts`, `prompts.ts`, `schemas.ts`, pipeline `run.ts`, `topup.ts`, review page (done block), `fake-anthropic.ts` (prompt parsing), `tests/fixtures/injection/`, migrations `2026100521xxxx`, `/api/reflect` (note screening) | `model.ts`, `llm-server.ts`, `budget.ts`, `jobs.ts`, `start.ts`, `grading.ts`, `/api/grade`, `sanitize.ts` |
| **B** | 7c cost guard | `model_usage` (metered in `completeJson` through `ctx`); daily page and token budgets with `waiting` runs and resume; one job at a time per student; rate limits counted in Postgres; timeouts, ≤2 retries, spend-limit 429 → "budget used up"; global daily circuit breaker; monitoring query | `model.ts`, `llm-server.ts`, `budget.ts`, `limits.ts`, `jobs.ts`, `start.ts`, server `jobs/run.ts`, `job-store.ts`, `src/lib/server/rate-limit.ts`, `progress-text.ts`, `src/trigger/jobs.ts`, migrations `2026100522xxxx`, the rate-limit line in `/api/materials` and `/api/reflect` | `prompts.ts`, `schemas.ts`, pipeline `run.ts`, `grading.ts`, `sanitize.ts` |
| **C** | Task 8: grading behind sign-in | `/api/grade` takes `{questionId, response}` only and loads the question and rubric scoped to the owner; Orca's key through `ctx: grade`; answer encoded with `untrustedBlock`; 401 signed out, 400 if a rubric or llm is sent, 503 without a key (self-mark); `/api/llm/status` and `/models` behind sign-in; global setup signs in through the secret key and a bearer token | `/api/grade`, `grading.ts`, `/api/llm/*`, the grade fetch in `QuizRunner.tsx`, `e2e/global-setup.ts`, `fake-anthropic.ts` (a `grade` scenario field only) | `model.ts` internals, store, prompts, schemas |
| **D** | Learner-data findings (snapshots + store) | A newer `rules_version` is never overwritten; the 409 message says what caused it; same-millisecond events break ties by id (`RULES_VERSION` bumped if needed); `dayKeyIn` caches its formatter; a test for the 503 path. Store: a quiz score isn't saved when its answers failed; actions during a reload are refused with a message; reloading mid-session doesn't reassemble the quiz (test); reflection confusion is idempotent; sliders save on release; scheduling e2e safe across midnight | `src/lib/mastery/*`, `snapshot-store.ts`, `/api/evidence`, `/api/state`, `store.tsx`, the score-save path in `QuizRunner`, the reflect page, Settings sliders, migrations `2026100523xxxx` | `jobs.ts`, `start.ts`, `model.ts`, prompts |
| **E** | Auth and upload findings | `SITE_URL` for email links (and in `.env.example`); a recorded decision on the proxy's `getClaims`; the PKCE note for Task 10; cleanup of failed or abandoned uploads (Storage + rows; scheduled task in a new `src/trigger/maintenance.ts`); the sanitiser keeps tabs and doesn't flatten superscripts into ambiguous text (checked on ALD L02/L03); the PDF read budget actually enforced | `src/app/auth/*`, `src/proxy.ts`, `src/lib/auth/*`, `sanitize.ts`, `src/lib/server/materials.ts`, `src/lib/material/*`, `src/trigger/maintenance.ts`, migrations `2026100524xxxx` | `jobs.ts`, `start.ts`, prompts, store |
| **F** | 9a CI with Supabase | A CI job that sets up the Supabase CLI, `db start`, `test:db`, `check:isolation`, `check:evidence`, e2e; runs on `phase-*`; traces on failure | `.github/workflows/ci.yml`, `playwright.config.ts` (CI env only) | everything in `src/` |

### Wave 2

- **I, integration** (one agent). Merges in the order **F → E → C → D → B → A** (smallest and
  least shared first), rebasing each branch and rerunning `db:reset` and `db:types` after each.
  Then it does the cross-wiring no branch owned: screen prose answers in `/api/grade` (A's
  screen); turn off model grading for repeat offenders (reads A's `security_events`); make sure
  the grade and reflect routes have B's rate limits and metering. Then the full suite.
- **Then in parallel:** **R**, the whole-branch review (base `backend-implementation`), and
  **9b**, the docs (fold `plans/notes/*.md` into the Phase 4 plan's status block, CLAUDE.md, the
  roadmap and TO-DISCUSS).

### Wave 3

Fix R's findings, run the full suite, and merge `phase-4` into `backend-implementation` once the
owner confirms. Task 10 follows once the owner has done `docs/SETUP-HOSTED.md`.

## D. Shared-risk areas

1. **One shared Docker stack and fixed ports (54321, 3100, 3101).** Parallel `db:reset`, e2e or
   pgTAP runs wipe each other's data. Rule: `test:db`, `test:e2e`, `check:*` and `db:reset` run
   only through `scripts/stack-lock.sh` (an `mkdir` lock that runs `db:reset` from the caller's
   worktree first). Unit tests, tsc and lint run freely. More than about four agents at once
   locally will queue on the lock; cloud agents, each with its own Docker, avoid it.
2. **`database.types.ts` and migrations.** Each workstream has its own block of migration
   timestamps (above). Nobody hand-merges the types file: regenerate it after a rebase.
3. **`e2e/fake-anthropic.ts`.** A owns how it parses prompts. B and C only add optional
   `Scenario` fields (B: an error `type` for the spend-limit 429; C: a `grade` outcome). Step
   detection by system-prompt prefix must keep working, so A keeps those first lines unchanged.
4. **`model.ts` / `llm-server.ts`.** W0 fixes the `ModelCtx` signature; B owns everything inside.
   A and C only call them.
5. **Two files named `run.ts`:** `src/lib/pipeline/run.ts` (A) and `src/lib/server/jobs/run.ts`
   (B). "A run stops at its first failure" belongs to A if the pipeline needs a change.
6. **`QuizRunner.tsx`:** C edits the grade fetch, D the score save. Merge C first.
7. **The review page:** A edits the done block, B the waiting and progress block.
8. **`limits.ts`:** B owns it; A keeps its own limits in `src/lib/untrusted/`.
9. **Docs** (CLAUDE.md, the Phase 4 plan, the roadmap, TO-DISCUSS): only 9b edits them. Agents
   write `docs/superpowers/plans/notes/<workstream>.md`.
10. **Defaults set here, which B may change (recording why):** a `waiting` run resumes through a
    sweep each time a job starts or finishes, plus a scheduled Trigger.dev task in trigger mode;
    token prices come from the `claude-api` skill, never from memory.

## E. Agent assignment

| Workstream | Assignment |
|---|---|
| W0 | Implementation agent plus a reviewer subagent (the review is the task) |
| A (7b) | Implementation agent plus a reviewer: security-critical, the largest workstream |
| B (7c) | Implementation agent plus a reviewer: money and concurrency |
| C (Task 8) | One implementation agent |
| D | Implementation agent plus a reviewer: mastery rules and data loss |
| E | One implementation agent |
| F | One implementation agent; tiny and touches nothing else |
| I, 9b | One agent each |
| R | A reviewer |

7b and 7c aren't split further: their pieces share the same prompts, migration and tests, so
splitting them would add coordination without speeding anything up.

## F. Execution graph

```
Wave 0:        W0  7a review+fixes + contracts (ModelCtx, encode.ts, stack-lock, notes rules)
Wave 1 ║:      A 7b | B 7c | C T8 | D learner fixes | E auth+uploads | F CI
Wave 2:        I integration (merge F→E→C→D→B→A, cross-wire, full suite)
Wave 2b ║:     R whole-branch review | 9b docs
Wave 3:        fixes → full suite → merge into backend-implementation (owner OK)
Owner-gated:   Task 10 live checks
```

## G. Agent prompts

Put the common block at the top of every prompt below.

### Common block

```
COMMON CONTEXT (read first)
Repo: /Users/amandachiang/Downloads/School/Projects/orca. Base branch: phase-4 (after Wave 0's
merge, for Wave 1). Work in your own git worktree on branch p4-<your-workstream>; commit there;
do not push and do not merge.
Read CLAUDE.md, AGENTS.md (Next 16 differs from your training data: read node_modules/next/dist/docs
before writing Next code), the Phase 4 plan
docs/superpowers/plans/2026-10-05-orca-phase4-supabase.md (status block, decisions 10 and 13) and
this execution plan (docs/superpowers/plans/2026-10-05-orca-phase4-execution.md, sections C and D).
Load the repo skills .claude/skills/learner-evidence and .claude/skills/assessment before touching
mastery, evidence, question or grading code, and the claude-api skill before touching any model
call.
Invariants: never call a real model (never set ANTHROPIC_API_KEY; tests use injected fake callers
or e2e/fake-anthropic.ts). Pure modules (src/lib/mastery, course, pipeline, jobs, untrusted) keep
Node-loadable imports (relative, ending .ts, import type). No silent placeholders: unknown or
failed shows as an explicit state or throws. Every table is owner-only under RLS; service-role
code scopes every query to the verified owner. Nothing in course structure is deleted. Learner
state is derived; never store mastery.
Shared local stack: one Docker Supabase and fixed ports 3100/3101 serve every agent. Run
test:db, test:e2e, check:isolation, check:evidence and db:reset ONLY via
`scripts/stack-lock.sh <npm command>`. tsc, lint and unit tests run freely.
Migrations: only in your timestamp block (given below). After changing one: (under the lock)
db:reset, then npm run db:types. Never hand-edit src/lib/supabase/database.types.ts.
Docs: do not edit CLAUDE.md, docs/BACKEND-ROADMAP.md, docs/TO-DISCUSS.md or either plan. Write
your status, differences from the plan and judgement calls to
docs/superpowers/plans/notes/<ws>.md.
Make reasonable decisions on minor choices yourself; don't ask. Stop and report only if a decision
would contradict the plan or CLAUDE.md, or is a product question for the owner.
Tests are lean: happy paths plus the edge cases that matter (security, isolation, data loss,
mastery). Per commit: npx next typegen (if routes changed), npx tsc --noEmit, npm run lint, the
covering tests. Before returning: npm test, test:db, test:e2e, check:isolation (and check:evidence
if you touched evidence or snapshots), npm run build, all green; fix failures, don't skip them.
Commit messages: full sentences in the repo's existing style.
Return: what you built, the commits, test counts from the final run, judgement calls, anything
left undone and why.
```

### W0 — 7a close-out and contracts

```
You own Wave 0: close out Phase 4 Task 7a and lay the contracts that six parallel agents will
build on. Nothing else starts until you finish, so stay narrow.
1. Review Task 7a (diff 81abfff..HEAD on phase-4) against the plan's Task 7 and decisions 8–9, and
   fix every Important finding (correctness, isolation, data loss, a run left in "running"). List
   Minor ones in your notes file instead of fixing them. Use a reviewer subagent for the review
   if you can.
2. Finish 7a's leftovers: a test for the no-key path (startUploadJob/startTopUpJob answer
   no-model and nothing is queued; unit level with a fake db is fine), rerun npm run build and
   check:evidence.
3. Contracts (real code, no stubs that fake behaviour):
   a. ModelCtx = { ownerId: string; kind: "upload" | "top-up" | "reflect" | "grade"; runId?: string }
      in src/lib/server/model.ts. stepCaller(ctx) takes it (required); completeJson gains an
      optional opts.ctx. Thread it through every current caller (jobs/run.ts, /api/reflect).
      It has no behaviour yet; a later agent adds metering inside.
   b. src/lib/untrusted/encode.ts: untrustedBlock(source: "uploaded_pdf" | "reflection_note" |
      "student_answer" | "generated_question", payload: unknown): string → a labelled JSON
      object string (JSON.stringify, so it can't break out of quotes or tags), plus an exported
      UNTRUSTED_POLICY system-prompt paragraph (decision 13 wording). Unit tests: quotes, closing
      braces, fake role tags and U+E0000 tag characters stay inside the string.
   c. scripts/stack-lock.sh: mkdir-based lock in /tmp (wait with a timeout, release on exit or
      signal) that cds to the caller's worktree, runs npm run db:reset, then the given command.
      Add an npm script "locked" that uses it.
   d. docs/superpowers/plans/notes/README.md: the migration timestamp blocks (A 2026100521xxxx,
      B 2026100522xxxx, D 2026100523xxxx, E 2026100524xxxx), the merge order F→E→C→D→B→A, and
      the ownership rules for fake-anthropic.ts (A owns how prompts are parsed; others only add
      optional Scenario fields), limits.ts (B), the review page (A: done block; B: waiting and
      progress block) and QuizRunner (C: grade fetch; D: score save).
May modify: the 7a files (src/lib/jobs, src/lib/server/**, src/trigger, the routes 7a added or
changed), src/lib/llm-server.ts (signature only), src/lib/untrusted/encode.ts, scripts/, package.json
scripts, tests. Must not: change prompts.ts, schemas.ts, budget.ts, limits.ts or add migrations
except as a review fix.
Done when: review findings fixed and listed; all checks in the common block green; the contracts
are on phase-4 in separate commits.
```

### A — 7b injection defences

```
You own Phase 4 Task 7b: the prompt-injection and untrusted-text defences for the pipeline and
reflection (plan decision 13). The result: untrusted text can't steer a model call unnoticed, and
nothing the model writes reaches a student without passing validators in code.
Build:
- src/lib/untrusted/screen.ts: pattern screen (OWASP phrasing: "ignore previous instructions",
  "you are now", "system prompt", role tags, fuzzy misspellings; long Base64/hex runs decoded and
  rescanned). A hit sets suspected and returns the quoted span; it never blocks.
- Every pipeline prompt in src/lib/pipeline/prompts.ts sends material, notes and existing
  course items through untrustedBlock (src/lib/untrusted/encode.ts) with UNTRUSTED_POLICY in the
  system prompt, data before the task's instructions. Keep each step's system prompt's FIRST
  LINE unchanged (e2e/fake-anthropic.ts recognises steps by it). Keep the material context
  byte-identical across the calls of one upload (prompt caching).
- Output validators (in the pipeline, pure): every string length-limited in schemas.ts; every id
  returned must be one the call was given; anchor slides must exist; generated text is sanitised
  and refused if it holds a URL not in the material, HTML, a markdown link or an instruction-like
  pattern. Refused items are dropped with a reason in run.dropped, never repaired.
- Extraction schema gets instructionsFound (quoted spans). Together with the screen, a non-empty
  result is recorded on the run (a new pipeline_runs column, e.g. security jsonb, mapped in
  src/lib/supabase/app-rows.ts and the PipelineRun type) and shown on the review screen (done
  block only): "This file contains text aimed at an AI; check what it added."
- security_events table (your migration block 2026100521xxxx): owner_id, kind, check, ref ids,
  quote span ≤ 240 chars, at; RLS on, no student policies, service role only; a trigger or the
  server writes rows from a run's security findings (don't change jobs.ts or the JobStore);
  /api/reflect screens the note and logs. pgTAP: a student can't read or write it; extend the
  guard tests if needed.
- Red-team set in tests/fixtures/injection/ (hidden-text PDF, zero-width and tag smuggling,
  Base64 payload, a note trying to reset every objective) through the screen and validators in
  unit tests; an e2e uploading an injected deck against the fake API (add a scenario that replies
  "as if injected") shows the warning and drops the bad rows; scripts/score-extraction.ts includes
  an injected ALD deck (built from docs/samples/ald; --dry must still pass without a key).
- Update e2e/fake-anthropic.ts to parse your new prompt format (you own how it parses prompts).
May modify: src/lib/untrusted/ (except sanitize.ts and encode.ts; call them, don't edit them),
src/lib/pipeline/{prompts,schemas,run,topup,apply}.ts, src/lib/data.ts (PipelineRun only),
src/lib/supabase/app-rows.ts (run mapping), the review page's done block, src/app/api/reflect,
e2e/fake-anthropic.ts, e2e/upload.spec.ts or a new e2e spec, scripts/score-extraction.ts,
tests/, supabase/ (your block).
Must not touch: src/lib/server/model.ts, src/lib/llm-server.ts, src/lib/pipeline/budget.ts,
src/lib/limits.ts, src/lib/jobs/jobs.ts, src/lib/server/jobs/*, src/lib/grading.ts, /api/grade,
store.tsx. Prose-answer screening and turning off grading for repeat offenders are NOT yours
(integration does them); export what they need.
Done when: the common block's full suite is green, including the new red-team units, pgTAP and
the injected-deck e2e.
```

### B — 7c cost guard

```
You own Phase 4 Task 7c: the cost guard (plan decision 10). The result: no student, and no crowd
of students, can make Orca spend without bound, and every limit tells the student what happened.
Build:
- Metering: inside completeJson / stepCaller, using the ModelCtx already threaded through them,
  record every call's input and output tokens and estimated cost in model_usage (migration block
  2026100522xxxx: owner_id, kind, run_id, model, tokens, cost_usd, at; service role only, RLS on,
  no student policies). Prices come from the claude-api skill, kept in one constant; never guessed.
- Budgets checked on the server before a call: per student per day, 300 pages through the model
  (uploads and top-ups together) and a token budget; a global ORCA_DAILY_BUDGET_USD circuit
  breaker summing model_usage. Over the limit, a job's run goes to status "waiting" with progress
  { stage: "waiting", reason } and the UI says "Daily limit reached, processing resumes
  tomorrow" (or the global wording). Default resume design: a sweep when any job starts or
  finishes, plus a scheduled Trigger.dev task in trigger mode, both calling one function; change
  it if you find better, and record why.
- One job at a time per student: a second upload or top-up queues behind the running one
  (database-enforced, e.g. a unique index or a claim check per owner) and starts when it finishes.
- Rate limits counted in Postgres (fixed-window counter keyed by owner and action, checked and
  incremented in one call): grading 60/min, reflection matching 10/hour, uploads 20/day; 429 with
  retry-after. Put the helper in src/lib/server/rate-limit.ts and wire it into /api/materials and
  /api/reflect. If /api/grade has already been rewritten by the grade agent when you rebase, wire
  it there too; otherwise integration will.
- Bounded calls: max_tokens per step reviewed in budget.ts, a timeout on every call, at most 2 SDK
  retries, no retry on 400 or on a spend-limit 429. The spend-limit 429 maps to "Orca's model
  budget is used up for this month" and is never retried (check the claude-api skill for how the
  API signals it). Add an optional error type to fake-anthropic's `fail` scenario to simulate it.
- A monitoring SQL query (top students by tokens, runs that hit a limit) in your notes file.
May modify: src/lib/server/model.ts, src/lib/llm-server.ts, src/lib/pipeline/budget.ts,
src/lib/pipeline/progress-text.ts, src/lib/limits.ts, src/lib/jobs/jobs.ts,
src/lib/server/jobs/*, src/lib/server/job-store.ts, src/lib/server/rate-limit.ts, src/trigger/jobs.ts,
the review page's waiting and progress block, add-material and session end card limit messages,
/api/materials and /api/reflect (rate-limit line only), e2e/fake-anthropic.ts (add optional Scenario
fields only), tests/, supabase/ (your block).
Must not touch: src/lib/pipeline/{prompts,schemas,run,topup}.ts, src/lib/untrusted/*,
src/lib/grading.ts, store.tsx.
Tests: unit (budget checks, waiting and resume, queue order, spend-limit mapping, the circuit
breaker with an in-memory store), pgTAP (model_usage and the counter are closed to students; the
counter is atomic), e2e (an upload past the daily limit shows waiting; a second upload queues).
Done when: the common block's full suite is green.
```

### C — Task 8, grading behind sign-in

```
You own Phase 4 Task 8. The result: prose answers are graded only for a signed-in student, with
Orca's key, against the question and rubric stored in the database, never anything the request
supplies.
Build:
- /api/grade: body { questionId, response } only (zod). 401 signed out (forStudent in
  src/lib/server/student.ts); 400 if the body carries question, rubric or llm; load the question
  (prompt, rubric) scoped to the owner, 404 if not theirs; response trimmed to 2,000 characters,
  sanitised (src/lib/untrusted/sanitize.ts) and sent through untrustedBlock("student_answer", …)
  with UNTRUSTED_POLICY in the system prompt (src/lib/grading.ts); call completeJson with Orca's key
  and ctx { ownerId, kind: "grade" } (src/lib/server/model.ts exposes the model and key; add a
  small server grader there or in src/lib/server/grade.ts). No key → 503, and QuizRunner keeps
  self-marking as now. A grading failure records nothing (assessment skill).
- QuizRunner sends { questionId, response } and no longer sends llm.
- /api/llm/status and /api/llm/models need a session. e2e/global-setup.ts must keep its "no real
  model" guard: have it create a throwaway confirmed user with the secret key (as e2e/fixture.ts
  does) and call status with Authorization: Bearer. The guard must still fail loudly.
- fake-anthropic: add only an optional Scenario field for the grade outcome.
May modify: src/app/api/grade, src/app/api/llm/*, src/lib/grading.ts, src/lib/server/grade.ts
(new), the grade fetch in src/components/quiz/QuizRunner.tsx, e2e/global-setup.ts,
e2e/fake-anthropic.ts (Scenario field only), tests.
Must not touch: model.ts or llm-server.ts internals (call them), prompts.ts, schemas.ts,
store.tsx, the score-saving logic in QuizRunner, src/lib/llm.ts, YourAI.tsx (kept until "Bring
your own model" is decided). Rate limits and answer screening are added later by others; leave a
clear spot.
Tests: unit for grading.ts encoding; e2e: signed out 401, a body carrying a rubric 400, a prose
answer graded through the fake API and recorded as evidence. Done when: the common block's full
suite is green.
```

### D — learner-data findings

```
You own the deferred review findings about snapshots and the store (Phase 4 plan status block,
"Review findings deferred": Snapshots and Store). Load the learner-evidence skill first.
Fix, each with a test:
- Snapshots: a snapshot with a NEWER rules_version than the server's is never overwritten
  (compute read-only and return it, or refuse with a clear error; pick one and record why); the
  409 says whether a concurrent answer or a structure change caused it; events in the same
  millisecond fold in one order on both extend and rebuild (tie-break by id; if this can change
  a fold result, bump RULES_VERSION with its hash and golden replay in
  tests/mastery/snapshot.test.ts); dayKeyIn caches its Intl formatter per timezone; a test for
  the 503 missing-env path of /api/evidence.
- Store: a quiz's score isn't saved as a finished session when some of its answers failed to
  save (or is saved marked as incomplete; pick one, and agenda and streak must not count what
  failed); actions taken while the store reloads after a failed save are refused with their own
  message, not silently lost; an e2e proves reloading mid-session doesn't reassemble the quiz; a
  half-failed reflection can't repeat its confusion events (make them idempotent, e.g. a
  client-made event id the server de-duplicates; migration block 2026100523xxxx if you need
  one); weight sliders save on release, not on every change; the scheduling e2e can't fail across
  midnight (seed relative to the profile's day start, or skip when within a minute of it).
- Leave "my_data returns the whole evidence log" alone (it's under Watch).
May modify: src/lib/mastery/*, src/lib/server/snapshot-store.ts, src/app/api/{evidence,state},
src/lib/store.tsx, src/components/store/*, the score-saving path in
src/components/quiz/QuizRunner.tsx (not the grade fetch), the reflect page, the Settings sliders,
e2e/scheduling.spec.ts, e2e/store.spec.ts, tests, supabase/ (your block).
Must not touch: src/lib/jobs, src/lib/server/jobs, src/lib/server/model.ts, src/lib/pipeline, the
grade fetch in QuizRunner.
Done when: the common block's full suite is green, including check:evidence.
```

### E — auth and upload findings

```
You own the deferred review findings about auth and uploads (Phase 4 plan status block, "Review
findings deferred": Auth and Uploads).
Fix, each with a test:
- Auth: confirmation and reset links are built from a configured SITE_URL (add it to
  .env.example and the env reader; refuse to send links without it in production), not the request's
  Host header. The proxy's getClaims letting a revoked session through until expiry: decide
  (accept and record why, since data paths use getUser, or verify on navigations) and record it.
  The PKCE "link opened in another browser" limit: write the hosted email-template change needed
  (token-hash templates) into your notes for Task 10; no code needed unless it's local.
- Uploads: cleanup of files and rows from failed reads and abandoned uploads (older than a set
  age), as one function run on a schedule from a NEW file src/trigger/maintenance.ts and callable
  inline; owner-scoped, never touching ready materials. Sanitiser: keep tabs, and stop NFKC from
  making superscripts ambiguous (x² → x2, 2⁻ⁿ): check the actual text of
  docs/samples/ald/L02 and L03, then pick a fix (e.g. NFC plus mapping superscripts and subscripts to ^
  and _) and test it with real snippets. The 40 s PDF read budget must actually stop a read
  that never yields (e.g. per-page checks plus an abort), with a test.
May modify: src/app/auth/*, src/proxy.ts, src/lib/auth/*, src/lib/supabase/env.ts,
.env.example (append only), src/lib/untrusted/sanitize.ts, src/lib/server/materials.ts,
src/lib/material/*, src/trigger/maintenance.ts (new), e2e/auth.spec.ts, e2e/upload.spec.ts (cleanup
cases only), tests, supabase/ (block 2026100524xxxx).
Must not touch: src/trigger/jobs.ts, src/lib/jobs, src/lib/server/jobs, src/lib/server/model.ts,
src/lib/pipeline, store.tsx, src/lib/untrusted/{screen,encode}.ts.
Done when: the common block's full suite is green.
```

### F — CI with Supabase

```
You own Phase 4 Task 9a: CI that runs the whole local proof on GitHub Actions. The result: one
workflow that runs typecheck, lint, unit tests and build, plus a job that starts the Supabase CLI
stack and runs npm run test:db, check:isolation, check:evidence and the Playwright suite
(ORCA_JOBS=inline; Playwright starts the fake Anthropic API itself; no real key anywhere, and
the job must fail if ANTHROPIC_API_KEY is set to anything but the fake). Run on pushes to main,
backend-implementation and phase-*, and on pull requests. Upload Playwright traces and the
Supabase logs on failure. Cache npm and the Playwright browser.
May modify: .github/workflows/ci.yml, playwright.config.ts (CI-only env), package.json (scripts
only), docs/superpowers/plans/notes/F.md.
Must not touch: anything in src/, supabase/migrations, e2e specs.
You can't run GitHub Actions from here: validate the YAML (actionlint if installed, else a careful
read), and run the job's exact command sequence locally under scripts/stack-lock.sh to prove it
works. Don't push; report the commands and results.
```

### I — integration (Wave 2)

```
You own Phase 4 integration. Merge the Wave 1 branches into phase-4 in this order: p4-F, p4-E,
p4-C, p4-D, p4-B, p4-A. For each: rebase, resolve conflicts (keep both sides' intent; the
ownership rules are in docs/superpowers/plans/notes/README.md), db:reset and npm run db:types
under the lock, tsc, lint, unit tests. Then cross-wire what no single branch owned:
1. /api/grade screens the prose answer with src/lib/untrusted/screen.ts and logs to
   security_events;
2. a student whose answers are repeatedly flagged (pick a threshold, record it) gets model grading
   turned off (self-marking only) until the owner clears it;
3. /api/grade and /api/reflect have B's rate limits, and grading is metered in model_usage.
Test each, then run the full suite (npm test, test:db, test:e2e, check:isolation, check:evidence,
build) and fix until green. Don't edit docs except your notes file.
```

### R — whole-branch review (Wave 2b)

```
Review phase-4 against backend-implementation for the Phase 4 plan's acceptance list, decisions
10 and 13, and CLAUDE.md's invariants. Focus: isolation (every service-role query scoped to an
owner), money (a way to cause model calls past the limits), injection (untrusted text reaching a
prompt unencoded, model output reaching the UI unvalidated), data loss, mastery rules, a run that
can stay "running" forever. Read-only. Report findings ranked by severity with file:line and a
concrete failure scenario; say what you checked and found fine.
```

### 9b — docs (Wave 2b)

```
Fold docs/superpowers/plans/notes/*.md into the documentation: the Phase 4 plan's status block
(7a review, 7b, 7c, Task 8, 9a, the deferred findings: done, or recorded with why not), CLAUDE.md
(start-here handoff, stack, routes, env vars, environment gotchas including the stack lock,
what exists), docs/BACKEND-ROADMAP.md (Phase 4 status, new tables and why), docs/TO-DISCUSS.md
(each judgement call agents made, as an assumed decision for the owner), and mark this execution
plan done. Match the existing docs' voice. Say which claims were proved locally and that nothing
has run hosted. Then delete the notes directory. Docs only.
```
