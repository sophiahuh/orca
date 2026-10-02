# Backend notes: what to reuse from the earlier prototype

Source: Amanda Chiang's `ai-native-learning-platform` (Next 16 + Supabase + OpenAI + Trigger.dev).
It has very little product UX but a deep backend. These notes distil what is worth porting into
Orca and how it maps onto `src/lib/data.ts`. File paths below are in that repo.

## Data model

Supabase migrations `supabase/migrations/0001`–`0016` (about 1,250 lines). Every table carries
`owner_id uuid references auth.users` so row-level security is `owner_id = auth.uid()` with no joins.
AI-pipeline writes use the service-role key.

| Orca type | Their table | Notes |
|---|---|---|
| `Course` | `courses` (id, owner_id, name, `island_shape_index`) | Add `slug, short, variant, pos_x, pos_y`. |
| `Topic` | `course_units` (coarse) + `course_concepts` (fine) | Orca topics ≈ units; concepts are the "lessons". done/current/locked is Orca's own idea; theirs is mastery per concept. |
| `DueItem` | none stored; computed on read | Keep it derived. Replace `when` with a computed `daysUntilDue`. |
| `Material` | `artifacts` (storage_path, filename, mime, size, status) | Add `type, assigned_date, due_date, reflect`. Bucket `course-artifacts`, path `${uid}/${uuid}/${safeName}`. |
| `CalendarEvent` | `exam_configs.exam_date` only | Add a `calendar_events` table for hw/lab/review. |
| `ReviewConfig` | not persisted (planned `review_preferences`) | Orca-only. |
| `Weights` | none (their "weights" are scheduler signal coefficients) | Orca-only, see scheduler below. |
| `QuizQuestion` | `question_bank` (`response_modality='multiple_choice'`, `rubric {options, correctOptionIndex}`, `source_anchors`, `hints[]`) | Add an `explanation` column. |

Concepts Orca should adopt:

- **Source anchors** `{artifactId, locator, excerpt}` on every concept, edge and question
  ("from slide 14"). Add as an optional field on `QuizQuestion` and `Topic` now.
- **Evidence events** (`evidence_events`, append-only: type, correctness, grader_confidence,
  assistance_level 0–6, difficulty, student_confidence). Learner state is *derived* from these,
  never written directly. `recordQuiz` should append events and derive topic status.
- **Concept edges** (`prerequisite_for, part_of, mechanism_for, contrasts_with, used_in,
  generalizes_to, example_of, other`) feed priority and could auto-order the trail.
- **Exam plans** with per-exam scope, mapping onto Orca's "exam" review tier.
- **proposed → confirmed** status for AI-extracted content; units are the review gate.

## Review scheduler (custom, not SM-2/FSRS)

Nothing is stored per item; everything is recomputed from the evidence log.

Mastery score (`learner-graph-evidence/compute-learner-state.ts`, params in `evidence-weights.ts`):

```
strength      = correct === false ? 0 : strengthByType[type]
                 exposure .1, retrieval .6, explanation .5, application .75, transfer .9,
                 relationship_explanation .5, misconception .2, annotation_confusion .1, instructor .5
decay         = 0.5 ^ (ageDays / 30)
independence  = assistanceLevel <= 1 ? 1 : 0.5
difficultyF   = 0.5 + 0.5 * clamp(difficulty, 0, 1)
value         = strength * decay * independence * graderConfidence * difficultyF
score         = Σ(value * decay) / Σ(decay)          // decay-weighted mean
tier          = score >= .7 solid | >= .4 weak | >= .15 exposed | unverified
misconception = ≥2 consecutive confident-wrong answers (studentConfidence ≥ .6) without a
                confident-correct reset; assisted answers are skipped
```

Caveat: a plain correct MCQ (retrieval, difficulty .5) scores 0.45, so MCQ-only practice plateaus at
"weak". Reaching "solid" needs application/transfer-type evidence or higher difficulty. Tune before
porting.

Next review date (`review-scheduler/next-review-date.ts`):

```
no evidence              → due now
unresolved misconception → last + 1 day
otherwise                → last + (3 + clamp(score) * 27) days      // 3..30
```

Priority (`review-priority.ts`), sorted descending:

```
forgetting = noEvidence ? 1 : min(1, ageDays / 14)
gap        = max(0, 1 - score)
priority   = forgetting*1 + importance*1 + gap*1 + min(1, prereqOutDegree/5)*0.5 + (misconception ? 1 : 0)*2
```

To make Orca's material-type sliders matter, scale `importance` (or add a term) by the normalised
weight of the material type the concept was extracted from. Concepts already carry
`sourceAnchors[].artifactId`; artifacts get a `type` column.

"Why is this due" copy worth reusing: "You haven't practiced this concept yet." / "It's been N days
since you last practiced this." / "You have an unresolved mix-up flagged here." / "Your evidence for
this concept is still thin." / "N other concepts build on this one." / "This concept is due for a
routine check-in."

Bucketing (`due-queue-bucketing.ts`) uses `ceil(hoursUntilDue / 24)`, which is not calendar-aligned.
For Orca's "Due today / Due tomorrow" compare local dates instead.

Sessions:

- **Quick review** (`daily-session.ts`): due concepts ranked by priority, drop ones with no question,
  `maxItems = max(1, floor(minutes / 2))`. Drive the budget from `ReviewConfig.quick.duration`.
  Skips stay due; the end dialog offers "Answer them / Finish anyway".
- **Deep review**: never built there.
- **Weekly "Connect"**: concepts created in the last 7 days plus weak edges touching them.
- **Exam tier** (`exam-planner/stage-boundaries.ts`): remaining days split diagnostic .30,
  interleaving .30, timed-mixed .25, final-weakness .15 (at least 1 day). Maps onto "10 hours,
  1 wk before exam".

## AI pipeline (OpenAI there; port to Claude)

Their schemas are hand-written JSON Schema with strict mode and hand-written parsers. With Claude,
each becomes a tool `input_schema` or structured output, validated with zod. PDFs go in as a
`document` content block instead of a file upload.

**Extraction prompt** (`course-graph-ingestion/openai-extraction-call.ts`), port nearly verbatim:
infer the subject from the artifact itself; only extract what is present; return empty arrays
rather than invent; every concept and edge needs at least one source anchor; use the relation
taxonomy and only `other` with a note; use short local ids like `c1`; confidence and importance are
honest 0–1 estimates. Output: `{units[], concepts[{localId, canonicalName, aliases, description,
importanceScore, sourceAnchors, confidence, unitRef}], edges[...]}`.

**Reconciliation** (`reconciliation.ts`): one call per new concept against existing ones, answer
exactly `merge | distinct | uncertain` ("never guess merge or distinct when you're not sure"),
reasoning stored verbatim. This is what stops duplicate topics when HW 3 is uploaded after Lecture 3.
Concepts auto-confirm unless `uncertain`; edges confirm when both endpoints are confirmed.

**Lightweight MCQ generator** (`lightweight-quiz/*`), the direct source for Orca's 5-question quizzes:
eligible concepts have `importanceScore ≥ 0.6`, max 15 per run, 1–3 questions per concept,
exactly 4 options with one correct, answerable in seconds, plausible distractors, never copy an
excerpt verbatim. Followed by an **ambiguity check** ("Is there more than one option a reasonable
student could defensibly pick, or is the stated correct option actually wrong?") that drops
ambiguous questions. For Orca: allow 2 options for True/False and add a required `explanation`
that cites the anchor.

**Full 6-layer validation** (`assessment-generation-pipeline/validation-pipeline.ts`) for longer
questions: schema → source alignment → independent solve → answer agreement → ambiguity →
similarity-to-source, up to 3 attempts, every attempt stored, nothing published unless it passes.

**Tutor chat** (`tutor-agent/*`): course-grounded system prompt (every claim must come from a
`search_course_materials` tool call, else say the material doesn't cover it) and a 6-step
assistance ladder (retrieve/predict → diagnostic question → cue → point to source → mechanism →
partial worked example → full answer; "just tell me" jumps to the end). Good cheap pedagogy layer
for `/api/chat`.

## Grading

Deterministic checkers are DSA-specific (BFS/DFS, heap, tree, topo sort, shortest path) plus an E2B
code sandbox: skip. The **rubric grader** prompt (`rubric-grader.ts`: grade only against the rubric's
`requiredIdeas / acceptableAlternatives / knownMisconceptions / partialCreditCriteria`, report honest
confidence, low-confidence < 0.6) is reusable for free-text answers. For ALD the matching
deterministic checker would be truth-table / boolean-expression equivalence.

## UX logic worth keeping

- **Island placement** (`courses/island-layout.ts`): 3 per row in creation order, each at its cell
  centre plus deterministic jitter (±22% of a cell from a string hash of `courseId:axis`), so islands
  never move. Use for default `pos` of new courses on the 854×834 canvas.
- **Island shape index** stored once at creation (append-only shape library), same as Orca's `variant`.
  Their rule: islands encode *which* course, never how well it is known.
- **Home rail**: due count shown only when the soonest item is due today or overdue; order scheduled
  by days, then failed, then quiet. End screen offers "Go to next task" from `next-due-course.ts`.
- **HW reflect**: the free-text reflection is a priority signal, never a mastery write. Matches Orca's toggle.
- **Upload**: sanitise filenames with `/[^a-zA-Z0-9._-]/g → "_"` ("#" once truncated a storage key);
  PDF/PNG/JPG/HEIC/WebP, 25 MB; status via Supabase realtime.
- Copy: "Welcome back.", "Keep going. Keep growing.", "{k} skipped — still due for next time",
  "Nothing due right now.", "No concepts yet. Upload course material and Orca will extract them."

## Auth and Supabase wiring

- Env: `NEXT_PUBLIC_SUPABASE_URL` (base URL, no `/rest/v1`), `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY` (server only).
- `src/middleware.ts`: standard `@supabase/ssr` cookie refresh that **skips entirely when env vars
  are missing**, so local dev keeps working. Next 16 calls this file `proxy.ts`; check the bundled docs.
- `src/lib/supabase/server.ts` / `client.ts`, `features/auth/actions.ts` (sign up / in / out server
  actions, generic "Invalid email or password."). Server actions return `{data} | {error}` and never
  accept `owner_id` from the client.
- Reuse migrations 0001, 0003, 0004, 0007/0015, 0008, 0016 with Orca's extra columns plus new
  `review_preferences` and `calendar_events` tables. Generate types with `supabase gen types`.

## Other time-savers

- `tests/unit/**` (~90 `node --test` files) are reusable specs for anything ported: scheduler,
  learner state, island layout, home summary, stage boundaries, MCQ schema.
- `scripts/score-extraction.ts` + `benchmark/dsa-course/` is a precision/recall eval harness for the
  extraction prompt with a recall baseline. Same pattern for an ALD corpus.
- `tests/fixtures/quick-review-demo.json` contains the same XOR truth-table question as Orca's seed.
- Perf: they query evidence per concept; fetch a course's events once and group in memory.

## Priorities

**Port now (pure TypeScript, works against the localStorage store):** scheduler math with
calendar-day bucketing and a material-weight term; a simplified `computeLearnerState` with
`recordQuiz` appending answer events; `composeDailySession` from `quick.duration`; skip-aware session
state; deterministic island layout for new courses; exam stages for the exam tier; `SourceAnchor`
and `explanation` on questions.

**When Supabase + Claude land:** migrations and RLS, proxy/auth, upload flow, extraction prompt as a
Claude tool with PDF document blocks, reconciliation + auto-confirm, MCQ generator + ambiguity
check, grounded tutor prompt + assistance ladder, then the 6-layer pipeline and rubric grader.

**Skip:** DSA checkers, E2B sandbox, visual assessment, Concept Atlas (React Flow + ELK),
Trigger.dev (use route handlers or Supabase functions), Spec Kit scaffolding, their placeholder
island shapes, hand-written database types.
