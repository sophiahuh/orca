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
  change priority (what gets practised first), never what counts as mastered. Spacing after that is **FSRS** (`ts-fsrs`,
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
   material covers, relations, and weight signals. It may use general knowledge of the subject.
2. **Duplicate detection**, cheapest first: normalised names and aliases match exactly; the
   prompt is told to reuse existing ids; reconciliation (one Claude call per still-new item, against
   the closest existing ones with full descriptions) answers `same | new | uncertain`; every merge
   keeps the losing name as an alias so it matches instantly next time.
3. **Review:** the student confirms new topics; `uncertain` matches are highlighted. Nothing waits
   on review to be practised (confirmation rule below).
4. **Questions** are generated per objective (about 6), validated (port the platform's ambiguity
   check and answer agreement) and stocked.

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
Plan: `docs/superpowers/plans/2026-10-05-orca-phase3-scheduling.md`. Built 2026-10-05 on branch
`phase-3`: priority with reason sentences (`src/lib/mastery/priority.ts`), the per-course agenda
(`agenda.ts`: ranked due list, quick- and deep-review cadence, poor-session review to-dos and
next-day re-quizzes), session assembly (`session.ts`), top-up after every finished session
(`src/lib/pipeline/topup.ts`, reusing the upload's write-and-check step), `/session/[slug]`, the
study page and sidebar to-do cards. Finished sessions are recorded (`results`, with `mode` and
`sessionId`), because "the last deep review" can't be derived from answers alone; uploads keep
their page text (`materialPages`) so questions can be topped up later, which is why the store
holds it (no new persistence layer). Not done: deep review counting as a spaced check at double
weight (a mastery-rule change, TO-DISCUSS), slide images in the review to-do (needs stored files,
Phase 4), exam proximity in priority (Phase 5). Never run against a real model yet.
- **Priority** (`docs/MASTERY-PLAN.md` §2.6 minus the parked terms), with objective weight as its
  importance term and confusion signals as a boost; a reason sentence per term.
- **Due list** extended from reviews to new and weak material, ranked by priority.
- **Quick-review sessions** assembled at start from the question stock: time budget from the
  course's quick-review duration, per-type time estimates (about 30 s multiple choice, 45 s exact
  answer, 90 s one sentence), spread across objectives, unseen first, at least one mechanism
  question. An objective with no unseen questions reuses its oldest-seen one, says so, and queues
  a top-up.
- **Top-up** after each session for objectives below 3 unseen questions.
- **Deep review** due per course from its configured cadence (next due one cadence after the last
  completed one; stays due if missed), with its question mix weighted by the material sliders.
- **Poor-quiz loop:** a Review to-do with the slide range and missed explanations, and a re-quiz
  the next day.

### Phase 4 — Supabase
- Auth screens in Orca's style; `proxy.ts` session refresh (Next 16's name for middleware).
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
- Decide what happens to localStorage data at first sign-in (TO-DISCUSS).
- Carry-overs from Phase 1: `localDayKey` uses the host's timezone, so server-side folding must
  pass the student's; stored accumulators need a rules version so a rule change (e.g. a new field
  like `checkDueAt`) rebuilds them; old `orca:v3`/`orca:v4` localStorage keys can be removed.
- Verify live: push migrations, prove RLS with two users, run a real upload.

### Phase 5 — Relation mastery, exams, calendar
Connection questions record evidence on a relation, which gets its own derived state (weak or
strong). `implies` shielding: a correct answer on an objective counts as a partial review of the
objectives it implies. A miss triggers one diagnostic question on what it builds on. Exam tier
(port `stage-boundaries.ts`): retired objectives in scope come back; retrieval → mixed → transfer.
Calendar shows deep reviews, exam blocks and material due dates.

### Phase 6 — Drills and exact checkers for ALD
Generators for the procedural objectives in `docs/OBJECTIVES-ALD.md`; Boolean answers checked by
truth-table equivalence.

### Phase 7 — MCP connector
`/api/mcp` with per-student tokens: `log_study`, `get_due`, `get_material`
(`docs/MASTERY-PLAN.md` §5). Connector activity raises priority; it never counts toward mastery.
