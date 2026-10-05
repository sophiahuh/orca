# Orca Phase 2: Uploads Create the Course Structure

Roadmap: `docs/BACKEND-ROADMAP.md`, Phase 2. Still on-device: pdf.js reads the file in the browser,
model calls go through Orca's routes (or straight from the browser for browser-only providers), and
everything lands in the localStorage store.

**Goal.** Uploading a lecture deck (or homework, exam, syllabus) creates or extends the course's
topics, objectives, relations and weight signals, generates and validates questions per objective,
and lets the student review what was created. A homework reflection can reset objectives the
student says they don't understand.

## Global constraints

- Everything in `CLAUDE.md` "Invariants". In particular: ids are random UUIDs and nothing is
  deleted (archive or merge); learner state stays derived; no silent placeholders.
- Pure modules (`src/lib/course/`, `src/lib/pipeline/` prompt builders and appliers,
  `src/lib/mastery/`) use relative `.ts` imports and `import type`, so `npm test` runs them.
- Model calls are injectable (`(system, prompt, schema) => Promise<T>`), so orchestration is
  unit-tested with fakes and judgement is checked by the evaluation script, not by mocked tests.
- Before every commit: `npx tsc --noEmit`, `npm run lint`, `npm test`, and `npm run test:e2e`
  when a screen or the store changed.

## Decisions taken in this plan

Each is recorded in the roadmap when its task lands. Ones marked **(review)** are judgement calls
worth a second look.

1. **Topic ids are random too.** Today a topic id is `slugify(name)`, which is both an identity
   and a crude duplicate check. Topics get UUIDs; duplicates are caught by names, aliases and
   reconciliation, like objectives.
2. **The browser orchestrates; each step has its own route.** `/api/pipeline/[step]` with the
   prompt built on the server from structured input (no generic "send any prompt" proxy on Orca's
   key). Browser-only providers (Ollama) run the same prompt builders from the browser.
3. **Steps.** (a) *Extract* (1 call): structure and signals only, no questions. (b) *Reconcile*
   (1 call per still-new topic or objective, 4 at a time). (c) *Generate* (1 call per topic
   touched): questions for each objective short of 6. (d) *Validate* (per generated batch): a
   blind solve (question only, no answer) compared in code for choice and exact answers, a model
   agreement check for rubric answers, and an ambiguity check for choice questions. Questions
   that fail are dropped and counted, never shown. **(review: batching validation per topic
   instead of the platform's one call per question.)**
4. **Status rules** (roadmap "Confirmation"): new topics start `proposed` until the student
   confirms them. An objective under a confirmed topic is `confirmed` unless reconciliation said
   `uncertain`; under a proposed topic it is `proposed`, and confirming the topic confirms its
   objectives except uncertain ones. `proposed` is quizzable everywhere with an "Unreviewed" tag.
   `archived` is never quizzed, shown only in the objective list, and its answers are skipped by
   the fold. Rejecting a topic archives it and its objectives.
5. **Merges keep the loser.** An objective merge sets `mergedInto` on the loser and copies its
   name and aliases onto the survivor; reads resolve the chain, so the loser's questions and
   answers count for the survivor and the merge can be undone. A topic merge also sets
   `mergedInto`, moves the loser's objectives and questions to the survivor, and archives the
   loser (not undoable in Phase 2).
6. **Weights** (constants for "Weight signals and formula"). **(review: all numbers)**
   - Material type → slider: Lecture and Syllabus → `lectures`; Homework → `homework`;
     Practice problems → `practiceProblems`; Past exam and Practice exam → `practiceExams`;
     Other → neutral 1.0. A place's value = its slider ÷ the mean of the course's sliders
     (defaults give lectures 0.4, practice problems 1.0, homework 1.2, practice exams 1.4).
   - Coverage factor = 0.75 + 0.75 × (1 − e^(−s / 1.5)), s = summed place values (0.75 with no
     coverage, about 1.1 at s = 1, approaching 1.5).
   - Builds-on factor = 1 + 0.1 × min(n, 5), n = confirmed or proposed objectives that build on it.
   - Emphasis: latest explicit statement wins; "tested" × 1.5; "skipped" → weight 0 (not clamped:
     "you won't be tested on this" means no priority at all).
   - weight = clamp(0.5, 2, coverage × builds-on × emphasis); inferred objectives use coverage
     factor 1.0. Topic weight = mean of its non-archived objectives.
7. **"Syllabus" becomes a material type.** The roadmap says lectures and syllabi create topics;
   there was no way to say a file is a syllabus.
8. **Material type limits creation** in the extract prompt: lectures and syllabi create topics
   and objectives; homework and exams attach coverage to existing objectives (marking exam
   coverage `tested`) and create an objective only when nothing existing fits.
9. **Confusion is its own event kind** in the evidence log (`kind: "confusion"`, objective,
   material, the student's note). The fold resets the objective to learning (credit, credit
   days, attempted questions cleared). Priority effects wait for Phase 3.
10. **Storage key `orca:v7`, no migration.** Local data is test data (TO-DISCUSS "Existing local
    data" recommends starting fresh).

## Data model

`src/lib/data.ts` / `src/lib/mastery/types.ts` / new `src/lib/course/types.ts`:

```ts
type Review = "proposed" | "confirmed" | "archived";
interface Topic { id; name; aliases: string[]; review: Review; mergedInto?: string;
  materialId?: string; pos; summary?; source? }
interface ObjectiveInfo { id; topicId; name; description: string; aliases: string[];
  origin: "material" | "inferred" | "authored"; review: Review; mergedInto?: string;
  materialId: string | null; runId: string | null;
  uncertain?: { candidateId: string; reasoning: string };   // reconciliation said uncertain
  signals: ObjectiveSignal[] }                              // one per upload that covered it
interface ObjectiveSignal { materialId; materialType; places: { locator; excerpt }[];
  emphasis?: { kind: "tested" | "skipped"; quote: string }; tested: boolean }
interface Relation { id; from; to; type: "builds-on" | "implies" | "contrasts-with" | "applies-to";
  anchor: { locator; excerpt } | null; review: Review; materialId }
interface PipelineRun { id; materialId; at; model; counts: {...}; dropped: { questionId?; reason }[] }
```

Store: `relations[courseId]`, `runs[]`; `objectives[courseId]` gains the fields above.

## Tasks

### Task 1 — Course-structure model
Types above; store state and `orca:v7`; `addCourse` unchanged; `importExtraction` removed in
Task 3. `src/lib/course/resolve.ts`: `resolveObjective(id, catalogue)` follows `mergedInto`;
`activeObjectives`, `activeTopics`. `objectivesForTopic` resolves merges and skips archived
objectives' questions; `courseMastery` skips evidence on archived objectives; the trail hides
archived topics. Tests: merge chains, archived exclusion, a merged objective's answers counting
for the survivor. e2e fixture moves to v7 and the new fields.

### Task 2 — Weights and name matching
`src/lib/course/weights.ts` (decision 6) and `src/lib/course/match.ts`: `normaliseName`
(case, punctuation, "&"/"and", plural -s), `exactMatch(name, aliases, existing)` returning the
existing item including archived and merged ones (resolved to the survivor, or "archived"), and
`shortlist(candidate, existing, n = 8)` by token overlap for the reconcile call. Tests for each.

### Task 3 — Pipeline
`src/lib/pipeline/`: zod schemas and prompt builders per step; `extract` input carries the
course's existing topics and objectives (ids, names, aliases, descriptions, archived ones
labelled "rejected: never propose again") and the material type rules; output uses `existingId`
or a `localId`. `reconcile` returns `same | new | uncertain` with reasoning (the platform's
prompt, ported). `generate` writes questions per objective following `QUIZ_RUBRIC`, each tagged
with its objective. `validate` as decision 3, with `normaliseExact` for the code comparison.
`applyUpload(state, run)` is a pure function from step outputs to a store patch (new UUIDs,
statuses, aliases on merges, signals, relations, questions minus duplicates by `promptKey`).
`runPipeline(deps, input, onProgress)` orchestrates with injected step callers. Routes:
`/api/pipeline/[step]` (load the `claude-api` skill first) replacing `/api/extract`. Tests:
appliers and orchestration with fake step callers (merge by exact name, archived match dropped,
uncertain flagged, homework that creates nothing new, failed validation dropped and counted).

### Task 4 — Screens
Add-material shows step progress ("Reading… Mapping topics… Checking 3 possible duplicates…
Writing questions for 5 objectives… Checking 30 questions…") and ends on
`/course/[slug]/review?run=…`: new topics to confirm, rename or reject; uncertain matches with
the reasoning and "Same as X" / "Keep separate"; counts of questions kept and dropped.
`/course/[slug]/objectives`: every objective by topic with origin, review status, weight,
mastery state, and reject / restore / merge into… / confirm. Quiz shows "Unreviewed" on
questions whose objective is proposed. Course page links to both and shows "N to review".

### Task 5 — Homework reflection
On the course page, homework uploaded with "Reflect" shows a reflection card. The note goes to
`/api/pipeline/reflect`, which matches it to objectives (`sure | uncertain` each, with reasoning).
Sure matches are listed and uncertain ones are confirmed by the student; saving records one
confusion event per objective. Fold change in `objective-state.ts` under `MASTERY_RULES` with
tests in `tests/mastery/`.

### Task 6 — Evaluation, e2e, docs
`scripts/score-extraction.ts`: reads `docs/samples/ald/L01–L04` with pdf.js in Node, runs the
extract step in order (each upload sees the previous ones' structure), and scores objectives
against `benchmark/ald/objectives.json` (from `docs/OBJECTIVES-ALD.md`) by exact name or alias,
then the reconcile classifier; reports precision and recall per deck and overall, and fails only
on regression against `benchmark/ald/baseline.json`. Needs `ANTHROPIC_API_KEY`.
e2e: the upload flow end to end with `/api/pipeline/*` stubbed by `page.route` (a lecture creating
topics, a second deck merging a duplicate and flagging an uncertain one, review actions, the
objective list, the Unreviewed tag, a homework reflection resetting an objective). Docs:
`CLAUDE.md`, roadmap (decisions above, Phase 2 marked done), TO-DISCUSS (weights constants).

## Acceptance

- Uploading ALD L02 then L03 with a real key creates confirmed-after-review topics, objectives
  with signals, and validated questions; re-uploading L02 adds nothing new.
- A rejected objective is not re-proposed by a later upload.
- All checks and the e2e suite pass; the evaluation script runs and records a baseline (when a
  key is available).
