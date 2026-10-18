# Backend roadmap

How Orca gets a real backend. Decided 2026-10-04: build the backend in this repo, using Orca's own
learner model (`docs/MASTERY-PLAN.md`), and port the parts of `ai-native-learning-platform` that fit
(`docs/BACKEND-NOTES.md` maps them). The platform repo is a reference, not a dependency.

Each phase gets its own plan in `docs/superpowers/plans/` when it starts. Phases 1 and 2 have one.
Open questions live in `docs/TO-DISCUSS.md`.

## Decisions

**Course structure**
- **Unit of mastery is the objective** ("can do X"): course → topic → objective → questions.
  Objectives are course data, created once per course (at upload) and never regenerated. Concepts
  from extraction are tags on objectives, used for duplicate detection and grounding, not shown
  as the unit students see.
- **Ids are random and permanent; nothing is deleted.** Topics, objectives and questions get a
  random UUID when created, never derived from text, position or filename: every answer points at its
  question by id, and the mastery fold uses that id to find the question's current objective and
  to count distinct questions. Questions and objectives are archived or merged, never deleted,
  so no answer outlives what it answered. An archived (rejected) objective stays so it can be
  restored, so the mastery fold can skip its answers explicitly, and so duplicate detection
  drops it when a later upload proposes it again. A merged one keeps a pointer to the survivor
  (`mergedInto`) and its name as an alias. Duplicate detection is separate from identity: a
  normalised prompt (`promptKey`) for questions, names and aliases then reconciliation for
  objectives, and it checks archived and merged ones too. Where a question came from is a field
  (`materialId`), not part of its id.
- **Every topic and objective has a weight**, starting at a neutral 1.0. Claude records signals
  (coverage, material type, explicit emphasis, what builds on what); code turns them into weights
  with a fixed formula (Phase 2).
- **Relations between objectives** (builds on, implies, contrasts with, applies to) are extracted
  with uploads, because weights need "how many objectives build on this". Relation mastery comes
  later (Phase 5).
- **Nothing ships seeded.** Every course is created by the student and filled from uploads: no
  built-in courses, due items, calendar events, materials or streak. (Phase 1 kept ALD as a
  labelled sample; it was removed after Phase 1.)

**Learner state**
- **Derived, never written.** Every graded answer appends an evidence event; objective state,
  topic progress, island level, the due list and the streak are computed from the events and the
  clock. An answer counts toward its question's current objective, so merging or re-tagging
  questions re-files past answers.
- **Mastery is a decision, not an average:** 3 credited answers on 3 different questions, on at
  least 2 days, last two correct, no open mix-up, and at least 2 of the credit from graded (not
  self-marked) answers. The bar is the same for every objective: weights
  change priority (what gets practiced first), never what counts as mastered. Spacing after that is **FSRS** (`ts-fsrs`,
  Anki's scheduler): fed every answer from the first, 90% target recall, intervals capped at 60
  days; retired at 60-day stability with 3 passed checks. Details: `docs/MASTERY-PLAN.md` §2.5.
- **A check coming due means fading.** When a mastered objective's spaced check comes due (or is
  missed), it's `fading` and stops counting as mastered until answered correctly again. States
  table: `docs/MASTERY-PLAN.md` §2.3.
- **Self-reported confusion un-masters.** A homework reflection like "I didn't understand K-map
  grouping" is matched to objectives (the student confirms uncertain matches) and recorded as a
  confusion event, which resets a mastered objective all the way to learning. Claims of
  understanding never raise mastery.
- **Computed by folding.** The mastery rule is a step function, `applyAnswer(state, answer)`, plus
  `stateAt(state, now)`. On-device it replays the log; in Supabase the state is a stored snapshot
  updated with each answer (event sourcing with snapshots), rebuilt only when rules change or
  questions are re-filed.
- **Topics are not gates.** Every topic is playable; the trail shows progress, not locks.
- **Islands show mastery.** Four fixed looks by the share of objectives mastered (thresholds
  provisional, see TO-DISCUSS).

**Practice**
- **Questions are generated ahead, sessions are assembled at start.** Each objective keeps a
  stock of validated questions (about 6 at upload, topped up after sessions). Pressing start
  assembles the session instantly from that stock: spread across the highest-priority objectives,
  unseen questions first, at least one mechanism question, sized to the course's quick-review
  time budget with per-type time estimates (default 10 minutes). Never a placeholder question.
- **Deep review follows each course's own cadence** from its configuration. Its question mix
  follows the material-type weight sliders (e.g. more past-exam-style questions when past exams
  are weighted highest).
- **No in-app AI chat.** The tutor-agent pieces of the platform are not ported. The MCP connector
  (Phase 7) lets the student's own Claude or ChatGPT log study activity as a priority signal.
- **Priority omits the "current topic" boost and the distance discount** until discussed.
- **Claude for all model calls** (`claude-opus-5-5`, via `@anthropic-ai/sdk`); the bring-your-own
  path stays until discussed.

**Infrastructure**
- **Files go in object storage** (Supabase Storage, private bucket, per-student folders, signed
  uploads straight from the browser), never on the app server or in database rows.
- **Day boundaries are the student's local days**, on the device and on the server.
- **No silent placeholders anywhere.** Missing data is an explicit empty or error state.

## Process

- Plan and build each phase with the superpowers skills: `superpowers:brainstorming` when a phase
  still has open design questions, then `superpowers:writing-plans`, then
  `superpowers:subagent-driven-development`.
- Not Spec Kit. The platform ran both flows side by side; one is enough here.
- Ported from the platform in Phase 1: its engineering invariants (into `CLAUDE.md`), its
  `learner-graph` and `assessment-pipeline` skills (rewritten for objectives and Claude as
  `.claude/skills/learner-evidence` and `.claude/skills/assessment`), and its typecheck-on-edit hook. Not ported: `concept-atlas` and Spec Kit skills. The Trigger.dev skills
  come over only if Phase 4 picks Trigger.dev.

## Phases

### Phase 1 — Mastery core, on-device ✅
Plan: `docs/superpowers/plans/2026-10-04-orca-phase1-mastery-core.md`.
Remove the AI chat. Test runners (`node:test` units, Playwright browser walkthrough). Built-in ALD questions tagged with objectives, ALD kept as a
labelled sample course, fabricated seed data removed. Evidence log in the store; the mastery rule
as a step function; topic progress, island level, due list and streak derived.
The quiz writes evidence; the trail and islands read derived state. Still localStorage.

### Phase 2 — Uploads create the course structure, on-device ✅
Plan: `docs/superpowers/plans/2026-10-05-orca-phase2-uploads.md`. Built 2026-10-05: the pipeline
in `src/lib/pipeline/` (extract → match duplicates → generate → check), `/api/pipeline/[step]`,
the review screen, the per-course objective list, homework reflection with confusion events, and
`npm run score:extraction`. Not yet done: the evaluation has not been run against the real decks
(it needs `ANTHROPIC_API_KEY`), so no baseline is recorded and the weight constants are untuned.
Decisions made while building it (also in the plan): topics get random ids too; questions are
checked in batches per topic (one blind-solve call, one ambiguity call, one agreement call per
batch of up to 30) rather than one call per question; "Syllabus" is a material type; a "skipped"
emphasis gives weight 0, unclamped; an objective merge across topics moves the loser's questions
(undoable), a topic merge isn't undoable; homework and exam coverage counts as coverage weighted
by its slider (no separate "tested" field).

Real uploads become the way courses get content, testable before accounts exist. Runs through the
current on-device path (pdf.js in the browser → model route → store) and saves in the browser;
Phase 4 moves it server-side.

For each upload:
1. **Extraction** (Claude) reads the material together with the course's existing topics,
   objectives and aliases, and proposes new topics, new objectives, which existing objectives the
   material covers, relations between topics, and weight signals. It may use general knowledge
   of the subject. Relations link topics, not objectives (owner, 2026-10-06), and are the Concept
   Atlas's edges: used-in, has-a-kind, alternative-to, and related (an unlabelled edge). The same
   extraction call proposes them between the new and existing topics, and a focused link step
   (`src/lib/pipeline/link.ts`: topic names and summaries only, general knowledge allowed) then
   checks every pair involving a new topic, since extraction alone missed obvious links. "Find
   connections" on the Atlas (`POST /api/relink`) runs the link step over the whole course. A
   topic's node grows with the topics it's used in (`topicUses`), and so do its objectives' weights.
   *Stricter links (owner, 2026-10-17):* both calls share `LINK_RULES` in `prompts.ts`: be precise,
   not thorough; "used-in" means a prerequisite (not motivation or a choice it informs); "related"
   only when one topic fixes or works around a limitation of the other, or the subject deliberately
   contrasts them ("commonly confused" is a student's state, not the material's, so it isn't a
   link). Every link carries one specific sentence, `relations.reason`, shown when the student
   hovers the link on the Atlas; a link without one is dropped. "used-in" and "has-a-kind" never
   form a loop: a link that would close one is dropped with why in the run (`closesLoop`,
   `src/lib/course/links.ts`), not relabelled; the Atlas layout still copes with a loop in older
   data. No cap on links per topic: a cap would drop true links and make the map lie. "Find
   connections" also gives old links (made before reasons) their reason when the model returns them.
   Two topics get at most one link, the most specific kind (has-a-kind, used-in, alternative-to,
   related): a pair the course already links is skipped, a more specific kind replaces one made
   earlier in the same upload, and the Atlas draws one edge per pair for older data that has two.
2. **Duplicate detection**, cheapest first: normalised names and aliases match exactly; the
   prompt is told to reuse existing ids; reconciliation (one Claude call per still-new item, against
   the closest existing ones with full descriptions) answers `same | new | uncertain`; every merge
   keeps the losing name as an alias so it matches instantly next time.
3. **Review:** the student confirms new topics; `uncertain` matches are highlighted. Nothing waits
   on review to be practiced (confirmation rule below).
4. **Questions** are generated per objective (about 6) and stocked. They used to be checked by a
   second model (blind solve, ambiguity, rubric agreement); the owner dropped those checks on
   2026-10-06 for speed and cost. Code still refuses rule-breaking output (untrusted-text rules,
   anchors to slides that don't exist, wrong objective, bad structure). Deep reviews write their own
   harder questions when they start (`POST /api/deep-review`), marked `deep` and asked only there;
   the material-type sliders no longer shape a deep review's mix.

Rules:
- **Every objective belongs to the course whose material was uploaded**, and records the upload
  and extraction run that created it, even when it has no source anchor. No cross-course list.
- **Inferred objectives are allowed, flagged.** One from general knowledge rather than the material
  is `origin: "inferred"` and its questions carry no anchor, so they never claim to be
  course-specific. Material-backed ones are `"material"` with anchors; built-in ones `"authored"`.
- **Confirmation follows the platform's model.** Status `proposed | confirmed | archived`. An
  objective under a confirmed topic auto-confirms unless reconciliation said `uncertain`; inferred
  objectives follow the same rule. `proposed` objectives are quizzable everywhere with an
  "unreviewed" tag; `archived` ones never get questions or appear anywhere.
- **Material type limits what an upload creates.** Lectures and syllabi create topics and
  objectives. Homework and exams mostly attach to existing objectives (adding coverage, "tested"
  marks and practice-style questions) and create a new objective only when it's clearly new.
- **Weights:** see "Weight signals and formula" below.
- **Homework reflection:** the "reflect" note is matched to objectives; uncertain matches are
  shown to the student to confirm; each match records a confusion event (resets mastery to
  learning; raises priority if not yet mastered).
- **Objective list per course:** every objective with its origin, review status, weight and
  mastery state, with reject and merge actions. This is where an inferred objective the course
  never covers gets rejected.
- **Evaluation:** upload the real ALD decks (`docs/samples/ald/`) and score the extracted
  objectives and questions against Sophia's authored set (objectives in `docs/OBJECTIVES-ALD.md`;
  the 69 authored questions are in git history at `src/lib/content/ald.ts`, last present in
  commit 89e042b), following the platform's scoring harness (`scripts/score-extraction.ts`).

#### Weight signals and formula
Claude reports facts; code computes weights. Per objective and per upload, extraction records:
- **Coverage:** distinct places that genuinely teach or use the objective (a slide or section on
  it, a worked example, a homework or exam problem that requires it), each with an anchor. A
  passing mention of the term doesn't count.
- **Material type** of the upload, which brings in the course's slider weight for that type.
- **Explicit emphasis**, only when the material states it ("this will be on the exam" → tested;
  "you won't be tested on this" → skipped), quoting the text.
- **Builds on:** "B requires A" only when the material shows A being used to do B.
- Inferred objectives have no coverage and stay at 1.0 unless explicitly emphasised.

Weight = 1.0 × coverage factor (coverage summed across uploads, each place scaled by its upload's
material-type weight, on a diminishing-returns curve) × builds-on factor (how many objectives build
on it) × emphasis (×1.5 tested, ×0 skipped), clamped to 0.5–2 and recomputed when an upload adds
signals. A topic's weight is the mean of its objectives'. Constants (provisional, in
`src/lib/course/weights.ts` `WEIGHT_RULES`): a place is worth its type's slider ÷ the course's
mean slider (sliders default to equal, so every type is worth 1.0 until the student moves one); coverage factor = 0.75 + 0.75 × (1 − e^(−s/1.5)); builds-on factor = 1 + 0.1 × min(n, 5);
"skipped" is 0 and not clamped.

Carry-overs from the Phase 1 review, both resolved before Phase 2 by the "ids are random and
permanent" decision: extracted questions get UUIDs plus `materialId`, and imports skip prompts the
course already has (`promptKey`), so re-uploading a file can't collide or double-count. There are
no orphaned answers to surface because nothing is deleted; Phase 2's reject and merge actions must
archive or set `mergedInto`, never remove.

### Phase 3 — Scheduling, on-device ✅
Plan: `docs/superpowers/plans/2026-10-05-orca-phase3-scheduling.md`. Built 2026-10-05 (branch `phase-3`, merged
into `backend-implementation`): priority with reason sentences (`src/lib/mastery/priority.ts`), the per-course agenda
(`agenda.ts`: ranked due list, quick- and deep-review cadence, poor-session review to-dos and
next-day re-quizzes), session assembly (`session.ts`), top-up after every finished session
(`src/lib/pipeline/topup.ts`, reusing the upload's write-and-check step), `/session/[slug]`, the
study page and sidebar to-do cards. Finished sessions are recorded (`results`, with `mode` and
`sessionId`), because "the last deep review" can't be derived from answers alone; uploads keep
their page text (`materialPages`) so questions can be topped up later, which is why the store
holds it (no new persistence layer). Deep review counts as a spaced check stretched 1.5× (`MASTERY_RULES.deepReviewStretch`, decided 2026-10-05). Not done: slide images in the review to-do (needs stored files,
Phase 4), exam proximity in priority (Phase 5). Never run against a real model yet.
- **Priority** (`docs/MASTERY-PLAN.md` §2.6 minus the parked terms), with objective weight as its
  importance term and confusion signals as a boost; a reason sentence per term.
- **Due list** extended from reviews to new and weak material, ranked by priority.
- **Quick-review sessions** assembled at start from the question stock: time budget from the
  course's quick-review duration, per-type time estimates (about 30 s multiple choice, 45 s exact
  answer, 90 s one sentence), spread across objectives, unseen first, at least one mechanism
  question. An objective with no unseen questions reuses its oldest-seen one, says so, and queues
  a top-up.
- **Top-up** after each session for objectives below 3 unseen questions. *Changed 2026-10-18
  (owner):* questions follow practice instead of a stock. An upload writes 2 per objective (one that
  does the skill, one "why or how" where there is one), so it finishes sooner and objectives never
  studied cost nothing more; after a session, objectives still being learned (not mastered or
  retired) get 2 more once they have fewer than 2 unseen (`TOP_UP_RULES`). Dive In still writes its
  own. No wait screen for a top-up in progress: a quick review leaves out what was practised today
  and dives write their own questions, so a session can't run into an unfinished top-up.
- **Deep review** due per course from its configured cadence (next due one cadence after the last
  completed one; stays due if missed), with its question mix weighted by the material sliders.
  At its start the student picks how many minutes (the Settings length is the suggestion) and
  sees what that covers; every objective gets one question, highest priority first, before any
  gets a second. The end card offers another deep review (decided 2026-10-05).
- **Poor-quiz loop:** a Review to-do with the slide range and missed explanations, and a re-quiz
  the next day. *Removed 2026-10-10 (owner's decision):* missed objectives join the course's normal
  quick-review queue instead, and anything practiced today waits until the next quick review (never
  the same day). The study page and the `requiz` session are gone; old `requiz` evidence and results
  still load.

### Phase 4 — Supabase (built locally; live checks pending)
Plan: `docs/superpowers/plans/2026-10-05-orca-phase4-supabase.md` (approved 2026-10-05; Tasks 1–9
built on branch `phase-4` by 2026-10-06, every check green against the local stack; Task 10's live
checks wait for the owner's hosted projects, `docs/SETUP-HOSTED.md`).
- Auth screens in Orca's style; `proxy.ts` session refresh (Next 16's name for middleware).
  Email + password through Supabase Auth (email confirmation, password reset, custom SMTP before
  real students); Google sign-in later as a second provider (decided 2026-10-05).
- Tables for everything above, `owner_id = auth.uid()` RLS on every table. Start from the
  platform's migrations (0001/0003/0004/0012/0015/0016/0017) and policies; its `artifacts` bugs
  (no student UPDATE policy; `status` excluded from the column grant) are the checklist. The
  source-anchor check constraint becomes "at least one unless inferred".
- **Files in Supabase Storage**: private bucket, `${userId}/${uuid}/${safeName}`, signed uploads
  from the browser, 25 MB limit, filename sanitising (all ported).
- **Snapshots:** an `objective_state` row per objective holding the accumulator, updated in the
  same transaction as each evidence insert, with a rules version. A rules change marks every
  snapshot stale (rebuilt lazily on read); a merge or re-tag marks only the objectives involved.
  Reads never replay the log otherwise.
- The student's **timezone** on their profile, used for every day boundary.
- Model calls on the server use Orca's key only (decided 2026-10-05); student keys later, if kept.
- The extraction pipeline moves server-side, as **Trigger.dev** tasks (decided 2026-10-05):
  uploads and top-ups outlive Vercel's function limits once textbooks arrive, and Trigger.dev
  gives durable, retried, observable jobs with live progress to the browser, without running our
  own queue or worker.
- **Material storage** (decided 2026-10-05): the original file in Supabase Storage is the source
  of truth; on upload a task reads it once into a `material_pages` table (one row per page or
  slide: number, text, later a rendered image and section heading), keyed by a content hash so a
  re-upload is recognised. Model calls get only the pages they need, found through the anchors
  objectives already record. No third-party document or search service: the data is small and
  relational; pgvector inside Supabase if textbooks ever need search. Browser storage of page
  text (`materialPages`, Phase 3 stopgap) is removed.
- Swap the store's persistence behind `useOrca()` so screens don't change.
- localStorage data is not imported at first sign-in: accounts start fresh (decided 2026-10-05).
- Carry-overs from Phase 1: `localDayKey` uses the host's timezone, so server-side folding must
  pass the student's; stored accumulators need a rules version so a rule change (e.g. a new field
  like `checkDueAt`) rebuilds them; old `orca:v3`/`orca:v4` localStorage keys can be removed.
- Verify live: push migrations, prove RLS with two users, run a real upload.
- **Dependencies added** (plan decision 14): `@supabase/supabase-js` (the database, Auth and
  Storage client; the routes write evidence with it) and `@supabase/ssr` (reads the session from
  Next's cookies on the server). They came in with Task 3 rather than Task 4 because
  `/api/evidence` and `/api/state` must know who is signed in and write with the service role;
  nothing in the project already talks to Supabase. `supabase` (CLI) is a dev dependency since
  Task 1.
  `@trigger.dev/sdk` (Task 7a): the jobs run as Trigger.dev tasks in production (decided above:
  durable, observable, outlive Vercel's function limits) and nothing in the project already
  queues work. The tasks (`src/trigger/jobs.ts`) only call the jobs; locally and in tests
  `ORCA_JOBS=inline` runs the same jobs inside the route, so the SDK is used only to define and
  enqueue tasks. No Trigger.dev project exists yet (Task 10).
  `pdfjs-dist` (Task 6; it was the browser's PDF reader since Phase 2) now also runs on the server,
  on a worker thread, to read uploads into `material_pages`: the same library, no new one.
- **Built (local only, nothing hosted):** the local stack; the schema with owner-only RLS, Storage
  and `save_structure`; `objective_state` snapshots with `record_evidence` and stale marks;
  `POST /api/evidence`, `GET /api/state`; auth; the store on Supabase; uploads into Storage read
  into `material_pages`; the pipeline as server jobs (inline locally; Trigger.dev tasks written,
  never run); grading behind sign-in; the cost guard; the injection defences; CI with the stack.
- **Cost guard (decision 10, built 2026-10-06):** `model_usage` (every call's tokens and cost, from
  `src/lib/pricing.ts`), `rate_limits` with `hit_rate_limit` (fixed windows counted in Postgres: no
  other service), daily budgets per student (300 pages of uploads, 2,000,000 tokens, the student's
  day) and `ORCA_DAILY_BUDGET_USD` for everyone, checked when a job claims its run (`waiting` with
  why, resumed by `resumeNext` when the student's jobs finish, when they start one while nothing of
  theirs runs, and hourly on Trigger.dev), one job at a time per student (a unique index on running
  runs; dead runs judged from `started_at`), bounded calls (timeout, 2 retries of transient failures
  only, spend-limit answers never retried, a cut-off reply still metered). Both tables are
  service-role only. No new dependency: the SDK's own retries are off and `completeJson` retries
  itself. The whole-branch review (2026-10-06) fixed the page budget counting the running job twice
  and runs that could stay queued or waiting for ever (plan status block, Wave 3).
- **Injection defences (decision 13, built 2026-10-06):** `security_events` (service-role only; one
  row per finding, rated `strong` or `weak`, from a trigger on `pipeline_runs.security`, from the
  reflect route and one per flagged answer from the grader), `pipeline_runs.security`, and no model
  pre-screen (Watch). Only strong hits refuse generated text, warn or count against a student. Prompts send untrusted text as
  JSON data blocks; outputs are validated and refused, never repaired. The prompt format changed on
  every step, so `score:extraction` must be rerun with a key before anything is tuned.
- **Also recorded:** `pipeline_runs.objective_ids` (a top-up's request, so a queued run can start
  later); upload cleanup (`src/lib/material/cleanup.ts`, `npm run cleanup:uploads`, a daily
  Trigger.dev schedule) removing abandoned uploads and old failed reads; PDFs parsed on a worker
  thread so the read budget is real; emailed links from `SITE_URL`; token-hash links accepted by the
  callback. Dependencies: none added in Tasks 7b–9 (`worker_threads` and `Intl` are Node's).

### Since Phase 4 (2026-10-06, owner's decisions)
Exams have their own table (`exams`: course, title, date, optional `topic_ids`), edited from the
course page and shown on the calendar; hand-added exam calendar entries moved into it. Dives (deep
review) write their questions when they start, course-wide or for one topic. Course review settings
and weights are overrides of account defaults kept on the profile (null inherits). Relations are
between topics (see Uploads above). No new dependency or persistence layer was added for any of it.

### Phase 5 — Relation mastery, exams, calendar
Connection questions record evidence on a relation, which gets its own derived state (weak or
strong). (Relations are between topics since 2026-10-06, so the `implies` shielding below needs
rethinking: there is no objective-level `implies` any more.) `implies` shielding: a correct answer
on an objective counts as a partial review of the objectives it implies. A miss triggers one diagnostic question on what it builds on. Exam tier
(port `stage-boundaries.ts`): retired objectives in scope come back; retrieval → mixed → transfer.
Calendar shows deep reviews, exam blocks and material due dates.

### Phase 6 — Drills and exact checkers for ALD
Generators for the procedural objectives in `docs/OBJECTIVES-ALD.md`; Boolean answers checked by
truth-table equivalence.

### Phase 7 — MCP connector
`/api/mcp` with per-student tokens: `log_study`, `get_due`, `get_material`
(`docs/MASTERY-PLAN.md` §5). Connector activity raises priority; it never counts toward mastery.
