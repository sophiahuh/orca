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

## Start here (handoff, updated 2026-11-04)

**Who it's for.** A college student who wants to actually master their classes, not cram. They
create a course, upload its material (lecture decks, syllabus, homework, past exams), and Orca
turns it into topics and objectives ("can do X") with quiz questions, then tracks mastery per
objective from their answers and spaces reviews (FSRS) until each one sticks. The first test course
was Advanced Logic Design (ALD, Columbia ELEN; its decks are local-only, `docs/samples/README.md`); the owner now tests with their
own courses (Data Structures, Fundamentals of Computer Systems) on the hosted project.

**Where things stand.**
- **Branches (keep this straight).** Since 2026-11-08 each change gets its own branch off `main`,
  named for the change (e.g. `latex-support`), and reaches `main` by pull request after the merge
  gate below; merging into `main` is the deploy (Deploy, below). Never commit straight to `main`.
  `phase-4` was the shared working branch until then (PRs #1–#7 came from it); others may still push
  there, so never force-move it, and don't base new work on it (it carries unrelated commits).
  `backend-implementation` is the **production branch** Vercel (project `orca`,
  https://orca-lake-omega.vercel.app) builds; only the Deploy workflow pushes it. **Commit as whoever is running you**
  (the machine's git config; never pass `-c user.name/user.email`). Vercel refuses to build a
  commit whose author email isn't on the owner's GitHub account, but it only checks the commit at
  the top of `backend-implementation`, and the Deploy workflow authors that merge commit as the
  owner itself (`.github/workflows/deploy.yml`), so teammates' commits below it never block a
  deploy.
- Phases 1–4 are built (mastery core, uploads build the course, scheduling and sessions, Supabase
  with auth, RLS, Storage, server jobs, cost guard, injection defences, CI). See
  `docs/BACKEND-ROADMAP.md` and the Phase 4 plan's status notes for what each contains.
- **Built on top of Phase 4 since (2026-10-06; product decisions by the owner, recorded in
  `docs/BACKEND-ROADMAP.md` and `docs/TO-DISCUSS.md`):**
  - Generated questions are **no longer checked by a second model** (no solve/ambiguity/agreement
    steps); only the code validators refuse bad output.
  - **Dive in** (deep review): its harder questions are **written when it starts**
    (`POST /api/deep-review`, the `deep` pipeline step), course-wide or for **one topic** (a
    topic's play button on the path, or its Atlas node, opens "Dive into [topic]" to pick a length).
    Deep questions are marked `deep` and only dives ask them.
  - **Topic links**: relations connect topics (used-in, has-a-kind, alternative-to, related). The
    map calls propose some, and the **link step** (`src/lib/pipeline/link.ts`) runs after each
    upload and from "Find connections" on the Atlas (`POST /api/relink`).
  - **Concept Atlas** is a topic graph (`src/lib/course/topic-graph.ts`, `src/components/atlas/`):
    foundations on top, nodes sized by how many topics they're used in, strength glyphs.
  - **Course settings are overrides**: a course's `review_config` is null to inherit the account
    default on the profile (Settings page), set to override (the course's settings page, the gear on
    its page).
  - **Notes for Orca** (2026-10-25, replacing the material-type weight sliders): free text, one for
    all classes (`profiles.orca_notes`, Settings) and one per class (`courses.orca_notes`, the
    course's settings), at most 1,000 characters. The writing steps (map, objectives, generate,
    deep) get both as a `student_notes` data block with rules scoped to the step
    (`src/lib/pipeline/prompts.ts` `notesRules`); the grader, link, reconcile, reflect, transcribe
    and describe steps never see them. Saved only through `PUT /api/account-notes` and
    `PUT /api/course-settings`, which refuse a strong injection hit (`src/lib/pipeline/notes.ts`,
    `src/lib/server/notes.ts`); jobs screen them again when they load them.
  - **Exams** have their own table (each course's exams, dates, optional topics), edited with
    "Edit Exams" on the course page; they show on the calendar and drive the exam cadences.
  - Homework reflection is a text box on the upload page; the calendar shows scheduled reviews,
    has a course filter and expanding weeks.
- **Since 2026-10-18** (details in `docs/BACKEND-ROADMAP.md` §2 and the plan docs): handwritten
  and scanned PDF pages read from their images, figures on typed slides described; thumbs up/down
  on questions (a thumbs down skips and replaces it, its note feeds question writing); unfinished
  sessions resume (`session_progress`); "Don't know" beside Check (a self-graded wrong answer, then
  the solution); multiple-choice options are shuffled per showing; the prose grader judges
  understanding against rubrics built only from what the material teaches. The sidebar's
  quick-review card reads "Covers N objectives": N is planned exactly as the session plans it
  (`src/lib/askable.ts` + `assembleQuickReview`), not the full due count.
- **Since 2026-10-26** (details under "What exists"): every question has an objective (the
  unsorted bucket is gone); several files or a folder per upload (every file counts as covered
  since 2026-11-08: the "how far has the class got?" question is gone); typed notes; class times and review days
  ("Twice a week"); Dive In runs beside an upload; queued uploads pause and resume, a running one
  stops, material can be removed, a failed upload has Try again; the Claude connector (MCP) and
  Canvas import (2026-11-04). **Planned, not built:** activity logs with soft delete
  (`docs/superpowers/plans/2026-10-27-activity-logs-soft-delete.md`).
- **Since 2026-11-05: weak points first, Plan A** (spec
  `docs/superpowers/specs/2026-11-04-weak-points-first-design.md`, plan
  `docs/superpowers/plans/2026-11-04-weak-points-plan-a.md`; on `main` since 2026-11-05). Only
  objectives in rotation come due (see "Product model"); flags are `confusion` evidence with
  `flag_source` and `page` (migration `20261105090000`); `RULES_VERSION` 2 (3 since
  2026-11-08), with `MASTERY_RULES.rotationSince` = 2026-11-05 (set by the owner).
- **Since 2026-11-06: weak points first, Plans B and C** (plan
  `docs/superpowers/plans/2026-11-05-weak-points-plans-b-c.md`; on `main` since 2026-11-07). Every live objective holds state with or without questions (attribution; migration
  `20261106090000` left placeholders for older evidence). Uploads write questions only for objectives
  marked in them; any other flagged objective gets its questions from a flag top-up
  (`POST /api/top-up` without a session, one per batch of flags; `FlagTopUpWatcher` follows it), and
  every top-up catches up flagged objectives still without questions and queues one more (`followUp`)
  for flags that arrived while it ran. Passive flags: handwritten markers (Settings → "How do you mark
  confusion in your notes?", `profiles.marker_notes`, migration `20261106090200`; the page reader tags
  `[marked: …] … [/marked]`, the objectives step returns `struggled`, `src/lib/pipeline/marked.ts`
  checks them, the upload records `handwritten-marker` flags), the connector's `flag_check` (*check
  me*), and "Which slides were hard?" on an upload card (`src/components/review/HardSlides.tsx`,
  `objectivesOnPage` in `src/lib/course/slides.ts`; `slide` flags). The decisions this made are listed
  in the plan and in `docs/TO-DISCUSS.md`.
- **Since 2026-11-08:** Phases 0–2 of `docs/superpowers/plans/2026-11-08-logic-review-and-plan.md`
  (PR #6: connector v0.3 with `check_answer`, mastery rules v3, the warm-up, `ORCA_READ_MODEL`,
  pasted text, Canvas and queue fixes; details under "What exists"). Math in questions is LaTeX
  between `\( \)` / `\[ \]`, drawn by KaTeX (PR #8: `src/lib/math-text.ts`,
  `src/components/ui/MathText.tsx`); question validation refuses math that doesn't render, and exact
  answers stay plain text.
- **Two hosted Supabase projects.** Production is `fbbimuspcsytjhbqlzzc` (the live site's; its
  keys are Vercel's Production env vars). `mtztzsxgcopohlokragm` is a second hosted project Amanda
  uses for development. `.env` may point at either (it has pointed at each at different times):
  check `NEXT_PUBLIC_SUPABASE_URL` before anything that reads or writes hosted data. The Supabase
  CLI doesn't read `.env`: `db push` and `--linked` commands go to the project in
  `supabase/.temp/project-ref` (`npx supabase link --project-ref <ref>` changes it).
- **The owner runs `npm run dev` on port 3000 against a hosted project and a real OpenAI key**
  (`.env`, default model `gpt-6.1-sol`): uploads there spend money and write real data. Don't seed
  test users or test data there. Browser tests and screenshots use the local stack.
- **Hosted migrations:** production has every migration through `20261107130000_ai_chat_type`
  (the Deploy run of 2026-11-08). The Deploy workflow pushes
  pending migrations to production on every merge to `main` (its two secrets are set), so nobody
  pushes by hand; a new migration must be numbered after the newest one applied, or `db push`
  refuses it. The development project `mtztzsxgcopohlokragm` was last checked on 2026-10-25
  (everything through `20261019090000`); later ones go there only by hand. A migration the code
  needs but the database lacks shows as "Could not find the table … in the schema cache". Check
  with `npx supabase migration list --linked` (read-only; from an IPv4-only network the CLI says
  "IPv6 is not supported" until `supabase link` is rerun). A migration that drops a column the
  running code still uses must land with that code, as the Deploy workflow does.
- **Tests never call a real model.** Unit tests inject fake step callers; the browser tests run
  against `e2e/fake-anthropic.ts` (a fake Messages API on port 3101; the test server gets
  `ANTHROPIC_BASE_URL` pointing there and a fake key). `npm run score:extraction` has no baseline yet
  and the weight constants are untuned.
- **CI** (`.github/workflows/ci.yml`) runs the whole merge gate on every pull request and every
  push to `main` and `phase-*`; green on `main` as of PR #6 (2026-11-08).
  Occasional failures come from the environment, not the product: `next dev` compiling a
  route mid-test (a save waits 5 s+ and an `expect.poll` gives up; the one CI retry usually
  passes) and the dev server taking over 120 s to start. (`next build` used to fail when the
  runner couldn't fetch Gabarito from Google Fonts; since 2026-11-04 the font is served from the
  repo, `@fontsource-variable/gabarito` through `next/font/local` in `src/app/layout.tsx`.) Read a
  failing run's trace (`gh run download <id> -n playwright-traces`) before changing a test.

**Next, in order.**
1. The 2026-11-08 plan (`docs/superpowers/plans/2026-11-08-logic-review-and-plan.md`): Phases
   0–2 are on `main`; Phase 3 (cost: measure, then switch models per step) is next. PR #7
   (`phase-4` → `main`, the Canvas import's file picker) is open.
2. Activity logs, edit history and soft delete: planned
   (`docs/superpowers/plans/2026-10-27-activity-logs-soft-delete.md`), not started; read its status
   block first (migration numbers and newer hard deletes changed since it was written).
3. Optional CI hardening offered to the owner, not decided: run the browser tests against
   `next build` + `next start` instead of `next dev`.
4. The open items in `docs/TO-DISCUSS.md` (the assumptions listed there want the owner's decision),
   exam review proper (the "Exam review" setting is stored but no session uses it yet; Phase 5),
   and the rest of Phase 5 per `docs/BACKEND-ROADMAP.md`.
Open product questions the student/owner must decide are in `docs/TO-DISCUSS.md`. Don't decide
them silently; list what you assumed.

**Environment gotchas.**
- The machine's default `node` may be 16; Next needs ≥ 20.9 and the tests ≥ 22.6. Use
  `export PATH=$HOME/.nvm/versions/node/v24.20.0/bin:$PATH` (or `nvm use`).
- `.env` holds a hosted project's keys (which one: see "Two hosted Supabase projects") and the OpenAI key; `.env.local` may not exist. The e2e
  config takes the local stack's keys from `supabase status` and overrides the model settings, so
  tests stay local either way.
- Next refuses a second `next dev` in the same directory. If the owner's dev server is running,
  the e2e web server can't start: either ask them to stop it, or temporarily add
  `distDir: process.env.SCRATCH_DIST ?? ".next"` to `next.config.ts` and run with
  `SCRATCH_DIST=.next-e2e` (Next also edits `tsconfig.json` then); revert both before committing.
  **Changing `next.config.ts` restarts the owner's running dev server, which kills any inline job
  (upload, dive) it's running** (2026-10-17: a real upload died this way). Before that trick, check
  the hosted project has no queued or running `pipeline_runs`, or ask the owner.
- Cloud containers: Playwright's Chromium build doesn't match; run e2e with
  `PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e` (that symlink points at
  whichever build the container ships; the versioned folder's name and layout change).
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
  ids must be UUIDs (`ids(...)` makes fresh ones per spec). An objective is due, mastered or fading only once
  it's in rotation: seed `struggled(...)` / `fixtureFlags()` (e2e/fixture.ts) before answers, since
  seeded right answers stop counting as mastery once their dates pass `rotationSince`. `page.goto` waits for the app's saves
  (`<html data-saving>`) first, since navigating away would cancel one.
- Pure modules (`src/lib/mastery`, `src/lib/course`, `src/lib/pipeline`, `src/lib/jobs`) must
  load under plain Node: relative imports with `.ts`, `import type`, no TS parameter properties.
- The superpowers skills named below may not be installed in every session; if they aren't,
  follow the same flow by hand (plan doc first, then task-by-task commits with tests).

**Map of the docs.** `docs/BACKEND-ROADMAP.md` (decisions + phases, what's done), `docs/MASTERY-PLAN.md`
(learner model), `docs/TO-DISCUSS.md` (open questions), `docs/superpowers/plans/` (per-phase and
per-feature plans with status notes), `docs/superpowers/specs/` (designs agreed in brainstorming),
`docs/QUIZ-RUBRIC.md` (what makes a good question), `docs/OBJECTIVES-ALD.md`
(reference objectives / evaluation benchmark), `docs/BACKEND-NOTES.md` (what to port from the
earlier `ai-native-learning-platform` repo), `docs/ANIMATION.md`, `docs/COURSEWORKS-SYNC.md` (the
Canvas OAuth design; the token-based import built 2026-11-04 is the first step), `docs/samples/README.md`
(the local-only ALD decks), `docs/SETUP-HOSTED.md` (what the owner sets up in Supabase,
Trigger.dev, the model provider, Vercel and the cloud environment, the connector and Canvas steps,
and the SQL for watching costs and security events). Repo-local skills:
`.claude/skills/learner-evidence` and `.claude/skills/assessment` (load before touching mastery
or question code).

## Product model (the vision the backend is built toward)

Full detail: `docs/BACKEND-ROADMAP.md` (decisions and phases), `docs/MASTERY-PLAN.md` (learner
model), `docs/TO-DISCUSS.md` (open questions). In short:

- **Course → topic → objective → questions.** An objective is a "can do X" statement and the unit
  of mastery. Every question belongs to one objective, and its topic is that objective's current
  topic (followed through merges when the course loads; a question's stored `topic_id` can be stale).
- **Objectives are created once per course**, when material is uploaded. The file is read part by
  part (about 60,000 characters each): a `map` call sees the part and the course's table of contents
  (every topic, its summary and where it's taught), then an `objectives` call per topic touched sees
  only that topic's objectives and pages; reconciliation matches duplicates (topics against the
  table of contents, objectives within their topic), and the student reviews topics. Each topic's
  `source` lists every file and page range it's taught on, and questions are written from each
  objective's own pages (spec: `docs/superpowers/specs/2026-10-25-course-index-design.md`). Inferred objectives (from general knowledge, not the material)
  are allowed and labelled. Unreviewed objectives are quizzable, with an "unreviewed" tag.
- **Learner state is derived, never stored.** Every graded answer appends an evidence event;
  objective status (unseen / verified / check-due out of rotation; learning → mastered → fading →
  retired, plus mixed-up, in rotation; table in
  `docs/MASTERY-PLAN.md` §2.3), topic
  progress, the island's mastery level, the due list and the streak are computed from the events
  and the clock. Spacing uses FSRS (`ts-fsrs`, Anki's scheduler) under Orca's own mastery bar.
  The mastery rule is a fold (`applyAnswer`), so the server can keep snapshots instead of
  replaying the log.
- **Weights.** Every topic and objective has a weight (neutral 1.0). The model records signals from
  the material (coverage, material type, explicit emphasis); code computes the weight, and an
  objective gains weight for each topic its topic is used in. Every covering place counts the same;
  Notes for Orca can set an objective's emphasis (tested or skipped).
- **Topic links.** Relations connect topics: used-in (a prerequisite), has-a-kind, alternative-to,
  related (one works around the other's limitation, or a deliberate contrast). Each carries a one-
  sentence reason shown on hover in the Atlas; used-in/has-a-kind never form a loop. They are the
  Concept Atlas's edges and feed the weights.
- **Weak points first (2026-11-05).** Only objectives *in rotation* come due: a struggled flag (a
  homework reflection, "This is hard" on an objective or a topic, a passage marked in handwritten
  notes, a tapped slide), an answer short of fully right
  anywhere, or mastery reached before `MASTERY_RULES.rotationSince`. Unflagged objectives are
  `unseen` ("Not flagged") or `verified` (answered right) and are never due; a *check me* flag
  (`check-due`, from the Claude connector's `flag_check`) asks one question. Flag strength follows
  the source (`src/lib/mastery/flags.ts`). Every live objective holds state, with or without questions.
- **Practice.** Missed questions have no review of their own: the objective joins the course's
  quick-review queue and isn't due again the same day. Quick reviews draw from questions written
  ahead: 2 per objective when it's flagged (marked in an upload, or a flag top-up), then 2 more after
  a session for a weak point still being learned once it's under 2 unseen; unflagged objectives get
  questions only from dives; assembled instantly and sized to the course's time budget. With nothing
  due, "You're caught up" offers Practice other topics (and Practice exam topics in an exam's week):
  dives over unflagged objectives (`src/lib/mastery/practice.ts`).
  **Dive in** (deep review) writes harder questions when it starts, for the whole course or one
  topic, at the length the student picks; its cadence is the course's setting.
- **Exams.** Each course's exams (date, optional topics) are their own table; they show on the
  calendar and set the "1 wk before exam" cadences. A dedicated exam review is Phase 5.
- **Settings.** The account holds default review settings; a course inherits them until its own
  settings page overrides them. Notes for Orca are sent from both: the account's for every class and
  the course's (which wins on a conflict).
- **Self-reported confusion** in a homework reflection is a struggled flag: the matching objectives
  go into rotation, back to learning.
- **Topics are not gates.** Every topic is playable; the trail shows progress, not locks.
- **Islands show mastery.** Each island has one of four fixed looks (uncharted, sprouting,
  growing, thriving) from the share of its weak points (objectives in rotation) that are mastered;
  nothing in rotation is uncharted, "No weak spots flagged yet". Topic rows and the course header
  count the same.
- **Nothing hardcoded or faked.** The app ships no courses; every course starts empty and its
  content comes from uploads. Missing data shows as an explicit empty or error state.
- **No in-app AI chat.** The server's model (OpenAI by default, or Claude) extracts material,
  writes questions and grades short answers. Students' own Claude connects through the MCP connector (built 2026-11-04, see
  "What exists"): Claude asks Orca's questions and Orca grades them (`check_answer`); only when Orca's grader can't run
  does Claude grade, and those answers count as self-marked.

## Stack

- Next.js 16 (App Router, `src/` dir, TypeScript), Tailwind v4, `motion` (Framer Motion) for animation.
- The app's data is in Supabase (Phase 4), behind a React context
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
  pure), actions in `src/app/auth/actions.ts` (sign-up and an unconfirmed log-in offer to resend
  the confirmation email: `resendConfirmation`, 10 s between sends; production Supabase's per-user email interval must be no longer), screens `/sign-in`, `/sign-up`, `/forgot-password`,
  `/reset-password`, callback `/auth/callback`, Account card in Settings, and the root layout shows
  "isn't connected" without the env vars. `react/no-danger` is an error (one reviewed exception: KaTeX's output in `MathText`). e2e specs import `test`
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
  (7b), all service-role only; `pipeline_runs` gained `objective_ids` and `security`. Since:
  `profiles.default_review_config` (account default), `courses.review_config` nullable (null
  inherits), `profiles.orca_notes` / `courses.orca_notes` (Notes for Orca; the slider columns
  `default_weights` / `weights` were dropped 2026-10-25), `security_events.kind` `orca_notes`, `questions.deep`, `relations` rebuilt between topics
  (`from_topic`, `to_topic`, four types, `material_id` nullable), `exams` (owner-only, in
  `my_data`), `question_feedback`, `session_progress`, `courses.schedule` (class times and review
  days), run status `paused`, material status `removed` with
  `archived_with_material` on topics and objectives, `connector_tokens`, and `canvas_connections` /
  `canvas_links` (service-role only).
  Env vars (`.env.example`): the Supabase three, `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` (with
  `ORCA_MODEL_PROVIDER`, `ORCA_MODEL`, `ORCA_GRADE_MODEL`, and `OPENAI_BASE_URL` /
  `ANTHROPIC_BASE_URL` for a proxy or the tests' fake API), `ORCA_JOBS`, `SITE_URL`
  (where emailed links come back; required in production), `ORCA_DAILY_BUDGET_USD` (the
  service-wide daily ceiling; unset = none), `TRIGGER_*`, `CRON_SECRET` (the dead-run sweep,
  `GET /api/cron/runs`, registered daily at 05:10 UTC in `vercel.json` since 2026-11-07: it also
  resumes uploads held by the daily limit; pages following a run also ask `POST /api/runs/check`
  once it's past its 40-minute limit). Per-student daily caps are in `src/lib/limits.ts`
  (1,000 pages and 2M tokens a day since 2026-11-07; a Canvas import of a whole course is one day).
- The server's provider and model come from `src/lib/model-config.ts`: `ORCA_MODEL_PROVIDER`
  (`openai` | `anthropic`; set, its key must be set), else `OPENAI_API_KEY` before
  `ANTHROPIC_API_KEY`; `ORCA_MODEL` overrides the default (`gpt-6.1-sol` / `claude-opus-5-5`) and
  must be priced. `ORCA_READ_MODEL` (2026-11-08, owner: the small model reads, the strong one
  writes) runs the reading steps (`READ_STEPS`: map, objectives, reconcile, link, transcribe,
  describe, reflect) on a cheaper model of the same provider; generate and deep stay on
  `ORCA_MODEL`, grading on `ORCA_GRADE_MODEL`. Jobs run on Trigger.dev, so the variable goes there too. OpenAI goes through its Responses API in the same `completeJson` (strict schema
  from `src/lib/openai-schema.ts`, explicit caching of the material, same bounds and metering).
- Model calls, on either provider, go through `completeJson` (`src/lib/llm-server.ts`:
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
`parchment-deep #E3D9D2`, `orca-shadow #D9D0CB`, `ink-deep #0A0F22`. Font: Gabarito, served from
the repo (`@fontsource-variable/gabarito` through `next/font/local` in `src/app/layout.tsx`).
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
- `src/lib/course/` — pure course-structure ops (confirm, merge, rename…), matching, weights
  (`topicUses`), the Atlas's topic graph layout (`topic-graph.ts`).
- `src/lib/deep-review.ts` — dive sizes (minutes per question, presets, the longest dive).
- `src/lib/store.tsx` — `useOrca()`: loads the student's data once, saves optimistically in order
  (structure via `save_structure`, evidence only via `POST /api/evidence`, the rest under RLS).
  Structure changes in the browser only through `editStructure`; jobs change it on the server.
- `src/lib/pipeline/` — upload pipeline (map and objectives part by part, reconcile, generate; no model check of the
  questions since 2026-10-06), prompts and zod schemas; `topup.ts` writes more questions after a
  session and a deep review's harder ones (`runDeepReview`, the "deep" step, called by
  `POST /api/deep-review` when a deep review starts; questions marked `deep`, asked only there);
  `link.ts` is the link step (topic links from names and summaries, after each upload and from
  "Find connections" on the Atlas, `POST /api/relink`).
- `src/lib/connector/mcp.ts` + `src/lib/server/connector.ts` — **the Claude connector** (2026-11-04, owner's pivot:
  Claude teaches in the chat the student already uses; Orca keeps score). An MCP server at `POST /api/mcp/<token>`
  (one JSON-RPC message per POST, no stream) with seven tools (v0.3, 2026-11-08; `INSTRUCTIONS` scripts the session): `flag_check` (a *check me* flag per objective the student
  asked about or got wrong in the chat, `said` screened; writes questions for ones with none), `course_state` (exams, topics with
  counts, every objective's derived status and recall with `detail: "full"` (the default) or none with `"summary"`, what's due now,
  `examFocus` (the next week's exams' topics), `budget` (the daily model budget: ok, reason, resetsAt) and `writing` (top-up runs in
  flight)), `next_questions` (Orca picks: what's due, then exam focus, then unflagged objectives in course order; per objective
  unseen questions first, then least recently answered; `count` 1 to 5; when nothing askable exists and `write` (default) it starts a
  top-up and answers `pending {runId, objectiveIds, state, retryAfterSeconds, reason}`, or says why it won't: the budget, the
  hourly top-up limit, no model; never an empty list without a reason), `set_exam` (date + topic ids = the exam's scope; with
  `remove: true` deletes it), `questions_for` (the older draw, kept; no keys), `check_answer` (owner, 2026-11-08: the student's words; Orca grades choice and
  exact answers itself and prose through `gradeAnswer` on Orca's key with the grade rate limit and budgets, records
  full credit with its own grader and `source: "connector"`, and returns the key and explanation; when it can't grade
  it answers `needsSelfGrade` with the key) and `record_answer` (the fallback: an answer Claude graded, recorded as
  `grader: "self"`: half credit, never clears a mix-up; the student's words, screened, stored on the event as
  `response`, the row's `note`). Mastery rules changed with it (`RULES_VERSION` 3): `verified` takes an unaided
  correct answer, a struggled flag rates the FSRS card Again, a question missed before earns half credit when answered
  right on a later day (`retryCredit`), a graded partial ends a run of misses, and exact answers that are algebraic or
  Boolean expressions are refused at writing time (`isExpressionAnswer`; numbers compare by value). The token is minted in
  Settings → Claude connector (`/api/connector`; only its sha256 is stored, `connector_tokens`, migration
  `20261104090000`) and pasted into Claude as a custom connector with no sign-in: the URL is the secret, so the proper
  OAuth route is still to do (`docs/SETUP-HOSTED.md` §8). The protocol module is pure and tested with a fake
  `ConnectorTools` (`tests/connector/`); the Supabase-backed tools only read and write the token's student.
- `src/lib/canvas/` + `src/lib/server/canvas.ts` — **Canvas import** (2026-11-04, plan
  `docs/superpowers/plans/2026-11-04-canvas-import.md`): Settings → Canvas takes the student's Canvas site and access
  token (checked against `/users/self`, stored AES-256-GCM-encrypted with a key derived from `SUPABASE_SECRET_KEY`;
  `canvas_connections`, service-role only). `/import/canvas` lists their active Canvas courses (`GET /api/canvas/courses`)
  and `POST /api/canvas/import { canvasCourseId }` creates or updates the Orca course: assignments with a due date become
  exams (name says exam/midterm/final/quiz/test) or `hw`/`lab` calendar entries, the syllabus becomes a ready material,
  and every PDF/.pptx in the modules (in order) and then the file list (by the number in the name, `sequenceNumber`,
  then posting date) goes through `startUpload` → Storage →
  `processUpload` → job, exactly as a browser upload (assigned = module unlock date else the file's creation date).
  Every imported file counts as covered (owner, 2026-11-08). `canvas_links` records every imported Canvas object, so importing again adds only what's new; the
  route pulls files until a 200 s budget and reports `files.remaining`, and the page keeps calling. The pure module
  (`api.ts`: classification, file picking, Link pagination; `client.ts`: bearer client with injectable fetch, downloads
  follow the signed redirect without the token) is tested in `tests/canvas/`; migration `20261104100000`, pgTAP 16.
  Token auth only; OAuth needs a developer key from the university's Canvas admins (`docs/SETUP-HOSTED.md` §9).
- `src/lib/jobs/` + `src/lib/server/jobs/` + `src/trigger/` — upload and top-up jobs (`ORCA_JOBS=inline|trigger`). A queued
  upload can be **paused** from the Uploads tab (`POST /api/runs/pause`, one run or a whole course's; run status `paused`,
  uploads only, migration `20261031100000`): it leaves the queue (nothing waits behind it, never taken for dead) and
  Resume puts it back in line by upload time; re-uploading a paused file resumes its run instead of starting a second.
  A running upload can be **stopped** (`POST /api/runs/stop`, `stopRun`: failed with `STOPPED_ERROR`, the queue moves
  on; a job still alive can't revive it, its final save checks the run is still running). A retried upload (Try again,
  or the file uploaded again after a failure) keeps the failed run's `at`, so it goes back to its place in line.
  Settings' Disconnect buttons (Canvas, Claude connector) ask first (2026-11-07). Material can be **removed**
  from a course (`DELETE /api/materials/:id`, `removeMaterial`): file, pages and calendar entry go, the row stays with
  status `removed` (not loaded; hash cleared so the file can be uploaded again), the objectives only it taught and a
  topic it created that has no live objective left are archived with `archived_with_material` (migrations
  `20261031110000`, `20261031120000`), which the pipeline's matching leaves out so they aren't read as rejections;
  restoring or confirming by hand clears the flag.
- `src/lib/server/` — route helpers, model step caller (`model.ts`), grading, usage metering, rate limits.
- `src/lib/model-config.ts`, `llm-server.ts`, `pricing.ts`, `limits.ts` — provider choice, model calls, prices, every limit.
- `src/lib/untrusted/` — sanitising, prompt data blocks, injection screen, output validation.
- `src/lib/material/read-pdf.ts`, `read-pptx.ts` (+ `unzip.ts`, `kind.ts`), `src/lib/uploads.ts` — PDFs and .pptx decks to
  Storage, read on the server into `material_pages`. The upload page takes several files or a whole folder at once
  (`filesFromDataTransfer` walks dropped folders; `src/components/upload/BatchList.tsx` is the per-file list with
  type and dates prefilled from the page's shared defaults; files are sent one after another, each row showing where
  it is; a file Orca can't read is listed as skipped). The page also takes **pasted text** (owner, 2026-11-07: one
  paste box, the type picked decides how it's read; `POST /api/materials/text`, named "Syllabus (pasted), Nov 7") and
  a public AI-chat share link; **"AI chat" is a material type** (migration `20261107130000`): only that type gets the
  transcript treatment (speakers labelled, the header, the chat rules in `TYPE_RULES`), whatever the material is
  called. **The warm-up** (owner, 2026-11-08; `src/lib/mastery/warmup.ts`): a course's first upload also
  writes one ordinary question for its ten heaviest objectives (`WARM_UP_WRITES`, in `runUpload` beside the marked ones), so a
  course with nothing flagged has something to try: the trail's empty state shows START as "Try N questions"
  (`data-part="warmup-start"`), the sidebar a "Warm-up · 5 min" card (`todoCards`' `warmUp`), both to
  `/session/<slug>?kind=quick&warmup=1`, a quick-style session over up to five unflagged objectives with an askable question,
  heaviest first (`warmUpCandidates`); a miss makes a weak point as anywhere. Offered only while nothing in the course is in
  rotation or waiting on a check. Three files or more is a bulk upload (owner, 2026-10-27): the
  rows' dates hide behind "Add dates". Every material counts as covered (owner, 2026-11-08: "How far has the class
  got?", `materials.upcoming` and "Mark covered" were removed; migration `20261108100000`) (a .pptx: one page per slide, its text, tables and speaker notes; no
  pictures, and no slide figures; see `docs/TO-DISCUSS.md`). Handwritten and scanned PDF pages (the "Handwritten notes"
  switch, a notes app's PDF, or a page with no text) are marked `needs-vision` and read from their images by the
  `transcribe` step at the start of the upload job; typed slides that draw a figure (an image 100 px+ or 25+ paths,
  template artwork ignored) are marked `needs-figure` and the `describe` step appends "[Figures: …]" to their text
  (`src/lib/pipeline/transcribe.ts`; plan in `docs/superpowers/plans/2026-10-18-handwritten-notes.md`).
- `src/components/` — `ui/` primitives, `layout/` (TopBar, AppShell, LoadingScreen: the shared full-screen wait, NavBar: on a course page its
  gear opens that course's settings), `quiz/` (QuizRunner, DeepReviewSetup, DiveModal, QuizEnd,
  RateQuestion, ShortAnswer, TruthTable), `config/` (ClassMeetings, ReviewDays, ConfigRow,
  ExamsModal, NotesForOrca), `review/` (the review screen's tabs and upload cards), `settings/`
  (Account, ClaudeConnector, CanvasConnection, YourMetrics; YourAI is hidden), `upload/`
  (BatchList), `calendar/`, `map/`, `path/`, `atlas/` (TopicGraph), `auth/`, `brand/`, `store/`
  (SaveStatus); `src/lib/motion.ts` holds every animation preset.
- `src/app/` — routes (`/` is the courses map; `/home` redirects there; `/welcome` the old onboarding screen; `/new-course`, `/course/[slug]/…`, `/quiz/…`, `/session/…`, `/add-material`,
  `/import/canvas`, `/settings`, `/calendar`, auth screens, `/api/*` including `deep-review`, `relink`, `runs/*`,
  `connector`, `mcp/[token]` and `canvas/*`). Run
  `npx next typegen` before `tsc` after adding a route.
- `e2e/` — Playwright specs, one per area; `fixture.ts` signs in a throwaway student. Tests find
  things by `data-level`, `data-visual` and `data-part`; keep those attributes stable.
- `docs/samples/ald/` — the real ALD decks for the extraction scorer, **not committed** (gitignored; removed from the
  history 2026-10-27 before the repo went public: course material isn't ours to publish; `docs/samples/README.md`).
  Tests use the generated stand-in deck `makeDeck()` in `tests/fixtures/pdf.ts`. `docs/OBJECTIVES-ALD.md` is the benchmark.
- Deploy: Vercel (https://orca-lake-omega.vercel.app) builds `backend-implementation` (Production);
  pushes to other branches get Preview deploys at most. **Nobody pushes there by hand any more:**
  `.github/workflows/deploy.yml` merges `main` into it (after pushing new migrations) whenever CI
  on `main` is green, so merging a PR into `main` is the deploy (`docs/SETUP-HOSTED.md` §5 lists
  the two secrets it needs for migrations). Production env vars (Vercel → Settings →
  Environments → Production): the Supabase three, `SITE_URL`, `ORCA_JOBS=trigger` with
  `TRIGGER_SECRET_KEY`, and the model key (`OPENAI_API_KEY`, or `ANTHROPIC_API_KEY`) with
  `ORCA_MODEL` if not the default; without a key the upload page says "No AI connected". Changing an env var needs a new deploy (an empty
  commit by the owner pushed to `backend-implementation`, or Redeploy on the deployment's page).
  Jobs run on Trigger.dev in production (since 2026-11-05; `TRIGGER_SECRET_KEY` is a Prod key of
  Amanda's project `proj_cafvbqanvngbcfvnpmqv`, also the default ref in `trigger.config.ts`). The
  Deploy workflow deploys `src/trigger/` there on every merge to `main` (the `TRIGGER_ACCESS_TOKEN`
  and `TRIGGER_PROJECT_REF` repository secrets are set since 2026-11-07). The tasks read their own
  env vars from Trigger.dev's Prod environment, not Vercel's (`docs/SETUP-HOSTED.md` §2 step 4,
  including `ORCA_JOBS=trigger`, without which a finishing job can't start the student's next one);
  `trigger.config.ts` installs `pdfjs-dist` and `@napi-rs/canvas` in the image (`build.external`),
  or handwritten pages can't be drawn. The first jobs failed
  with "No matching branch env" until the SDK was told to send no preview branch
  (`src/lib/server/jobs/start.ts`; `docs/SETUP-HOSTED.md` §2).

## What to build next

`docs/BACKEND-ROADMAP.md` is the plan. Phases 1–4 are built and live; Phase 7 (the MCP connector)
has a first version and Canvas import is built (2026-11-04); Phases 5 and 6 haven't started. Next
by the owner's priorities: the 2026-11-08 plan from Phase 3 on, then the open items above. Before
tuning extraction, run `npm run score:extraction` with a key (and the local ALD decks) and record a
baseline. Phases: (1) mastery core on-device, (2) uploads create
topics, objectives, weights and relations (on-device), (3) scheduling and sessions, (4) Supabase
(auth, tables, Storage, snapshots, server-side pipeline), (5) relation mastery, exams and calendar,
(6) ALD drills, (7) MCP connector. Build each phase with
`superpowers:writing-plans` → `superpowers:subagent-driven-development`; plans go in
`docs/superpowers/plans/` (phases only; bug fixes use Fix mode, see Conventions). Animation next steps are in `docs/ANIMATION.md`.
Phase 5's "relation mastery" was written for objective-level relations; relations are topic-level
now, so that part needs rethinking before it's planned.

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
