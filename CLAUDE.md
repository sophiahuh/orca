# Orca — study app (v1 web prototype)

Orca turns every college class into an "island" on a knowledge map. Inside an island is a
Duolingo-style trail of topics; topics run quizzes; the orca mascot nudges reviews on a cadence the
student configures per class. Tagline: "Mastery Made Easy."

Design source of truth: Figma file `Xt9CiD6SpdN0BPma1q2pzZ` ("Orca – Study App Mockups").
Reference renders live in `docs/figma/` (`screens.png` = all 11 screens, `styleguide.png`, and the
traced SVG assets in `docs/figma/assets/`). Frames are 1194×834; v1 ships as a laptop website.

## Start here (handoff, updated 2026-10-05)

**Who it's for.** A college student who wants to actually master their classes, not cram. They
create a course, upload its material (lecture decks, syllabus, homework, past exams), and Orca
turns it into objectives ("can do X") with checked quiz questions, then tracks mastery per
objective from their answers and spaces reviews (FSRS) until each one sticks. The test course is
Advanced Logic Design (ALD, Columbia ELEN); `docs/samples/ald/` has its real decks, and Sophia
authored and reviewed the reference objectives, questions and quiz rubric.

**Where things stand.**
- Work happens on branch **`backend-implementation`** (CI runs on it); `main` is far behind (still
  at the pre-Phase-1 prototype) and nothing has been merged into it or opened as a PR. Phase 3 was
  built on branch `phase-3` and merged (fast-forward) into `backend-implementation` on 2026-10-05.
- Phases 1 (mastery core), 2 (uploads build the course) and 3 (scheduling and sessions) are built
  on-device, with localStorage as the only persistence. Checks are green: `npx tsc --noEmit`,
  `npm run lint`, `npm test` (142 unit tests), `npm run test:e2e` (22 browser tests), `npm run build`.
  CI only runs on pushes to `main` and `backend-implementation` and on pull requests, so a push to
  any other branch isn't checked by CI: run the checks yourself.
- **Stopgap to remove in Phase 4:** uploads keep their page text in localStorage
  (`materialPages`) so top-ups can write from it. The decided design (roadmap, Phase 4) moves
  files to Supabase Storage and page text to a `material_pages` table, with processing in
  Trigger.dev tasks; don't build more on browser storage.
- **Never run against a real model.** Every pipeline test stubs the model. No session so far has
  had `ANTHROPIC_API_KEY`, so the prompts in `src/lib/pipeline/prompts.ts` are untested against
  Claude, `npm run score:extraction` has no baseline (`scripts/extraction-baseline.json` doesn't
  exist), and the weight constants are untuned.
- The Vercel deploy (https://orca-lake-omega.vercel.app) is from before Phase 1; it doesn't show
  any of this.

**Next, in order.**
1. With a key: `ANTHROPIC_API_KEY=… npm run score:extraction -- --update-baseline`, then upload
   an ALD deck in `npm run dev` and look at the review screen. Fix prompts where extraction or
   question checks go wrong; commit the baseline. Then finish a session in `npm run dev` and check
   the top-up writes sensible questions (it has only run against a stubbed model).
2. Settle the Phase 3 numbers in `docs/TO-DISCUSS.md` ("Phase 3 scheduling numbers", "Deep review
   as a spaced check").
3. Phase 4, Supabase (auth, tables, snapshots, server-side pipeline on Trigger.dev, material
   storage as decided in the roadmap). The plan is written
   (`docs/superpowers/plans/2026-10-05-orca-phase4-supabase.md`) and waits for the owner's review;
   don't start building until the owner says so. Tasks 1–9 need no hosted projects (local
   Supabase, inline jobs, a fake Anthropic API); only Task 10's live checks do.
Open product questions the student/owner must decide are in `docs/TO-DISCUSS.md`. Don't decide
them silently; list what you assumed.

**Environment gotchas.**
- Cloud containers: Playwright's Chromium build doesn't match; run e2e with
  `PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run test:e2e`.
- Run `npx next typegen` before `tsc` after adding a route; delete a stale `.next/dev` if `tsc`
  complains about a route that no longer exists.
- Playwright's `page.clock.setFixedTime` freezes `motion` animations after the first page, so
  content can stay invisible (opacity 0) or a quiz can stick on its first question. Set the clock
  once, before the first navigation, and seed past days' evidence instead of moving the clock
  mid-test (see `e2e/scheduling.spec.ts`).
- Changing the persisted state's shape means bumping `STORAGE_KEY` in `src/lib/store.tsx` and
  `e2e/fixture.ts` together (no migrations; local data is test data).
- Pure modules (`src/lib/mastery`, `src/lib/course`, `src/lib/pipeline` except `client.ts`) must
  load under plain Node: relative imports with `.ts`, `import type`, no TS parameter properties.
- The superpowers skills named below may not be installed in every session; if they aren't,
  follow the same flow by hand (plan doc first, then task-by-task commits with tests).

**Map of the docs.** `docs/BACKEND-ROADMAP.md` (decisions + phases, what's done), `docs/MASTERY-PLAN.md`
(learner model), `docs/TO-DISCUSS.md` (open questions), `docs/superpowers/plans/` (per-phase plans
with status notes), `docs/QUIZ-RUBRIC.md` (what makes a good question), `docs/OBJECTIVES-ALD.md`
(reference objectives / evaluation benchmark), `docs/BACKEND-NOTES.md` (what to port from the
earlier `ai-native-learning-platform` repo), `docs/ANIMATION.md`. Repo-local skills:
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
- No backend yet. State is a React context persisted to localStorage (`src/lib/store.tsx`).
  Supabase is the planned backend (Phase 4 of the roadmap); screens only talk to `useOrca()`, so
  the persistence swap happens behind it.
- Model calls use the Claude API (`claude-opus-5-5`). Load the `claude-api` skill before writing
  any API route. Without a key (and no student model), uploads are saved without generating
  anything and prose answers are self-marked.
- Unit tests: `node:test` with Node's type stripping (Node ≥ 22.6), run with `npm test`.
- Browser tests: Playwright (`e2e/`, `playwright.config.ts`), run with `npm run test:e2e`. It starts
  `next dev` on port 3100 (reuses a running one locally, never in CI) at the 1194×834 frame size; each test gets a fresh
  localStorage. First run: `npx playwright install chromium`, or set `PLAYWRIGHT_CHROMIUM_PATH` to
  an installed Chromium (cloud containers ship one at `/opt/pw-browsers/chromium-*/chrome-linux/chrome`).
- CI: `.github/workflows/ci.yml` runs typecheck, lint, unit tests and build, and the Playwright
  suite in a second job (traces uploaded on failure), on pushes to `main` / `backend-implementation`
  and on pull requests.

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
  resets an objective to learning.
- `src/lib/store.tsx` — `OrcaProvider`, `useOrca()`, `useCourse(slug)`; persisted to localStorage
  (key `orca:v8`). Holds per-course `objectives` and `relations`, pipeline `runs`, each upload's
  text (`materialPages`, for top-ups), finished sessions (`results`, with `mode` and `sessionId`),
  and an append-only `evidence` log (answers and confusion events); `recordEvidence` and
  `recordReflection` are its only writers. `addQuestions` adds topped-up questions. Course structure changes through `applyUpload` (a
  pipeline plan) and `editStructure` (an op from `src/lib/course/ops.ts`). Derived reads:
  `useMasteryByCourse()`, `useAgenda()`, `useTodos()`, `useStreak()`.
- `src/lib/course/` — pure course-structure modules (tested with `npm test`): `ops.ts` (confirm,
  reject, restore, rename, merge and un-merge topics and objectives; settle uncertain duplicates),
  `match.ts` (name normalisation, exact name/alias matching that follows merges and reports
  rejected matches, shortlist for reconciliation), `weights.ts` (weights from upload signals,
  `WEIGHT_RULES`), `review.ts` (what still needs review), `study.ts` (where an objective is taught,
  as "file, slides 18–20").
- `src/app/providers.tsx` — store + `MotionConfig reducedMotion="user"`. `src/app/template.tsx` — page transitions.
- `src/hooks/useFitScale.ts` (854×834 canvas scaling), `src/hooks/useToday.ts` (hydration-safe date),
  `src/hooks/useNow.ts` (clock for derived state), `src/hooks/useTopUp.ts` (tops up a finished
  session's objectives in the background).
- `src/components/icons.tsx`, `brand/` (OrcaLogo, Island with four mastery looks, Wave, Bubble).
- `src/components/ui/` — Button, Chip/ContextPill, RoundButton, ProgressBar, Card, Tag, Stat, Select,
  Toggle, Slider, AnswerOption, DueCard, PathNode (done / current / upcoming, no locks) (barrel in `ui/index.ts`).
- `src/components/layout/` — AppShell (main + 340px Sidebar with NavBar), BackButton, Screen.
- Feature components: `map/` (KnowledgeMap, LabelPill), `path/KnowledgePath`, `quiz/` (QuizRunner,
  shared by topic quizzes and sessions; TruthTable, QuizEnd, ShortAnswer, DeepReviewSetup: the
  "how long do you want to study?" picker with the coverage plan), `config/` (ConfigRow, ClassConfigModal), `calendar/MonthGrid`.
- Routes: `/`, `/home`, `/course/[slug]` (+ `/review`, `/objectives`, `/reflect`, `/study`),
  `/quiz/[slug]/[topic]`, `/session/[slug]?kind=quick|deep|requiz`, `/settings`, `/calendar`, `/add-material`, `/new-course`,
  `/api/pipeline/[step]`, `/api/grade`, `/api/llm/*`. Dynamic
  pages read `params`/`searchParams` with React `use()` and the generated `PageProps<...>` types
  (run `npx next typegen` before `tsc`).
- Bring-your-own-LLM (`src/lib/llm.ts`, `llm-server.ts`, Settings → "Your AI"): the student picks
  Anthropic / OpenAI / Gemini / OpenRouter / Ollama + a key; it lives in the store (browser only) and
  rides along with each request. Anthropic goes through `@anthropic-ai/sdk`; the rest use the
  OpenAI-compatible chat.completions shape; Ollama is called from the browser. Model routes fall
  back to the server `ANTHROPIC_API_KEY` (`claude-opus-5-5`); with neither, uploads are saved
  without generating anything and prose answers are self-marked. Whether to keep
  this is open (`docs/TO-DISCUSS.md`).
- Upload pipeline (on-device; Phase 4 moves it server-side), `src/lib/pipeline/`: `src/lib/pdf-text.ts`
  reads the PDF in the browser → `runUpload` (`run.ts`) calls the steps through an injected caller:
  **extract** (structure and signals against the course's existing topics and objectives, with
  material-type rules), **reconcile** (only when something is close; same/new/uncertain),
  **generate** (questions per objective, topped up to 6), then **solve** (blind, compared in code
  for choice and exact answers), **ambiguity** and **agreement** checks; failures and duplicates are
  dropped with a reason in the run record. Prompts (`prompts.ts`) and zod schemas (`schemas.ts`)
  are shared by `/api/pipeline/[step]` (builds the prompt server-side from structured input) and
  `client.ts` (browser-only providers). `apply.ts` merges the plan; uploads land on
  `/course/[slug]/review`. `writeQuestions` (generate + checks) is shared with `topup.ts`, which
  writes more questions after a session for objectives under 3 unseen, from only the stored
  pages of the material each objective is anchored to (plus one either side). `npm run score:extraction` scores extraction on the ALD decks against
  `docs/OBJECTIVES-ALD.md` (needs `ANTHROPIC_API_KEY`; `--dry` checks the decks without a model).
- ALD reference material (not shipped in the app): `docs/samples/ald/L01–L04` (real ALD lecture
  decks; syllabus in L01) to upload, and draft objectives in `docs/OBJECTIVES-ALD.md`. The 69
  questions Sophia authored from them were removed from the app; they're in git history
  (`src/lib/content/ald.ts` at 89e042b) for evaluating extraction.
- `e2e/` — browser tests: `mastery-core.spec.ts` (fresh browser, empty states, the trail, quiz
  answers writing evidence), `upload.spec.ts` (a real ALD deck through pdf.js and the pipeline with
  `/api/pipeline/*` stubbed; re-uploading adds nothing), `review.spec.ts` (review screen and
  objective list actions, Unreviewed tag), `reflect.spec.ts` (a reflection resetting an objective),
  `scheduling.spec.ts` (quick review, poor-quiz to-dos and re-quiz, deep review cadence, top-up).
  `e2e/fixture.ts` seeds state into localStorage.
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
- Before committing: `npx tsc --noEmit`, `npm run lint`, `npm test`, and `npm run test:e2e` when a
  screen or the store changed. A behaviour you would check by hand in the browser belongs in `e2e/`.
  `npm run dev` for the preview.
