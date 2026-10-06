# Orca — study app (v1 web prototype)

Orca turns every college class into an "island" on a knowledge map. Inside an island is a
Duolingo-style trail of topics; topics run quizzes; the orca mascot nudges reviews on a cadence the
student configures per class. Tagline: "Mastery Made Easy."

Design source of truth: Figma file `Xt9CiD6SpdN0BPma1q2pzZ` ("Orca – Study App Mockups").
Reference renders live in `docs/figma/` (`screens.png` = all 11 screens, `styleguide.png`, and the
traced SVG assets in `docs/figma/assets/`). Frames are 1194×834; v1 ships as a laptop website.

## Reporting to the owner

Keep replies short. End each piece of work with a brief: **Done** (what changed, with file
links), **Next** (the next step), **Notes** (only explanations or decisions the owner needs).
A few bullets each; no restating the plan, no long background, no option surveys. Answer a
question directly first, then stop.

## Start here (handoff, updated 2026-10-05)

**Who it's for.** A college student who wants to actually master their classes, not cram. They
create a course, upload its material (lecture decks, syllabus, homework, past exams), and Orca
turns it into objectives ("can do X") with checked quiz questions, then tracks mastery per
objective from their answers and spaces reviews (FSRS) until each one sticks. The test course is
Advanced Logic Design (ALD, Columbia ELEN); `docs/samples/ald/` has its real decks, and Sophia
authored and reviewed the reference objectives, questions and quiz rubric.

**Where things stand.**
- **Phase 4 is built on branch `phase-4`, pushed to GitHub, not merged** (from `backend-implementation`; merge it
  back once the owner confirms, as Phase 3 was). `backend-implementation` holds Phases 1–3; `main`
  is far behind (the pre-Phase-1 prototype), and nothing has been merged into it or opened as a PR.
- Phases 1 (mastery core), 2 (uploads build the course) and 3 (scheduling and sessions) are built
  on-device. Phase 4 (plan Tasks 1–9, status notes at the top of
  `docs/superpowers/plans/2026-10-05-orca-phase4-supabase.md`): the local Supabase stack, the schema
  with row-level security, Storage and `save_structure`, the evidence path (`objective_state`
  snapshots, `record_evidence`, `POST /api/evidence`, `GET /api/state`), auth, the store on Supabase,
  uploads to Storage read into `material_pages`, the pipeline as server jobs (`processMaterial` /
  `topUp`, inline locally, Trigger.dev tasks written but never run), grading behind sign-in, the
  cost guard (metering, daily budgets with waiting runs, one job at a time per student, rate limits,
  bounded calls), the injection defences (data-block prompts, pattern screen, output validators,
  `security_events`), CI with the Supabase stack, the review findings from Tasks 3–7 and the
  whole-branch review's fixes (Wave 3). Checks last run green (2026-10-06, after Wave 3):
  `npx tsc --noEmit`, `npm run lint`, `npm test` (262), `npm run test:db` (172),
  `npm run check:isolation` (43), `npm run check:evidence` (44), `npm run test:e2e` (55),
  `npm run build`. CI now runs on `phase-*` too, but GitHub
  hasn't run it yet. **Nothing has run against a hosted Supabase, Trigger.dev or Anthropic**; the
  owner's setup steps are in `docs/SETUP-HOSTED.md` and the live checks are Task 10.
- No app data is kept in the browser any more (the old `orca:materialPages` key is cleared on
  load); don't build on browser storage.
- **Never run against a real model.** Unit tests inject fake step callers; the browser tests run
  against `e2e/fake-anthropic.ts`, a fake Messages API Playwright starts on port 3101 (the dev
  server gets `ANTHROPIC_BASE_URL` pointing there and a fake key, beating `.env.local`), and
  `e2e/global-setup.ts` stops the run if the server's model calls aren't local (e.g. a reused
  dev server started with a real key). Only `npm run score:extraction` and uploading in `npm run dev`
  spend money. No session so far has
  had `ANTHROPIC_API_KEY`, so the prompts in `src/lib/pipeline/prompts.ts` (rewritten for data
  blocks in Task 7b) are untested against Claude, `npm run score:extraction` has no baseline
  (`scripts/extraction-baseline.json` doesn't exist), and the weight constants are untuned.
- The Vercel deploy (https://orca-lake-omega.vercel.app) is from before Phase 1; it doesn't show
  any of this.

**Next, in order.**
1. **Task 10, with the owner's credentials in the cloud environment** (`docs/SETUP-HOSTED.md`): link
   the hosted Supabase project and push the migrations, run `npm run check:isolation` against it,
   set `SITE_URL`, `ORCA_JOBS`, `ORCA_DAILY_BUDGET_USD` and `ANTHROPIC_API_KEY` on Vercel, switch the
   hosted email templates to token-hash links, deploy, and do one real ALD upload end to end. Then
   `ANTHROPIC_API_KEY=… npm run score:extraction -- --update-baseline` (it includes an injected deck
   now) and look at the review screen; fix prompts where extraction or question checks go wrong.
2. Merge `phase-4` into `backend-implementation` once the owner confirms (CI runs the whole proof
   on the push). Then the Phase 3 numbers and the assumptions listed in `docs/TO-DISCUSS.md`
   ("Assumed while finishing Phase 4") want a decision or real use.
3. Phase 5 per `docs/BACKEND-ROADMAP.md`.
Open product questions the student/owner must decide are in `docs/TO-DISCUSS.md`. Don't decide
them silently; list what you assumed.

**Environment gotchas.**
- Cloud containers: Playwright's Chromium build doesn't match; run e2e with
  `PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run test:e2e`.
- Local Supabase (Phase 4) runs in Docker: `npm run db:start` (prints the local URL and keys for
  `.env.local`; template in `.env.example`), `npm run db:reset` (re-applies `supabase/migrations/`),
  `npm run test:db` (pgTAP files in `supabase/tests/`), `npm run check:evidence` (starts its own
  `next dev` on a free port against the local stack and drives `/api/evidence` and `/api/state`
  over HTTP; `ORCA_URL=…` uses a running server instead), `npm run check:isolation` (two throwaway
  accounts over the real HTTP API; pass `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and
  `SUPABASE_SECRET_KEY` to run it against a hosted project), `npm run db:types`, `npm run db:stop`.
  After changing a migration, `npm run db:reset`, then `npm run db:types` to refresh
  `src/lib/supabase/database.types.ts`. In a cloud container, start the daemon first
  (`sudo dockerd > /tmp/dockerd.log 2>&1 &`) and pull from
  Docker Hub, since the CLI's default AWS registry is blocked there:
  `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io npm run db:start`. Docker Hub rate-limits anonymous
  pulls; if it answers 429, wait and retry.
- **Anything that resets or writes the local database, or binds ports 3100/3101, goes through the
  stack lock:** `npm run locked -- npm run test:e2e` (also `test:db`, `check:isolation`,
  `check:evidence`, `db:types`). It takes `/tmp/orca-supabase-stack.lock`, runs `db:reset` from your
  worktree first, then the command (`scripts/stack-lock.sh`; rules in
  `docs/superpowers/plans/2026-10-05-orca-phase4-execution.md`, section D). `tsc`, lint and
  `npm test` run freely. Migrations added by parallel work use per-workstream timestamp blocks.
- A background suite in a cloud container can be cut off by a container restart (the Docker daemon
  dies with it): rerun `sudo dockerd`, `npx supabase stop --no-backup`, then `db:start`.
- Run `npx next typegen` before `tsc` after adding a route; delete a stale `.next/dev` if `tsc`
  complains about a route that no longer exists.
- `npm test` loads `tests/support/register.mjs`, which resolves `@/…` and Next's bare subpaths, so a
  unit test may import a route module (`tests/server/evidence-route.test.ts`). Pure modules still
  keep Node-loadable imports and don't rely on it.
- PDFs are parsed on a `worker_threads` thread (`src/lib/material/read-pdf.ts`); the worker runs
  pdf.js's worker module by its package name, so `next.config.ts` lists it in
  `outputFileTracingIncludes` for the process route.
- The server stamps answers with its own clock, so e2e tests run on the real clock and seed past
  days relative to it (`daysAgo` in `e2e/fixture.ts`; see `e2e/scheduling.spec.ts`); freezing the
  browser's clock wouldn't move the server's. (Playwright's `page.clock.setFixedTime` also freezes
  `motion` animations after the first page.)
- e2e: seed with `seedState(student, …)` (secret key), read back with `stored(page, student)`;
  ids must be UUIDs (`ids(...)` makes fresh ones per spec). `page.goto` waits for the app's saves
  (`<html data-saving>`) first, since navigating away would cancel one.
- Pure modules (`src/lib/mastery`, `src/lib/course`, `src/lib/pipeline`, `src/lib/jobs`) must
  load under plain Node: relative imports with `.ts`, `import type`, no TS parameter properties.
- The superpowers skills named below may not be installed in every session; if they aren't,
  follow the same flow by hand (plan doc first, then task-by-task commits with tests).

**Map of the docs.** `docs/BACKEND-ROADMAP.md` (decisions + phases, what's done), `docs/MASTERY-PLAN.md`
(learner model), `docs/TO-DISCUSS.md` (open questions), `docs/superpowers/plans/` (per-phase plans
with status notes), `docs/QUIZ-RUBRIC.md` (what makes a good question), `docs/OBJECTIVES-ALD.md`
(reference objectives / evaluation benchmark), `docs/BACKEND-NOTES.md` (what to port from the
earlier `ai-native-learning-platform` repo), `docs/ANIMATION.md`, `docs/SETUP-HOSTED.md` (what the
owner sets up in Supabase, Trigger.dev, Anthropic, Vercel and the cloud environment for live
checks, and the SQL for watching costs and security events). Repo-local skills:
`.claude/skills/learner-evidence` and `.claude/skills/assessment` (load before touching mastery
or question code).

## Product model (the vision the backend is built toward)

Full detail: `docs/BACKEND-ROADMAP.md` (decisions and phases), `docs/MASTERY-PLAN.md` (learner
model), `docs/TO-DISCUSS.md` (open questions). In short:

- **Course → topic → objective → questions.** An objective is a "can do X" statement and the unit
  of mastery. Every question belongs to one objective.
- **Objectives are created once per course**, when material is uploaded: extraction proposes new
  topics and objectives against the course's existing list, reconciliation matches duplicates,
  and the student reviews topics. Inferred objectives (from general knowledge, not the material)
  are allowed and labelled. Unreviewed objectives are quizzable, with an "unreviewed" tag.
- **Learner state is derived, never stored.** Every graded answer appends an evidence event;
  objective status (unseen → learning → mastered → fading → retired, plus mixed-up; table in
  `docs/MASTERY-PLAN.md` §2.3), topic
  progress, the island's mastery level, the due list and the streak are computed from the events
  and the clock. Spacing uses FSRS (`ts-fsrs`, Anki's scheduler) under Orca's own mastery bar.
  The mastery rule is a fold (`applyAnswer`), so the server can keep snapshots instead of
  replaying the log.
- **Weights.** Every topic and objective has a weight (neutral 1.0). Claude records signals from the
  material (coverage, material type, explicit emphasis, what builds on what); code computes the
  weight. The Settings material-type sliders feed it and set deep review's question mix.
- **Practice.** Questions are generated ahead into a per-objective stock; a quiz session is
  assembled instantly at start, sized to the course's time budget. Deep review follows each
  course's own cadence.
- **Self-reported confusion** in a homework reflection resets the matching objectives to learning.
- **Topics are not gates.** Every topic is playable; the trail shows progress, not locks.
- **Islands show mastery.** Each island has one of four fixed looks (uncharted, sprouting,
  growing, thriving) from the share of its course's objectives that are mastered.
- **Nothing hardcoded or faked.** The app ships no courses; every course starts empty and its
  content comes from uploads. Missing data shows as an explicit empty or error state.
- **No in-app AI chat.** Claude is used for extracting material, generating questions and grading
  short answers. Students' own Claude/ChatGPT can connect through an MCP connector (planned) that
  logs study activity as a priority signal, never as mastery.

## Stack

- Next.js 16 (App Router, `src/` dir, TypeScript), Tailwind v4, `motion` (Framer Motion) for animation.
- The app's data is in Supabase (Phase 4, branch `phase-4`), behind a React context
  (`src/lib/store.tsx`): `supabase/` holds `config.toml`, the
  migrations (profiles, courses, materials and their pages, pipeline runs, topics, objectives,
  relations, questions, finished sessions, calendar entries, the evidence log, the `materials`
  Storage bucket, `save_structure`, the `objective_state` snapshots with `record_evidence`,
  `save_snapshot` and their stale-mark triggers, and the consistent reads `course_structure` and
  `my_data`) and the pgTAP tests; generated types are in
  `src/lib/supabase/database.types.ts`; env variables are listed in `.env.example`. Every table is
  owner-only under RLS, children reference parents with the owner or course in the key, and the
  browser can't write evidence or snapshots: only `POST /api/evidence` does, with the service
  role. `src/lib/supabase/server.ts` has the server client (session cookie or `Authorization:
  Bearer`) and the secret-key client; `env.ts` throws "isn't connected" when variables are
  missing (routes answer 503); `rows.ts` maps rows to the mastery types (pure); `browser.ts` is
  the browser client; `cookieClient()` is for server actions. Auth (Task 4): `src/proxy.ts`
  (session refresh, signed-out redirect, CSP with a nonce; `src/lib/csp.ts`, `src/lib/auth/` are
  pure), actions in `src/app/auth/actions.ts`, screens `/sign-in`, `/sign-up`, `/forgot-password`,
  `/reset-password`, callback `/auth/callback`, Account card in Settings, and the root layout shows
  "isn't connected" without the env vars. `react/no-danger` is an error. e2e specs import `test`
  from `e2e/fixture.ts`, which signs in a throwaway student; Playwright reads the Supabase URL and
  keys from `supabase status` (stack must be up) unless `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`
  and `SUPABASE_SECRET_KEY` are set.
  `src/lib/server/` holds route helpers (`student.ts`: 503/401 and the verified user), the
  Supabase `SnapshotStore`, the job store and job start/run adapters, `model.ts` (the step caller:
  Orca's key, metering, per-call budget guard), `usage.ts` (metering and the daily sums),
  `rate-limit.ts`, `security.ts` (security events), `grade.ts` (the prose grader) and
  `materials.ts`. Screens only talk to `useOrca()`. `src/lib/supabase/app-rows.ts`
  (pure) maps the app's types to rows and back, and computes the changed rows a structure save sends.
  Tables added in Phase 4's second half: `model_usage` and `rate_limits` (7c) and `security_events`
  (7b), all service-role only; `pipeline_runs` gained `objective_ids` and `security`.
  Env vars (`.env.example`): the Supabase three, `ANTHROPIC_API_KEY`, `ORCA_JOBS`, `SITE_URL`
  (where emailed links come back; required in production), `ORCA_DAILY_BUDGET_USD` (the
  service-wide daily ceiling; unset = none), `TRIGGER_*`.
- Model calls use the Claude API (`claude-opus-5-5`) through `completeJson` (`src/lib/llm-server.ts`:
  10-minute timeout, at most 2 retries of transient failures, spend-limit answers never retried,
  every reply's tokens reported to `onUsage`). Load the `claude-api` skill before writing any model
  call if it's available; prices live in `src/lib/pricing.ts` with their source and date. Without a
  key, uploads are saved without generating anything and prose answers are self-marked; the same
  when model grading is turned off for a student (`/api/llm/status` → `grading: "self"`).
- Unit tests: `node:test` with Node's type stripping (Node ≥ 22.6), run with `npm test`.
- Browser tests: Playwright (`e2e/`, `playwright.config.ts`), run with `npm run test:e2e`. It starts
  `next dev` on port 3100 (reuses a running one locally, never in CI) at the 1194×834 frame size; each test gets a fresh
  browser and a fresh throwaway student on local Supabase. First run: `npx playwright install chromium`, or set `PLAYWRIGHT_CHROMIUM_PATH` to
  an installed Chromium (cloud containers ship one at `/opt/pw-browsers/chromium-*/chrome-linux/chrome`).
- CI: `.github/workflows/ci.yml` runs typecheck, lint, unit tests and build, and in a second job
  starts the Supabase CLI stack on the runner and runs `test:db`, `check:isolation`,
  `check:evidence` and the Playwright suite against the fake Anthropic API (a guard step fails the
  job if a real model key is set; traces and the Supabase containers' logs uploaded on failure), on
  pushes to `main`, `backend-implementation` and `phase-*` and on pull requests.

## Design tokens (already in `src/app/globals.css`)

Colors: `prussian #151D3A`, `wisteria #839BEC` / `wisteria-deep #5B78D8`, `periwinkle #AFB5F2` /
`periwinkle-deep #8C93DE`, `alice #E1ECFA` / `alice-deep #B4C8E6`, `parchment #FCF7F4` /
`parchment-deep #E3D9D2`, `orca-shadow #D9D0CB`, `ink-deep #0A0F22`. Font: Gabarito (Google).
Deep shades are used ONLY for the bottom "lip" shadow and strokes.

Utilities: `lip-{1..10}` sets the offset shadow size, `lip-{alice|wisteria|periwinkle|ink|parchment}`
sets its color, `pressable` sinks the control into its lip on :active, `eyebrow` = tracked caps label.

Type scale from Figma: H1 40 bold, H2 28 semibold, Button 17 bold, Caption 14 regular; big headlines
34–68 bold; eyebrows 15 semibold tracked 1.5px.

## What exists (all 11 Figma screens are built)

This describes the code as it is.

- `src/lib/motion.ts` — every spring/variant/loop preset. All animation pulls from here.
- `src/lib/data.ts` — model + defaults + weight and date helpers. No seed courses, due items,
  calendar events, materials or streak (nothing built in or fabricated). `Topic`'s only status is its
  review status (`proposed | confirmed | archived`); progress is derived, never stored.
- `src/lib/mastery/` — pure domain modules (tested with `npm test`): `types.ts` (evidence events,
  objective info and state), `catalogue.ts` (objectives per topic, unsorted bucket),
  `objective-state.ts` (FSRS via `ts-fsrs` under Orca's mastery bar; the `applyAnswer` / `stateAt`
  fold; a check passed in a deep review stretches the next one 1.5×), `progress.ts` (topic progress, island level), `course-mastery.ts` (per-course roll-up),
  `priority.ts` (overdue, weight, gap, mix-up and open confusion, each with a reason sentence),
  `agenda.ts` (per course: ranked due list, quick- and deep-review cadence, poor-session review
  to-dos and next-day re-quizzes), `session.ts` (quick review, re-quiz and deep review assembled
  from the question stock within the time budget; deep review covers every objective once, by
  priority, before going deeper, and reports its coverage for the length picker), `todo.ts` (sidebar cards from the agenda),
  `streak.ts` (consecutive local days with an unaided graded answer). `catalogue.ts` follows `mergedInto` and leaves archived objectives out; `applyConfusion`
  resets an objective to learning. `attribution.ts` says which objective each event counts for
  now (shared by `course-mastery.ts` and the server's snapshots); `snapshots.ts` is the snapshot
  path (`recordEvent`, `readCourseState`) behind a `SnapshotStore` interface. `RULES_VERSION` and
  `dayKeyIn(timeZone)` live in `objective-state.ts`: bump the version whenever the fold's result
  could change, and record its hash and golden replay in `tests/mastery/snapshot.test.ts`.
- `src/lib/store.tsx` — `OrcaProvider`, `useOrca()`, `useCourse(slug)`, `useDayKey()`. Loads the
  signed-in student's data once (`my_data()`, one consistent read; `GET /api/state` for courses
  with stale snapshots) and saves every action optimistically, one save at a time in order: course
  structure through `save_structure` (only changed rows), evidence through `POST /api/evidence`,
  the rest by direct writes under RLS. A failed save is undone and shows "Couldn't save: …"
  (`SaveStatus`, `src/components/store/`); a failed load shows its own screen. Holds per-course
  `objectives` and `relations`, pipeline `runs`, `materials` (only read uploads; page text is
  never held, top-ups load it from `material_pages`), finished sessions (`results`), the `evidence` log (answers and confusion
  events) and the server's `snapshots`; `recordEvidence` and `recordReflection` are its only
  evidence writers. Runs are the server's: the store reads them, never writes them. Objective state comes from the snapshots; streak, agenda and the rest from
  the loaded events, with days in the profile's timezone. The bring-your-own model setting is kept
  in memory only. `orca:v3`–`orca:v8` and `orca:materialPages` keys are removed on load. Course structure changes in the browser only through `editStructure` (an op from
  `src/lib/course/ops.ts`; saves send only changed columns); jobs change it on the server, and
  `refresh()` reloads after one finishes; `afterSaves()` waits for the save queue. Derived reads:
  `useMasteryByCourse()`, `useAgenda()`, `useTodos()`, `useStreak()`.
- `src/lib/course/` — pure course-structure modules (tested with `npm test`): `ops.ts` (confirm,
  reject, restore, rename, merge and un-merge topics and objectives; settle uncertain duplicates),
  `match.ts` (name normalisation, exact name/alias matching that follows merges and reports
  rejected matches, shortlist for reconciliation), `weights.ts` (weights from upload signals,
  `WEIGHT_RULES`), `review.ts` (what still needs review), `study.ts` (where an objective is taught,
  as "file, slides 18–20").
- `src/app/providers.tsx` — store + `MotionConfig reducedMotion="user"`. `src/app/template.tsx` — page transitions.
- `src/hooks/useFitScale.ts` (854×834 canvas scaling), `src/hooks/useToday.ts` (hydration-safe date),
  `src/hooks/useNow.ts` (clock for derived state), `src/hooks/useTopUp.ts` (starts the top-up job
  after a session, `POST /api/top-up`), `src/hooks/useRun.ts` (follows a pipeline run: Realtime,
  a read on subscribe, a 5 s poll; reloads the store when it finishes).
- `src/components/icons.tsx`, `brand/` (OrcaLogo, Island with four mastery looks, Wave, Bubble).
- `src/components/ui/` — Button, Chip/ContextPill, RoundButton, ProgressBar, Card, Tag, Stat, Select,
  Toggle, Slider, AnswerOption, DueCard, PathNode (done / current / upcoming, no locks) (barrel in `ui/index.ts`).
- `src/components/layout/` — AppShell (main + 340px Sidebar with NavBar), BackButton, Screen.
- Feature components: `map/` (KnowledgeMap, LabelPill), `path/KnowledgePath`, `quiz/` (QuizRunner,
  shared by topic quizzes and sessions; TruthTable, QuizEnd, ShortAnswer, DeepReviewSetup: the
  "how long do you want to study?" picker with the coverage plan), `config/` (ConfigRow, ClassConfigModal), `calendar/MonthGrid`.
- Routes: `/`, `/home`, `/course/[slug]` (+ `/review`, `/objectives`, `/reflect`, `/study`),
  `/quiz/[slug]/[topic]`, `/session/[slug]?kind=quick|deep|requiz`, `/settings`, `/calendar`, `/add-material`, `/new-course`,
  `/api/materials`, `/api/materials/[id]/process`, `/api/top-up`, `/api/reflect`, `/api/evidence`,
  `/api/state` (these need Supabase and a signed-in student), `/api/grade`, `/api/llm/*`, `/sign-in`, `/sign-up`,
  `/forgot-password`, `/reset-password`, `/auth/callback`. Dynamic
  pages read `params`/`searchParams` with React `use()` and the generated `PageProps<...>` types
  (run `npx next typegen` before `tsc`).
- Bring-your-own-LLM (`src/lib/llm.ts`, `llm-server.ts`, `src/components/settings/YourAI.tsx`, now
  hidden from Settings; the pipeline ignores it, `/api/grade` still accepts it until Task 8): the student picks
  Anthropic / OpenAI / Gemini / OpenRouter / Ollama + a key; it lives in the store (browser only) and
  rides along with each request. Anthropic goes through `@anthropic-ai/sdk`; the rest use the
  OpenAI-compatible chat.completions shape; Ollama is called from the browser. Model routes fall
  back to the server `ANTHROPIC_API_KEY` (`claude-opus-5-5`); with neither, uploads are saved
  without generating anything and prose answers are self-marked. Whether to keep
  this is open (`docs/TO-DISCUSS.md`).
- Untrusted text (decision 13), `src/lib/untrusted/` (pure): `sanitize.ts` (NFKC with super- and
  subscripts spelled as `^{…}`/`_{…}`, invisible and control characters removed, tabs kept, runs
  collapsed), `encode.ts` (`untrustedBlock`, `UNTRUSTED_POLICY`: every prompt sends material, course
  items, questions under check and notes as labelled JSON data blocks), `screen.ts` (the pattern
  screen: OWASP phrasing with spacing, misspellings and swapped letters, role tags, Base64 and hex
  payloads decoded; never blocks; each hit is `strong` or `weak`, weak being phrasing honest course
  text also uses), `validate.ts` (generated text refused for a URL the material lacks, HTML, a
  markdown link or a strong screen hit), `hidden-text.ts`. The pipeline records what it found on the
  run (`security`, with what the validators refused), the review screen warns on strong hits, and a
  trigger writes `security_events` (with `severity`; refusals as `generated`); the reflect route
  logs its hits and the grader one event per flagged answer; three answers with a strong hit in a
  week turn a student's model grading off (the owner clears the events to turn it back on).
  Red-team fixtures: `tests/fixtures/injection/`.
- Cost guard (decision 10): `src/lib/limits.ts` (every limit), `src/lib/pricing.ts`,
  `src/lib/jobs/budget.ts` (the daily-budget decision and the student's day start), the jobs check
  the budget when they claim a run and go `waiting` with why; `resumeNext` (`src/lib/jobs/start.ts`)
  starts the student's next queued or resumable run when one finishes, when they start a job while
  nothing of theirs is running (so a run waiting for yesterday's limit, or orphaned by a crash,
  resumes in inline mode too) and hourly on Trigger.dev, failing dead runs first (judged from
  `started_at`, set when the job claims the run); rate limits through `hit_rate_limit`. The upload,
  reflect and top-up routes, and the grader, answer 429 with `retry-after` past a limit. A reply cut
  off mid-stream is still metered; a fallback model with no recorded price is recorded at the
  requested model's price and labelled.
- Uploads (Task 6): `src/lib/uploads.ts` hashes the file, `POST /api/materials` answers with a
  signed upload URL into `<owner>/<material>/<safe name>` (PDF only, 25 MB) or "the course already
  has this file" (SHA-256), the browser uploads to Storage, and `POST /api/materials/:id/process`
  (`src/lib/server/materials.ts`) reads it on the server (`src/lib/material/read-pdf.ts`: pdf.js
  in Node, at most 150 pages, text under 2 pt dropped and counted in `materials.hidden_text`,
  every page through `src/lib/untrusted/sanitize.ts`) into `material_pages`. Limits are in
  `src/lib/limits.ts`. Only `ready` materials load into the store.
- Jobs (Task 7a): the upload routes start `processMaterial` and answer with `generation` (started,
  running, queued, waiting, built, no model, no text); `POST /api/top-up` starts `topUp` after a finished session.
  `src/lib/jobs/jobs.ts` (pure, over a `JobStore`; `src/lib/server/job-store.ts` scopes every
  service-role query to the student), `src/lib/server/jobs/start.ts` (creates the queued run and
  dispatches: `ORCA_JOBS=inline` runs it after the response, `trigger` enqueues
  `src/trigger/jobs.ts`; `trigger.config.ts` needs `TRIGGER_PROJECT_REF`), `run.ts` (what a
  worker calls). Each job claims its run, writes `progress`, and saves the run (done) with what it
  built in one `save_structure`, or records why it failed. `src/lib/server/model.ts` is the step
  caller (Orca's `ANTHROPIC_API_KEY` only, streamed); `src/lib/server/figures.ts` renders figure
  slides on the server from the stored file only if its hash still matches.
- Upload pipeline (run by the jobs), `src/lib/pipeline/`: `runUpload` (`run.ts`) calls the steps through an injected caller:
  **extract** (structure and signals against the course's existing topics and objectives, with
  material-type rules), **reconcile** (only when something is close; same/new/uncertain),
  **generate** (questions per objective, topped up to 6), then **solve** (blind, compared in code
  for choice and exact answers), **ambiguity** and **agreement** checks; failures and duplicates are
  dropped with a reason in the run record. Prompts (`prompts.ts`) and zod schemas (`schemas.ts`)
  are used by the server step caller. `apply.ts` merges the plan; uploads land on
  `/course/[slug]/review?run=`, which follows the job. `writeQuestions` (generate + checks) is shared with `topup.ts`, which
  writes more questions after a session for objectives under 3 unseen, from only the stored
  pages of the material each objective is anchored to (plus one either side). `npm run score:extraction` scores extraction on the ALD decks against
  `docs/OBJECTIVES-ALD.md` (needs `ANTHROPIC_API_KEY`; `--dry` checks the decks without a model).
- ALD reference material (not shipped in the app): `docs/samples/ald/L01–L04` (real ALD lecture
  decks; syllabus in L01) to upload, and draft objectives in `docs/OBJECTIVES-ALD.md`. The 69
  questions Sophia authored from them were removed from the app; they're in git history
  (`src/lib/content/ald.ts` at 89e042b) for evaluating extraction.
- `e2e/` — browser tests: `mastery-core.spec.ts` (fresh browser, empty states, the trail, quiz
  answers writing evidence), `upload.spec.ts` (a real ALD deck through pdf.js and the server job
  against the fake API; re-uploading adds nothing; a failed job says why and a re-upload retries), `review.spec.ts` (review screen and
  objective list actions, Unreviewed tag), `reflect.spec.ts` (a reflection resetting an objective),
  `scheduling.spec.ts` (quick review, poor-quiz to-dos and re-quiz, deep review cadence, top-up),
  `store.spec.ts` (a second browser sees the same data; a failed save is undone and not counted and
  the quiz's score isn't saved; an action during the reload is refused with a message; a mid-session
  reload counts nothing twice; old local state cleared), `auth.spec.ts` (sign-up, confirm, reset,
  `SITE_URL` links, token-hash links), `grade.spec.ts` (grading behind sign-in, screening, the
  repeat-offender switch, the rate limit, metering), `cost-guard.spec.ts` (a waiting run, a queued
  second upload, a spend-limit answer, the upload rate limit), `injection.spec.ts` (an injected
  deck: refused rows, the warning, `security_events`; a flagged reflection note), `settings.spec.ts`
  (sliders save on release). `e2e/fixture.ts` signs in a throwaway student and seeds through the
  secret key. The fake Anthropic API reads its inputs from the prompts' data blocks and can answer
  with a spend-limit error or a given grade.
  Tests find things by `data-level`, `data-visual` and `data-part`; keep those attributes stable.
- Deploy: Vercel project `orca` (https://orca-lake-omega.vercel.app; last deployed before Phase 1). Deploy with
  `npx vercel deploy --prod --yes` from a session that has the Vercel credential; GitHub auto-deploy
  is not linked yet. `.vercelignore` keeps docs/ out of uploads.

## What to build next

`docs/BACKEND-ROADMAP.md` is the plan. Phases 1 (mastery core), 2 (uploads create the course
structure) and 3 (scheduling and sessions) are done on-device; Phase 4
(Supabase) is next. Before tuning anything in
Phase 2, run `npm run score:extraction` with a key and record a baseline. Phases: (1) mastery core on-device, (2) uploads create
topics, objectives, weights and relations (on-device), (3) scheduling and sessions, (4) Supabase
(auth, tables, Storage, snapshots, server-side pipeline), (5) relation mastery, exams and calendar,
(6) ALD drills, (7) MCP connector. Build each phase with
`superpowers:writing-plans` → `superpowers:subagent-driven-development`; plans go in
`docs/superpowers/plans/`. Animation next steps are in `docs/ANIMATION.md`.

## Invariants (ported from ai-native-learning-platform)

- Learner state is derived. Every answer appends an `EvidenceEvent`; objective state, topic progress
  and island level are computed from events and the clock. Never store or write mastery directly.
- Exposure is not mastery. Uploads, reading and connector signals may raise priority; only scored
  answers count toward mastery, and self-marked answers count half. A grading failure records nothing.
- Check exactly when the domain allows (bit strings, numbers, Boolean expressions by truth table).
  Use a model grader only with a structured rubric.
- Course-specific questions carry a source anchor into the course material. Questions for inferred
  objectives have no anchor and must not present themselves as course-specific.
- No silent placeholders: a fallback or unknown value must never look like a computed one. Throw, or
  show an explicit empty or unknown state. This applies to existing code you touch.
- When live credentials exist (Supabase, Anthropic), run the live check. A typecheck around a live
  dependency is not the same claim.
- Don't add a dependency when an existing one solves the problem. Don't add a persistence layer
  without recording why in `docs/BACKEND-ROADMAP.md`.
- Pure domain modules (`src/lib/mastery/`, content catalogues) use relative imports ending in `.ts`
  and `import type`, so `npm test` runs them with Node's type stripping.

## Animation architecture (the "clear path forward")

- Everything visual that will move is already an SVG `motion.path`/`motion.div`: islands, orca, waves,
  trail, nodes. Target parts via `data-part` attributes.
- Presets in `src/lib/motion.ts`: `spring`, `fadeUp`, `popIn`, `stagger`, `page`, `floatIsland(seed)`,
  `driftWave(seed)`, `swimOrca`, `pulseHalo`, `drawTrail`. Add new ones there, never inline.
- Buttons/chips/cards press via CSS (`pressable`), not JS, so they stay cheap.
- Lists use `stagger()` parents with `fadeUp` children; modals/result cards use `popIn` + `AnimatePresence`.
- Next steps when ready: orca follows a path on the map (`offsetPath`), islands animate between their
  four mastery looks (trees sprout from `r` 0 when a level is reached), trail segments fill as topics
  complete, confetti on quiz end.

## Conventions

- Keep screens thin: data from `useOrca()`, visuals from components, timing from `motion.ts`.
- Pixel values from Figma are fine inline (`text-[22px]`, `rounded-[20px]`); colors must be tokens.
- Testing is lean while the project is early: write tests for the happy path and the edge cases
  that matter (security, data loss, mastery rules), not exhaustive matrices. Per commit: `npx tsc
  --noEmit`, `npm run lint`, and only the tests covering what changed (one unit file, one pgTAP
  file, one e2e spec). Run the whole suite (`npm test`, `npm run test:db`, `npm run test:e2e`,
  the check scripts) once at the end of a task that changed the store, a migration or shared
  code, and always before merging a branch.
  `npm run dev` for the preview.
