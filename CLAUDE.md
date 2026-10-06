# Orca — study app (v1 web prototype)

Orca turns every college class into an "island" on a knowledge map. Inside an island is a
Duolingo-style trail of topics; topics run quizzes; the orca mascot nudges reviews on a cadence the
student configures per class. Tagline: "Mastery Made Easy."

Design source of truth: Figma file `Xt9CiD6SpdN0BPma1q2pzZ` ("Orca – Study App Mockups"), read
through the Figma MCP (pages: Style Guide, Header & Nav Assets, Screens, Concept Atlas).
Reference renders live in `docs/figma/` (`screens.png` = the 11 screens before the 2026-10-06
redesign, `styleguide.png`, and the traced SVG assets in `docs/figma/assets/`; `docs/figma/README.md`
lists what still needs exporting). Frames are 1194×834 below an 88 px top bar; v1 ships as a laptop
website.

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
- **Phase 4 is merged into `backend-implementation`** (2026-10-06, with the owner's OK; `phase-4`
  points at the same commit). `backend-implementation` holds Phases 1–4; `main` is far behind (the
  pre-Phase-1 prototype), and nothing has been merged into it or opened as a PR.
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
  whole-branch review's fixes (Wave 3), then the Figma sync (the top bar, avatars, the new
  account screens, the quiz feedback state and the Concept Atlas). Checks last run green
  (2026-10-06, after the Figma sync): `npx tsc --noEmit`, `npm run lint`, `npm test` (267),
  `npm run test:db` (177), `npm run check:isolation` (43), `npm run check:evidence` (44),
  `npm run test:e2e` (57), `npm run build`. CI now runs on `phase-*` too, but GitHub
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
- The Vercel deploy (https://orca-ocean.vercel.app) is from before Phase 1; it doesn't show
  any of this.

**Next, in order.**
1. **Task 10, with the owner's credentials in the cloud environment** (`docs/SETUP-HOSTED.md`): link
   the hosted Supabase project and push the migrations, run `npm run check:isolation` against it,
   set `SITE_URL`, `ORCA_JOBS`, `ORCA_DAILY_BUDGET_USD` and `ANTHROPIC_API_KEY` on Vercel, switch the
   hosted email templates to token-hash links, deploy, and do one real ALD upload end to end. Then
   `ANTHROPIC_API_KEY=… npm run score:extraction -- --update-baseline` (it includes an injected deck
   now) and look at the review screen; fix prompts where extraction or question checks go wrong.
2. The Phase 3 numbers and the assumptions listed in `docs/TO-DISCUSS.md` ("Assumed while
   finishing Phase 4") want a decision or real use.
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
- The server's provider and model come from `src/lib/model-config.ts`: `ORCA_MODEL_PROVIDER`
  (`openai` | `anthropic`; set, its key must be set), else `OPENAI_API_KEY` before
  `ANTHROPIC_API_KEY`; `ORCA_MODEL` overrides the default (`gpt-6.1-sol` / `claude-opus-5-5`) and
  must be priced. OpenAI goes through its Responses API in the same `completeJson` (strict schema
  from `src/lib/openai-schema.ts`, explicit caching of the material, same bounds and metering).
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

## What exists (a map; read the code for detail)

All 11 Figma screens are built. Where things live:

- `src/lib/mastery/` — pure learner model (FSRS fold `applyAnswer`/`stateAt`, progress, agenda,
  sessions, streak, snapshots). Bump `RULES_VERSION` in `objective-state.ts` whenever the fold's
  result could change, and record its hash in `tests/mastery/snapshot.test.ts`.
- `src/lib/course/` — pure course-structure ops (confirm, merge, rename…), matching, weights, atlas layout.
- `src/lib/store.tsx` — `useOrca()`: loads the student's data once, saves optimistically in order
  (structure via `save_structure`, evidence only via `POST /api/evidence`, the rest under RLS).
  Structure changes in the browser only through `editStructure`; jobs change it on the server.
- `src/lib/pipeline/` — upload pipeline (extract, reconcile, generate; no model check of the
  questions since 2026-10-06), prompts and zod schemas; `topup.ts` writes more questions after a
  session and a deep review's harder ones (`runDeepReview`, the "deep" step, called by
  `POST /api/deep-review` when a deep review starts; questions marked `deep`, asked only there);
  `link.ts` is the link step (topic links from names and summaries, after each upload and from
  "Find connections" on the Atlas, `POST /api/relink`).
- `src/lib/jobs/` + `src/lib/server/jobs/` + `src/trigger/` — upload and top-up jobs (`ORCA_JOBS=inline|trigger`).
- `src/lib/server/` — route helpers, model step caller (`model.ts`), grading, usage metering, rate limits.
- `src/lib/model-config.ts`, `llm-server.ts`, `pricing.ts`, `limits.ts` — provider choice, model calls, prices, every limit.
- `src/lib/untrusted/` — sanitising, prompt data blocks, injection screen, output validation.
- `src/lib/material/read-pdf.ts`, `src/lib/uploads.ts` — PDFs to Storage, read on the server into `material_pages`.
- `src/components/` — `ui/` primitives, `layout/` (TopBar, AppShell), `quiz/`, `map/`, `path/`,
  `atlas/`, `auth/`, `brand/`; `src/lib/motion.ts` holds every animation preset.
- `src/app/` — routes (`/home`, `/course/[slug]/…`, `/quiz/…`, `/session/…`, `/add-material`,
  `/settings`, auth screens, `/api/*`). Run `npx next typegen` before `tsc` after adding a route.
- `e2e/` — Playwright specs, one per area; `fixture.ts` signs in a throwaway student. Tests find
  things by `data-level`, `data-visual` and `data-part`; keep those attributes stable.
- `docs/samples/ald/` — real ALD decks for trying uploads; `docs/OBJECTIVES-ALD.md` the benchmark.
- Deploy: Vercel (https://orca-ocean.vercel.app) builds from `phase-4`.

## What to build next

`docs/BACKEND-ROADMAP.md` is the plan. Phases 1 (mastery core), 2 (uploads create the course
structure) and 3 (scheduling and sessions) are done on-device; Phase 4
(Supabase) is next. Before tuning anything in
Phase 2, run `npm run score:extraction` with a key and record a baseline. Phases: (1) mastery core on-device, (2) uploads create
topics, objectives, weights and relations (on-device), (3) scheduling and sessions, (4) Supabase
(auth, tables, Storage, snapshots, server-side pipeline), (5) relation mastery, exams and calendar,
(6) ALD drills, (7) MCP connector. Build each phase with
`superpowers:writing-plans` → `superpowers:subagent-driven-development`; plans go in
`docs/superpowers/plans/` (phases only; bug fixes use Fix mode, see Conventions). Animation next steps are in `docs/ANIMATION.md`.

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
- **Fix mode (the default for bug fixes and small changes).** Make the narrowest fix, then run
  only `npx tsc --noEmit`, `npx eslint` on the changed files, and the one unit test file covering
  the change (add a test only for mastery rules, security or data loss). Check UI changes by hand
  in `npm run dev` or with one e2e spec, not the whole suite. Run `npm run test:db` only when a
  migration changed. No plan doc, no subagents or reviews, no worktrees. Update docs only when
  setup or a decision changed. Commit messages are one or two lines.
- **Merge or deploy gate (once, not per change).** Before merging a branch or deploying: `npm test`,
  `npm run test:db`, `npm run test:e2e`, `npm run check:isolation`, `npm run check:evidence`.
- **Phase work** (a new roadmap phase or a large feature) still uses the plan doc and task-by-task
  flow described above, with Fix mode's checks per commit.
- `npm run dev` for the preview.

<!-- TRIGGER.DEV SKILLS START -->
## Trigger.dev agent skills

This project has Trigger.dev agent skills installed in `.claude/skills/`. Before writing or changing Trigger.dev code (background tasks, scheduled tasks, realtime, or chat.agent AI agents), load the most relevant skill: `trigger-authoring-chat-agent`.
<!-- TRIGGER.DEV SKILLS END -->
