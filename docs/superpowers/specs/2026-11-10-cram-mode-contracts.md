# Cram mode: shared contracts (2026-11-10)

> **Status (2026-11-10, integration):** shipped on branch `cram-mode` (PR to `main` open, not merged).
> Foundation: migration `20261110130000_cram_mode.sql` (the `help` and `signal` column checks are named
> `evidence_events_help_values_check` / `evidence_events_signal_values_check`, since Postgres's default
> names collide with the table-level ones named below), pgTAP `19_cram_mode.test.sql`, the types
> (section 2), mastery rules v4 (section 3, `tests/mastery/cram-rules.test.ts`) and the connector's
> eleven tools (section 4). B1 hold-back vault, B2 `material_for` / `add_questions` / `add_material`,
> B3 evidence (`record_answer` with `help` and `corrected`, `check_answer` storing the report and
> returning `errorType`, `log_evidence`, the rubric grader's `errorType`) and B4 exam scope weights,
> the exam card and cram setup are all built. `INSTRUCTIONS` rewritten per section 4. Beyond this file:
> `examFocus` also lists a cramming exam's topics (cramming is the window); `add_questions` applies the
> pipeline's structural rules too (four options for multiple choice, an anchor for a material objective)
> and refuses a question anchored to a held-back material; `course_state.vault` lists every
> non-removed held-back material. Open product questions: `docs/TO-DISCUSS.md` (2026-11-10).

The owner's plan ("Orca Cram Mode Plan", 2026-11-09) and the decisions of 2026-11-10 (living doc
"Orca Cram Mode: how it works"). This file is the single source of truth for every surface more
than one workstream touches. Build exactly what it says; where it is silent, follow the nearest
existing pattern in the code and say so in your report. Change this file only in the foundation
step; later steps that need something it lacks report the gap instead of inventing a field.

## Decisions this encodes

- Cram mode is not a switch: an exam is **cramming** (a stored flag, set from the exam card or
  `set_exam`) or inside the 7-day window the agenda already uses (`AGENDA_RULES.examWindowDays`).
- **Claude writes and grades during a cram; Orca stores, counts and schedules.** Orca makes no
  model calls in a cram. Orca's own writer and grader stay as the fallback for the app.
- **Claude reports how much help it gave** on each answer (`help`): none = full credit and can
  verify; hint = half credit, rated Hard; shown = a miss, rated Again.
- **Past exams never leak**: a held-back material is mapped to objectives but never used to write
  questions, never returned by `material_for`, and never listed beyond its name.
- Every signal is an appended evidence event; mastery is recomputed from the log (rules v4).

## 1. Migration `supabase/migrations/20261110130000_cram_mode.sql` (foundation)

```sql
alter table public.materials add column held_back boolean not null default false;

alter table public.exams add column cramming boolean not null default false;
-- ExamScope (section 3); null = no scope beyond topic_ids.
alter table public.exams add column scope jsonb check (scope is null or jsonb_typeof(scope) = 'object');

alter table public.questions add column source text not null default 'orca' check (source in ('orca', 'claude'));

alter table public.evidence_events drop constraint evidence_events_kind_check;
alter table public.evidence_events add constraint evidence_events_kind_check check (kind in ('answer', 'confusion', 'work', 'signal'));
alter table public.evidence_events drop constraint evidence_events_grader_check;
alter table public.evidence_events add constraint evidence_events_grader_check check (grader in ('choice', 'exact', 'rubric', 'self', 'claude'));
-- flag_source gains 'connector-struggled' (a struggled flag from Claude; strength follows the source).
alter table public.evidence_events drop constraint evidence_events_flag_source_check;
alter table public.evidence_events add constraint evidence_events_flag_source_check check (flag_source in ('homework', 'handwritten-marker', 'connector', 'connector-struggled', 'slide', 'manual'));
alter table public.evidence_events
  add column help text check (help in ('none', 'hint', 'shown')),
  add column confidence smallint check (confidence between 1 and 3),
  add column error_type text check (error_type in ('arithmetic', 'units', 'sign', 'misread', 'notation', 'concept')),
  -- work: the problem as the student saw it, and how it was judged.
  add column problem text check (problem is null or length(problem) between 1 and 4000),
  add column basis text check (basis in ('official-solution', 'known-answer', 'claude')),
  -- signal: what the student did.
  add column signal text check (signal in ('got-it', 'lost', 'asked-answer', 'asked-harder'));
alter table public.evidence_events
  add constraint evidence_events_work_check check (kind <> 'work' or (question_id is null and problem is not null and basis is not null and outcome is not null and source = 'connector' and session_id is not null)),
  add constraint evidence_events_signal_check check (kind <> 'signal' or (question_id is null and signal is not null and source = 'connector' and session_id is not null)),
  add constraint evidence_events_help_check check (help is null or kind in ('answer', 'work'));
```

Find the real constraint names with `\d evidence_events` on the local stack before writing the
drops (Postgres named them; the names above are the default pattern). `record_evidence` inserts
through `jsonb_populate_record`, so new columns need no function change; the existing
`check (kind <> 'confusion' …)` stays; the flag-shape constraint from `20261105090000` must accept
`connector-struggled` wherever it accepts `connector`. Regenerate `src/lib/supabase/database.types.ts`
with `npm run locked -- npm run db:types` (never by hand). Add pgTAP `supabase/tests/19_cram_mode.test.sql`
covering: a `work` row, a `signal` row, `help` on an answer, a `connector-struggled` flag, the
`held_back` default, and that `my_data` returns `held_back`, `cramming`, `scope` and `source`.

## 2. Types (foundation)

`src/lib/data.ts`
- `Material` gains `heldBack: boolean` (always present; mapped from `held_back`).
- `Exam` gains `cramming: boolean` and `scope: ExamScope | null`.
- `QuizQuestion` gains `source?: "claude"` (absent = Orca's).
- New `ExamScope`:
  ```ts
  export type ScopeSignal = "practice-exam" | "professor" | "study-guide" | "homework" | "lecture-emphasis" | "guess";
  export interface ScopeEvidence { signal: ScopeSignal; strength: "strongest" | "strong" | "medium" | "light"; quote?: string; materialId?: string }
  export interface ExamScope {
    /** Per-objective weight inside the exam window; 0 = excluded. Objectives not listed weigh 1. */
    objectives: Array<{ objectiveId: string; weight: number; evidence: ScopeEvidence[] }>;
    format?: { minutes?: number; problems?: number; kinds?: Array<"Multiple choice" | "True or false" | "Short answer" | "Problem"> };
    /** Where the scope came from, for the card ("from the practice exam and your professor's words"). */
    sources: ScopeSignal[];
  }
  ```
  Strength is fixed per signal (`SCOPE_STRENGTH` in `src/lib/course/scope.ts`, pure): practice-exam
  strongest, professor strong, study-guide strong, homework medium, lecture-emphasis medium, guess light.

`src/lib/mastery/types.ts`
- `Grader` gains `"claude"` (Claude graded against the stored key; counts as graded, not self).
- `FlagSource` gains `"connector-struggled"`.
- `export type Help = "none" | "hint" | "shown"`; `export type ErrorType = "arithmetic" | "units" | "sign" | "misread" | "notation" | "concept"`.
- `AnswerEvent` gains `help?: Help`, `confidence?: 1 | 2 | 3`, `errorType?: ErrorType`.
- New `WorkEvent`: `{ kind: "work"; id; at; courseId; topicId; objectiveId; problem: string; response?: string; basis: "official-solution" | "known-answer" | "claude"; outcome: Outcome; source: "connector"; sessionId: string; help?: Help; confidence?: 1|2|3; errorType?: ErrorType }`.
- New `SignalEvent`: `{ kind: "signal"; id; at; courseId; topicId; objectiveId; signal: "got-it" | "lost" | "asked-answer" | "asked-harder"; note: string | null; source: "connector"; sessionId: string }`.
- `EvidenceEvent = AnswerEvent | ConfusionEvent | WorkEvent | SignalEvent`.

`src/lib/supabase/rows.ts` and `app-rows.ts`: map every new column both ways (`eventToRow`,
`eventFromRow`, `materialToRow/FromRow`, `examToRow/FromRow`, `questionToRow/FromRow`).

## 3. Mastery rules v4 (foundation; `src/lib/mastery/objective-state.ts`, `flags.ts`)

- `RULES_VERSION = 4`; record the new hash and golden accumulators in `tests/mastery/snapshot.test.ts`.
- `FLAG_STRENGTH["connector-struggled"] = "struggled"`; `connector` stays `check`.
- In `applyAnswer`: `assisted = grader === "self" || help === "hint"`; `help === "shown"` makes
  the event count as `incorrect` for credit, the miss run and FSRS (Again), whatever `outcome`
  says. `grader === "claude"` is unassisted (full credit, `verifiedUnaided`, `gradedCredit`) when
  `help` is `none` or absent. `gradeOf`: incorrect or shown → Again; partial, self or hint → Hard;
  else Good.
- New `applyWork`: folds like an answer with `questionId = event.id`; `basis` official-solution or
  known-answer → unassisted; `basis` claude → assisted (half credit, never verifies). `help` as above.
- New `applySignal`: `lost` → exactly what a struggled confusion does (in rotation, learning,
  Again); `got-it` → opens a check (`checkOpen = true`, like a check flag) when not in rotation and
  not mastered, else nothing; `asked-answer` and `asked-harder` → no state change (read by the
  plan and recap only). Signals never add credit.
- `stateAt`/`foldEvents` dispatch on `kind` for all four kinds. Unit tests in `tests/mastery/` for
  each rule above (one file, `cram-rules.test.ts`).

## 4. Connector tools (`src/lib/connector/mcp.ts`, version 0.4)

The foundation step adds every tool below to `TOOLS` with its input schema, the result interfaces,
the `ConnectorTools` methods, and `callTool` cases that validate inputs and call the method. Server
implementations live one per file under `src/lib/server/connector/` (foundation creates the folder
with a stub for each that throws `new Error("Not built yet")`); `src/lib/server/connector.ts` wires
each with one line. Rate limit: the existing `connector` entry.

| Tool | Input | Output |
| --- | --- | --- |
| `material_for` | `courseId`, `objectiveIds` (1–10) | `{ objectives: Array<{ objectiveId, pieces: Array<{ materialId, filename, page, text }> }>, heldBack: number }`. Pieces come from each objective's anchored pages (`pagesFor` in `src/lib/pipeline/topup.ts`, the same materials order), at most 6 per objective, each page's text cut at 2,500 characters, never from a held-back or removed material; `heldBack` counts the held-back materials skipped. No model calls. |
| `add_questions` | `courseId`, `questions` (1–10 of `{ objectiveId, kind, prompt, options?, answer?, exact?, rubric?, explanation, anchor? }`) | `{ added: Array<{ id, objectiveId }>, refused: Array<{ index, reason }> }`. Validated like generated questions (`GeneratedQuestion` in `src/lib/pipeline/schemas.ts`, `isExpressionAnswer`, the math render check, the sanitiser); stored with `source: "claude"`, `tier: null`, `materialId` from `anchor.materialId` when given and live. |
| `add_material` | `courseId`, `type`, `text?` (80–200,000 chars), `filename?`, `holdBack?` (default true for Past exam / Practice exam), `file?: true` | With `text`: the text route's result `{ material }` or `{ duplicate }`. With `file: true` and no text: `{ uploadLink }`, an absolute link (`SITE_URL`) to `/add-material?course=<slug>&type=<type>&holdBack=1` (the page reads those params). |
| `record_answer` | existing + `help` (default `"none"`), `confidence?`, `errorType?` | existing + `corrected?: true` when the stored key for a choice or exact question disagreed with `outcome` (Orca's result wins). Recorded with `grader: "claude"` (no longer `self`). |
| `check_answer` | existing + `confidence?`, `help?` | existing + `errorType: ErrorType \| null` (the rubric grader names one from the fixed list; choice and exact return null). |
| `flag_check` | existing + `strength?: "check" \| "struggled"` (default check) | existing; struggled writes `flag_source: "connector-struggled"`. |
| `log_evidence` | `courseId`, `objectiveId`, then either `{ kind: "work", problem, response?, basis, outcome, help?, confidence?, errorType? }` or `{ kind: "signal", signal, note? }` | `{ recorded: true, objectiveId, status }` |
| `set_exam` | existing + `cramming?: boolean`, `scope?: ExamScope` | `ExamLine` gains `cramming`, `scope`, `mode` |
| `course_state` | existing | gains `vault: Array<{ materialId, filename, type }>`, `mode: "normal" \| "exam-week" \| "day-of"`, `cramming: examId \| null`; `exams[]` carry `cramming`, `scope`. |

`mode`: `day-of` when an exam is today; `exam-week` when an exam is cramming or within 7 days;
else `normal`. `INSTRUCTIONS` are rewritten in the integration step (setup questions, check first,
`material_for` before teaching, Claude writes with `add_questions`, grades against the key and
reports `help`, asks confidence before revealing, never records an answer the student didn't give,
never opens vault items, sends progress lines unasked, follows `mode`).

## 5. Behaviour contracts for the feature steps

- **Hold-back (B1).** `startUpload`, the text route, the web route and the Canvas import take
  `heldBack` (default: `type` is Past exam or Practice exam). The upload pipeline still maps a
  held-back material (objectives, coverage, emphasis) but writes **no questions** from it
  (`runUpload`: no targets and no warm-up when `input.material.heldBack`). `sourceFor` in top-up
  and deep review skip held-back materials. Add material shows "Keep hidden for a practice test"
  (`data-part="hold-back"`), checked by default for those types. The upload card shows a
  "Held back" badge (`data-part="held-back"`). `course_state.vault` lists them.
- **Exam weights (B4).** Inside the window (cramming or ≤ 7 days), an objective's agenda weight
  is its course weight × its scope weight (1 when unlisted, 0 when excluded or weight 0), in
  `src/lib/course/weights.ts` (`examScopeWeights`, pure) applied wherever `courseObjectiveWeights`
  feeds the agenda and `next_questions`. The exam card (`data-part="exam-card"`) on the course page
  shows title, days left, scope size, verified share, and **Cram for this exam**
  (`data-part="cram-start"`), which opens setup: the professor's words (text), files (held back by
  default for exam types), worries (objective picker → `connector-struggled`-strength flags with
  `flag_source: "manual"`), then the proposed scope to confirm; sets `cramming`. While cramming:
  the plan line, Study with Claude (`/settings#connector` when no token, else a short note), Edit
  scope, Stop cramming (`data-part="cram-stop"`).
- **Evidence (B3).** `POST /api/evidence` keeps refusing server-written sources; `work` and
  `signal` are written only on the server (connector). The rubric grader's schema gains
  `errorType` (nullable, the fixed list) with one sentence in the prompt; `GradeResult.errorType`.
- Every e2e spec uses `data-part` names from this file. Don't rename existing ones.

## 6. Step 8 addendum (2026-11-10, after the first deploy): the cram page, the time budget and the plan

Decisions (owner): a cram has its own page; setup asks for the student's time budget; the plan is
derived, never stored; Claude's progress lines and `course_state` read the same calculation.

### Types (`src/lib/data.ts`, no migration: `exams.scope` is jsonb)

```ts
export interface CramBudget {
  /** Hours the student can put in before the exam, asked at setup (prefilled from the course's exam review duration). */
  hours: number;
  /** Days with no study, YYYY-MM-DD, in the student's timezone. */
  daysOut: string[];
  /** When cramming started, ISO: minutes studied since then count against the budget. */
  since: string;
}
// ExamScope gains: budget?: CramBudget
```

### The plan (`src/lib/mastery/cram-plan.ts`, pure, relative `.ts` imports, tests in `tests/mastery/cram-plan.test.ts`)

```ts
export interface CramPlanInput {
  today: string;            // YYYY-MM-DD, student's timezone
  examDate: string;         // YYYY-MM-DD
  budget: CramBudget;
  topics: Array<{ id: string; name: string; objectives: Array<{ id: string; name: string; weight: number; status: ObjectiveStatus }> }>;
  /** Minutes studied since budget.since: session_results seconds (any mode) + connector estimate (span of a day's connector events, capped at 120 min/day). */
  spentMinutes: number;
}
export interface CramPlan {
  daysLeft: number;                       // calendar days from today to the exam, exam day excluded; 0 on the day
  studyDays: string[];                    // days from today to the day before the exam, minus daysOut
  hoursLeft: number;                      // max(0, budget.hours - spentMinutes / 60)
  minutesPerDay: number;                  // hoursLeft * 60 / studyDays.length (0 when none)
  behindMinutes: number;                  // max(0, expected spent by today - spentMinutes); expected = budget.hours*60 * (elapsed study days / all study days)
  verified: { done: number; total: number; share: number };   // objectives verified or mastered over objectives in scope (weight > 0)
  topics: Array<{ id: string; name: string; weight: number; unverifiedShare: number; done: boolean; minutesToday: number; weakSpots: string[] /* objective ids in rotation or check-due */ }>;
  today: Array<{ topicId: string; minutes: number }>;   // topics with minutesToday > 0, largest first
  line: string;   // "9 days to the exam. Done: A, B. Today: C, D. Verified: 60%." (day of: "Exam day. Light review only, nothing new." ; behind: append " 20 minutes behind: D gets shortened.")
}
export function cramPlan(input: CramPlanInput): CramPlan;
```
Allocation: today's minutes split across topics with weight > 0 by `weight × unverifiedShare` (unverified = objectives
not verified/mastered; a topic with everything verified is `done` and gets 0); weak spots don't change the split
but list first in the page and in Claude's order. Round to 5 minutes; drop topics under 5. Deterministic: no clock
reads inside; `today` comes from the caller.

### Connector (`course_state`, version stays 0.4)

`course_state` gains `plan: CramPlan | null` (null when no exam is cramming) and `coverage: { verified, total, share, byTopic: Array<{ topicId, verified, total }> }` over the scoping exam's scope (the cramming exam, else the soonest within the window, else null), and `topErrors: Array<{ errorType: ErrorType; count: number }>` from the course's answer and work events since `budget.since` (or the last 30 days when not cramming), most frequent first, at most 6. `INSTRUCTIONS`: at the start of a session say `plan.line` as is; mention `topErrors` on the eve (`mode` day-of or `daysLeft` ≤ 1).

### The page (`src/app/course/[slug]/cram/page.tsx`)

`data-part="cram-page"`. Top: title, days left, the budget (`cram-budget`: hours left of hours, behind minutes when > 0), the plan line. Then the scope as topic rows (`cram-topic[data-topic]`): name, verified bar (verified/total), minutes today, the weak spots listed under it (objective names, status). Then today (`cram-today`), practice test status (`cram-mock`: "No practice test yet" until step 9), the vault files (`cram-vault`, by name), Study with Claude (the existing link rule), Edit scope, Stop cramming (`cram-stop`). Setup (`cram-setup`) lives on this page and replaces the card's modal: the professor's words, the Add material link (held back), worries picker, and **"How many hours can you put in before the exam?"** (`cram-hours`, number input prefilled from the course's `config.exam.duration` parsed to hours, 10 by default) with **days out** as checkboxes per remaining day (`cram-day-out[data-day]`). Confirm sets `cramming`, `scope.budget` (`since` = now) and opens the page's cramming view. The exam card (`src/components/course/ExamCard.tsx`): Cram for this exam links to the page's setup; while cramming it shows `plan.line` and links to the page. Spent minutes for the page come from the store (session results since `since`) plus the connector estimate from `GET /api/state`-style data if cheap; else session results only, labelled.

### Checks

Unit tests for `cramPlan` (days, days out, behind, allocation, done topics, the line's forms). e2e `e2e/cram-page.spec.ts`: seed a course with an exam 5 days out, open the page, set 6 hours with one day out, confirm, assert the budget, the topic rows, the line, Stop cramming; and `e2e/connector.spec.ts` extended: `course_state` carries `plan.line` and `coverage` while cramming.
