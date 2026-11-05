# Weak Points First, Plan A (the core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status (2026-11-05): built on `phase-4`** (commits 48e3d80 … the Task 8 commit), after two rounds
> of review by a second agent tracing scenarios through the code. The code is the reference where
> it differs from the task text below. What changed from the plan as written:
> - **Tasks 5 and 9 moved out** to a follow-up plan. An objective with no questions holds no state
>   (`objectivesForTopic` groups objectives by their questions), so writing questions only for
>   flagged objectives would make new objectives unflaggable, undivable and invisible to the
>   connector; and while uploads still write 2 per objective, a flag-triggered top-up is redundant
>   (the post-session top-up refills weak points). `requestQuestions` was dropped from Task 6.
>   The migration's `question_changed` now leaves a stale placeholder when an objective with
>   evidence but no snapshot gets its first question, so a reflection's flag on such an objective
>   is folded later.
> - **Fold** (still `RULES_VERSION` 2): a partly right answer on an unflagged objective whose
>   accumulator met the bar (or that completes it) makes its check due now; a check flag never
>   moves an overdue check later; `FLAG_STRENGTH` is part of the rules hash; a second golden log
>   (`FLAGS_LOG`, dated 2027 so moving `rotationSince` can't change it) covers the flag rules.
> - **Agenda:** `RankedObjective` carries `weight` and `reached`; `examTopics` (exams table, merges
>   followed through `survivingTopic`) puts that exam's objectives first; `examInWindow` lives in
>   `agenda.ts`. The quick-review card is skipped when it would cover 0 objectives.
> - **Progress:** `TopicProgress` is `{ status, mastered, inRotation, objectives }`; `done` needs no
>   open check; `not-started` covers verified-only topics. The course header reads "{held} of
>   {weak} weak spots mastered" / "No weak spots flagged yet".
> - **Practice** (`src/lib/mastery/practice.ts`): course-wide dives and practice leave out
>   unreached and weight-0 objectives; topic dives keep everything in the topic.
> - **UI:** "This is hard" shows "In review" for learning/mixed-up objectives (`canFlagHard`), is
>   absent for objectives without questions, and can flag a mastered weak point again; the topic
>   flag skips the same objectives and hides when none is left. `useCaughtUp` shows the caught-up
>   card only when the due list is empty and the course has objectives with questions. Review
>   phrases: "not flagged, so Orca won't schedule it", "answered right, so Orca won't schedule it".
> - **Known, left as is:** the calendar's quick-review count is the due list's size, not the
>   sidebar's "Covers N" (as before this plan); a verified objective's feedback banner shows credit
>   progress toward the bar.
> - **Before merging:** set `MASTERY_RULES.rotationSince` to the deploy day (earlier or later than
>   2026-11-10) and re-record `RULES_HASHES[2]`. Don't push `phase-4` before the browser specs seed
>   struggle flags (Task 8): CI runs them.
>
> Spec: `docs/superpowers/specs/2026-11-04-weak-points-first-design.md`. Plans B (passive flags:
> handwritten markers, the connector's `flag_check`) and C (tapped slides) aren't written yet.

**Goal:** Only objectives in rotation (struggled-flagged, missed or partly right, or mastered before
the change) come due; islands and topic rows count weak points mastered; students can flag an
objective or a topic as hard; with nothing due they can practise other topics as a dive.

**Architecture:** Struggle flags are the existing `confusion` evidence events with a source and an
optional page (one migration). The mastery fold gains two accumulator fields (`inRotation`,
`checkOpen`) and two statuses (`verified`, `check-due`), read by the unchanged agenda/session code
with new status lists. "Practice other topics" and "Practice exam topics" are dives scoped to
unflagged objectives, through the existing `/api/deep-review`. Limiting upload question writing to
flagged objectives comes last and is separable.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Supabase (Postgres + RLS, pgTAP), `node:test`
unit tests with Node type stripping, Playwright against the local stack and the fake model API.

## Global Constraints

- Node: `export PATH=$HOME/.nvm/versions/node/v24.20.0/bin:$PATH` before any `npm`/`npx`/`node` command.
- Pure modules (`src/lib/mastery`, `src/lib/course`, `src/lib/pipeline`, `src/lib/jobs`) load under plain Node: relative imports ending in `.ts`, `import type`, no TS parameter properties.
- Learner state is derived from evidence; never store a status, flag state or progress on a row (CLAUDE.md invariants; `.claude/skills/learner-evidence`).
- Every fold change bumps `RULES_VERSION` and records the new hash and golden accumulators in `tests/mastery/snapshot.test.ts`.
- No silent placeholders: an unknown value throws or shows an explicit empty/error state.
- No new dependencies.
- Colours are tokens from `src/app/globals.css`; animation presets come from `src/lib/motion.ts`; tests find elements by `data-part` / `data-visual` / `data-level`.
- Never touch the hosted projects (`.env` may point at production). Anything that resets or writes the local database, or binds ports 3100/3101, runs through the stack lock: `npm run locked -- <command>` (`test:db`, `test:e2e`, `db:types`, `check:*`).
- Migrations: block `20261105090000…`, numbered after the newest in `supabase/migrations/`.
- Commit as the machine's git user (never pass `-c user.name/user.email`). Commit messages one or two lines. Work lands on `phase-4`.
- Per commit (Fix mode checks): `npx tsc --noEmit`, `npx eslint <changed files>`, the unit test files named in the task. After adding a route: `npx next typegen` before `tsc`.
- Copy (verbatim from the spec): "Not flagged", "Verified ✓", "Check", "You're caught up", "Practice other topics", "Practice exam topics", "No weak spots flagged yet", "You've practised everything here", "Orca focuses on what you flag: star things in your notes, study with Claude, or tap the slides that were hard."

## File map

| File | Change |
|---|---|
| `supabase/migrations/20261105090000_struggle_flags.sql` | new: `flag_source`, `page`, relaxed confusion check, `security_events` kind `marker_notes` |
| `supabase/tests/17_struggle_flags.test.sql` | new pgTAP |
| `src/lib/mastery/types.ts` | `FlagSource`, `FlagStrength`, `ConfusionEvent` fields, two new statuses |
| `src/lib/mastery/flags.ts` | new: source → strength, browser sources, `isInRotation` |
| `src/lib/mastery/objective-state.ts` | `inRotation`, `checkOpen`, `rotationSince`, flag rules, `stateAt`, `RULES_VERSION = 2` |
| `src/lib/mastery/agenda.ts` | `DUE_TODAY`, manual flags past `upcoming`, dive candidates |
| `src/lib/mastery/session.ts` | `quickGroup` order for `check-due` |
| `src/lib/mastery/priority.ts` | reasons for the new statuses; only struggled flags open "confusion" |
| `src/lib/mastery/progress.ts` | topic progress and island level over objectives in rotation |
| `src/lib/mastery/percent.ts` | phrases for the new statuses |
| `src/lib/course/topic-graph.ts` | strength reads `verified` as evidence |
| `src/lib/supabase/rows.ts` | map the new columns |
| `src/app/api/evidence/route.ts` | accept slide/manual/homework flags |
| `src/lib/jobs/start.ts`, `src/app/api/top-up/route.ts` | top-up without a session for flagged objectives |
| `src/lib/store.tsx` | `flagObjectives`, `requestQuestions`, reflection source |
| `src/lib/server/connector.ts`, `src/lib/connector/mcp.ts` | due statuses, status list in the tool description |
| `src/components/review/parts.tsx`, `src/app/course/[slug]/objectives/page.tsx` | labels, "This is hard" |
| `src/components/quiz/DiveModal.tsx`, `src/app/course/[slug]/page.tsx` | "This topic is hard", Dive in button, copy |
| `src/components/path/KnowledgePath.tsx`, `src/components/ui/PathNode.tsx` | weak-spot line and ring |
| `src/components/map/KnowledgeMap.tsx` | "No weak spots flagged yet" |
| `src/components/layout/CaughtUp.tsx`, `src/components/layout/Sidebar.tsx`, `src/app/session/[slug]/page.tsx` | caught-up card, scoped practice dives |
| `src/components/quiz/QuizRunner.tsx` | post-session top-up only for objectives in rotation |
| `src/lib/pipeline/run.ts`, `src/lib/jobs/jobs.ts`, `src/lib/mastery/course-mastery.ts` | Task 9: upload writes questions only for objectives in rotation |
| `e2e/fixture.ts`, `e2e/weak-points.spec.ts`, other specs | flag helper, new spec, specs that assumed new objectives are due |
| Docs | `docs/MASTERY-PLAN.md` §2.3, `docs/BACKEND-ROADMAP.md`, `CLAUDE.md`, `docs/TO-DISCUSS.md`, the spec's status |

---

### Task 1: Struggle flags in the schema and the event type

**Files:**
- Create: `supabase/migrations/20261105090000_struggle_flags.sql`
- Create: `supabase/tests/17_struggle_flags.test.sql`
- Create: `src/lib/mastery/flags.ts`
- Modify: `src/lib/mastery/types.ts` (`ConfusionEvent`)
- Modify: `src/lib/supabase/rows.ts:17-45`
- Modify: `src/app/api/evidence/route.ts:34-45,84-92`
- Modify: `src/lib/store.tsx:181,709-713` (`recordReflection`)
- Modify: `src/lib/supabase/database.types.ts` (regenerated)
- Modify: every test helper that builds a `ConfusionEvent` (`tests/mastery/attribution.test.ts:37`, `tests/mastery/priority.test.ts:70`, `tests/mastery/snapshot.test.ts:42`, `tests/mastery/objective-state.test.ts` `confused`, `tests/mastery/snapshots.test.ts`, `tests/mastery/streak.test.ts`, `tests/supabase/rows.test.ts`; `npx tsc --noEmit` lists them all)
- Test: `tests/supabase/rows.test.ts`, `supabase/tests/17_struggle_flags.test.sql`

**Interfaces:**
- Produces (in `src/lib/mastery/types.ts`):
  ```ts
  export type FlagSource = "homework" | "handwritten-marker" | "connector" | "slide" | "manual";
  export type FlagStrength = "struggled" | "check";
  export interface ConfusionEvent {
    kind: "confusion"; id: string; at: string; courseId: string; topicId: string; objectiveId: string;
    materialId: string | null; note: string | null; flagSource: FlagSource; page: number | null;
  }
  ```
- Produces (in `src/lib/mastery/flags.ts`): `FLAG_STRENGTH`, `flagStrength(e: Pick<ConfusionEvent, "flagSource">): FlagStrength`, `BROWSER_FLAG_SOURCES`.

- [ ] **Step 1: Write the failing pgTAP test**

`supabase/tests/17_struggle_flags.test.sql`:

```sql
-- Weak points first (2026-11-05): confusion events are struggle flags with a source and an
-- optional page; old rows read as homework; answers carry neither.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

\set A aaaaaaaa-0000-4000-8000-000000000171
\set course c0000000-0000-4000-8000-000000000171
\set topic  e0000000-0000-4000-8000-000000000171
\set obj    f0000000-0000-4000-8000-000000000171
\set mat    d0000000-0000-4000-8000-000000000171

insert into auth.users (id, email) values (:'A', 'a17@example.com');
insert into public.courses (id, owner_id, slug, name, short, variant, pos_x, pos_y, review_config)
  values (:'course', :'A', 'ald', 'ALD', 'ALD', 'ald', 0, 0, '{}');
insert into public.topics (id, owner_id, course_id, name, review, sort_order, pos_x, pos_y) values (:'topic', :'A', :'course', 'Adders', 'confirmed', 0, 0, 0);
insert into public.objectives (id, owner_id, course_id, topic_id, name, description, origin, review)
  values (:'obj', :'A', :'course', :'topic', 'Explain carry-save', '', 'inferred', 'confirmed');
insert into public.materials (id, owner_id, course_id, filename, type, status) values (:'mat', :'A', :'course', 'w3.pdf', 'Lecture', 'ready');

select has_column('public', 'evidence_events', 'flag_source', 'flag_source exists');
select has_column('public', 'evidence_events', 'page', 'page exists');

select lives_ok(format($$insert into public.evidence_events (id, owner_id, kind, at, course_id, topic_id, objective_id, material_id, note, flag_source)
  values ('b1000000-0000-4000-8000-000000000171', %L, 'confusion', now(), %L, %L, %L, %L, 'lost on carries', 'homework')$$, :'A', :'course', :'topic', :'obj', :'mat'),
  'a homework flag with its material and note');
select lives_ok(format($$insert into public.evidence_events (id, owner_id, kind, at, course_id, topic_id, objective_id, flag_source)
  values ('b2000000-0000-4000-8000-000000000171', %L, 'confusion', now(), %L, %L, %L, 'manual')$$, :'A', :'course', :'topic', :'obj'),
  'a manual flag needs no material and no note');
select lives_ok(format($$insert into public.evidence_events (id, owner_id, kind, at, course_id, topic_id, objective_id, material_id, flag_source, page)
  values ('b3000000-0000-4000-8000-000000000171', %L, 'confusion', now(), %L, %L, %L, %L, 'slide', 4)$$, :'A', :'course', :'topic', :'obj', :'mat'),
  'a slide flag names its page');
select throws_ok(format($$insert into public.evidence_events (id, owner_id, kind, at, course_id, topic_id, objective_id, flag_source)
  values ('b4000000-0000-4000-8000-000000000171', %L, 'confusion', now(), %L, %L, %L, 'slide')$$, :'A', :'course', :'topic', :'obj'),
  '23514', null, 'a slide flag needs its material');
select throws_ok(format($$insert into public.evidence_events (id, owner_id, kind, at, course_id, topic_id, objective_id, material_id, note)
  values ('b5000000-0000-4000-8000-000000000171', %L, 'confusion', now(), %L, %L, %L, %L, 'x')$$, :'A', :'course', :'topic', :'obj', :'mat'),
  '23514', null, 'a confusion row needs its source');
select lives_ok(format($$insert into public.security_events (owner_id, kind, severity, pattern, excerpt) values (%L, 'marker_notes', 'weak', 'p', 'x')$$, :'A'),
  'security_events accepts marker_notes (reserved for Plan B)');

select * from finish();
rollback;
```

Before writing the last assertion, open `supabase/migrations/20261005210000_security.sql` and use its exact `security_events` column names in the insert (the ones above are what a security event needs: owner, kind, a rating, what matched and an excerpt; rename to match the table).

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run locked -- npm run test:db`
Expected: FAIL on `17_struggle_flags` (`flag_source` doesn't exist).

- [ ] **Step 3: Write the migration**

`supabase/migrations/20261105090000_struggle_flags.sql`:

```sql
-- Weak points first (docs/superpowers/specs/2026-11-04-weak-points-first-design.md): confusion
-- events become struggle flags. flag_source says where a flag came from (its strength follows
-- from it in code, src/lib/mastery/flags.ts); page is the page or slide in material_id it's about.
-- Existing confusion rows were all homework reflections: the new column is filled for them once
-- here (no existing value is rewritten). Answers carry neither column.

alter table public.evidence_events
  add column flag_source text check (flag_source in ('homework', 'handwritten-marker', 'connector', 'slide', 'manual')),
  add column page integer check (page is null or page >= 1);

update public.evidence_events set flag_source = 'homework' where kind = 'confusion';

-- The Phase 4 rule (material and note required on every confusion row) is replaced: manual and
-- connector flags have no material, slide and manual flags have no note.
do $$
declare
  c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.evidence_events'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) like '%confusion%' and pg_get_constraintdef(oid) like '%note IS NOT NULL%';
  if c is null then
    raise exception 'struggle_flags: the old confusion check constraint was not found';
  end if;
  execute format('alter table public.evidence_events drop constraint %I', c);
end $$;

alter table public.evidence_events add constraint evidence_events_flag_check check (
  kind <> 'confusion' or (
    question_id is null
    and flag_source is not null
    and (material_id is not null or flag_source in ('manual', 'connector'))
    and (page is null or material_id is not null)
  )
);
alter table public.evidence_events add constraint evidence_events_answer_no_flag check (
  kind <> 'answer' or (flag_source is null and page is null)
);

comment on column public.evidence_events.flag_source is 'Struggle flags (kind confusion): where the flag came from. connector = check me; every other source = struggled.';
comment on column public.evidence_events.page is 'Struggle flags: the page (a .pptx: the slide) in material_id the flag is about; null when not about a page.';

-- Reserved for Plan B (the marker description in Settings is screened like Notes for Orca).
alter table public.security_events drop constraint security_events_kind_check;
alter table public.security_events add constraint security_events_kind_check
  check (kind in ('upload', 'reflection_note', 'student_answer', 'generated', 'orca_notes', 'marker_notes'));
```

- [ ] **Step 4: Run the database tests and regenerate types**

Run: `npm run locked -- npm run test:db` → Expected: PASS (all files, 17 included).
Run: `npm run locked -- npm run db:types` → `src/lib/supabase/database.types.ts` gains `flag_source` and `page` on `evidence_events`.

- [ ] **Step 5: Write the failing unit test for the row mapping**

Add to `tests/supabase/rows.test.ts` (reuse the file's existing row builder if it has one; otherwise this standalone one):

```ts
import type { EvidenceRow } from "../../src/lib/supabase/rows.ts";
import { eventFromRow, eventToRow } from "../../src/lib/supabase/rows.ts";

const flagRow = (over: Partial<EvidenceRow> = {}): EvidenceRow => ({
  id: "f1", owner_id: "u", kind: "confusion", at: "2026-11-05T12:00:00Z", course_id: "c", topic_id: "t", objective_id: "o",
  question_id: null, tier: null, outcome: null, grader: null, source: null, session_id: null,
  material_id: null, note: null, flag_source: "manual", page: null, ...over,
});

test("a manual flag maps both ways with no material and no note", () => {
  const e = eventFromRow(flagRow());
  assert.deepEqual(e, { id: "f1", at: "2026-11-05T12:00:00.000Z", courseId: "c", topicId: "t", objectiveId: "o", kind: "confusion", materialId: null, note: null, flagSource: "manual", page: null });
  const back = eventToRow(e);
  assert.equal(back.flag_source, "manual");
  assert.equal(back.page, null);
});

test("a slide flag keeps its material and page", () => {
  const e = eventFromRow(flagRow({ flag_source: "slide", material_id: "m", page: 4 }));
  assert.equal(e.kind === "confusion" && e.page, 4);
  assert.equal(eventToRow(e).material_id, "m");
});

test("a confusion row without a source is refused, not guessed", () => {
  assert.throws(() => eventFromRow(flagRow({ flag_source: null })), /no flag source/);
});

test("an answer maps with no flag columns", () => {
  const row = eventToRow({ kind: "answer", id: "a", at: "2026-11-05T12:00:00.000Z", courseId: "c", topicId: "t", objectiveId: "o", questionId: "q", tier: null, outcome: "correct", grader: "choice", source: "quiz", sessionId: "s" });
  assert.equal(row.flag_source, null);
  assert.equal(row.page, null);
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `node --test --import ./tests/support/register.mjs tests/supabase/rows.test.ts`
Expected: FAIL (`flagSource` missing from the mapped event).

- [ ] **Step 7: Implement the types, `flags.ts` and the mapping**

`src/lib/mastery/types.ts`, replace the `ConfusionEvent` block:

```ts
/** Where a struggle flag came from (`evidence_events.flag_source`). */
export type FlagSource = "homework" | "handwritten-marker" | "connector" | "slide" | "manual";

/** struggled: back to learning and the full mastery bar. check: one question (src/lib/mastery/flags.ts). */
export type FlagStrength = "struggled" | "check";

/**
 * A struggle flag: the student (or Claude, through the connector) says they don't have an
 * objective. A struggled flag puts the objective in rotation, back to learning; a check flag asks
 * one question. Never credit ("I don't get it" is believed, "I get it" is not).
 */
export interface ConfusionEvent {
  kind: "confusion";
  id: string;
  /** ISO timestamp. */
  at: string;
  courseId: string;
  topicId: string;
  objectiveId: string;
  /** The upload it's about; null for manual and connector flags. */
  materialId: string | null;
  /** The student's own words (a reflection, a marked passage, what they said to Claude); null for slide and manual flags. */
  note: string | null;
  flagSource: FlagSource;
  /** The page in `materialId` (a .pptx: the slide); null when the flag isn't about a page. */
  page: number | null;
}
```

`src/lib/mastery/flags.ts` (new):

```ts
/** Struggle flags (docs/superpowers/specs/2026-11-04-weak-points-first-design.md). Pure. */
import type { ConfusionEvent, FlagSource, FlagStrength } from "./types.ts";

/** A flag's strength follows from its source: only Claude, through the connector, asks for a check. */
export const FLAG_STRENGTH: Readonly<Record<FlagSource, FlagStrength>> = {
  homework: "struggled",
  "handwritten-marker": "struggled",
  slide: "struggled",
  manual: "struggled",
  connector: "check",
};

export function flagStrength(e: Pick<ConfusionEvent, "flagSource">): FlagStrength {
  return FLAG_STRENGTH[e.flagSource];
}

/** The sources the browser may send through POST /api/evidence; the others are written on the server. */
export const BROWSER_FLAG_SOURCES = ["homework", "slide", "manual"] as const satisfies readonly FlagSource[];
```

`src/lib/supabase/rows.ts`, the confusion branch of `eventFromRow` and both branches of `eventToRow`:

```ts
  if (r.kind === "confusion") {
    if (r.flag_source === null) throw new Error(`Confusion event ${r.id} has no flag source`);
    // The table's CHECK constraint holds flag_source to FlagSource's values.
    return { ...base, kind: "confusion", materialId: r.material_id, note: r.note, flagSource: r.flag_source as FlagSource, page: r.page };
  }
```

```ts
  return e.kind === "answer"
    ? { ...common, question_id: e.questionId, tier: e.tier, outcome: e.outcome, grader: e.grader, source: e.source, session_id: e.sessionId, material_id: null, note: null, flag_source: null, page: null }
    : { ...common, question_id: null, tier: null, outcome: null, grader: null, source: null, session_id: null, material_id: e.materialId, note: e.note, flag_source: e.flagSource, page: e.page };
```

(add `FlagSource` to the `import type` from `../mastery/types.ts`).

- [ ] **Step 8: Accept browser flags in `POST /api/evidence`**

`src/app/api/evidence/route.ts`, replace the `Confusion` schema:

```ts
const Confusion = z
  .object({
    kind: z.literal("confusion"),
    id: uuid,
    courseId: uuid,
    objectiveId: uuid,
    // Server-written sources (markers, the connector) are refused here.
    flagSource: z.enum(BROWSER_FLAG_SOURCES).default("homework"),
    materialId: uuid.nullable().default(null),
    page: z.number().int().min(1).nullable().default(null),
    // Plan decision 10: reflection notes are capped at 2,000 characters.
    note: z.string().trim().min(1).max(2000).nullable().default(null),
  })
  .refine((b) => b.flagSource !== "homework" || (b.materialId !== null && b.note !== null), "A homework flag needs its upload and note.")
  .refine((b) => b.flagSource !== "slide" || (b.materialId !== null && b.page !== null), "A slide flag needs its upload and page.")
  .refine((b) => b.flagSource !== "manual" || (b.materialId === null && b.page === null), "A manual flag isn't about an upload.");
```

`z.discriminatedUnion` needs plain objects: change `const Body = z.discriminatedUnion("kind", [Answer, Confusion]);` to `const Body = z.union([Answer, Confusion]);`.

Replace the confusion branch of the handler so the material is looked up only when there is one:

```ts
    } else {
      const [objective, material] = await Promise.all([
        db.from("objectives").select("topic_id").eq("owner_id", student.id).eq("course_id", body.courseId).eq("id", body.objectiveId).maybeSingle(),
        body.materialId === null
          ? Promise.resolve({ data: null, error: null })
          : db.from("materials").select("id").eq("owner_id", student.id).eq("course_id", body.courseId).eq("id", body.materialId).maybeSingle(),
      ]);
      if (objective.error || material.error) throw new Error(`Couldn't read the objective or material: ${(objective.error ?? material.error)!.message}`);
      if (!objective.data) return reply(404, { error: "No such objective in this course." });
      if (body.materialId !== null && !material.data) return reply(404, { error: "No such upload in this course." });
      event = { kind: "confusion", id: body.id, at, courseId: body.courseId, topicId: objective.data.topic_id, objectiveId: body.objectiveId, materialId: body.materialId, note: body.note, flagSource: body.flagSource, page: body.page };
    }
```

Import `BROWSER_FLAG_SOURCES` from `@/lib/mastery/flags`. Update the doc comment's confusion line to: `A struggle flag: { kind: "confusion", id, courseId, objectiveId, flagSource: "homework" | "slide" | "manual", materialId?, page?, note? }.`

- [ ] **Step 9: Reflection rows carry their source**

`src/lib/store.tsx:181`: `recordReflection: (materialId: string, note: string, events: Array<Omit<ConfusionEvent, "id" | "at" | "kind" | "materialId" | "note" | "flagSource" | "page">>) => void;`

`src/lib/store.tsx:712`, build each event with the source and page:

```ts
      const confusion: ConfusionEvent[] = events.map((e) => ({ ...e, kind: "confusion", id: confusionEventId(materialId, e.objectiveId), at, materialId, note, flagSource: "homework", page: null }));
```

and send it: `postEvidence(c, { kind: "confusion", id: c.id, courseId: c.courseId, objectiveId: c.objectiveId, flagSource: "homework", materialId, note })`.

- [ ] **Step 10: Bring the test helpers along**

Run `npx tsc --noEmit`. For each test helper it lists that builds a `ConfusionEvent`, add `flagSource: "homework", page: null` (the values every existing confusion event had). No test's expectations change.

- [ ] **Step 11: Run the checks**

Run: `npx tsc --noEmit && npx eslint src/lib/mastery/types.ts src/lib/mastery/flags.ts src/lib/supabase/rows.ts src/app/api/evidence/route.ts src/lib/store.tsx && npm test`
Expected: PASS (the whole unit suite: helpers changed in many files).

- [ ] **Step 12: Commit**

```bash
git add supabase/migrations/20261105090000_struggle_flags.sql supabase/tests/17_struggle_flags.test.sql src/lib/mastery/types.ts src/lib/mastery/flags.ts src/lib/supabase/rows.ts src/lib/supabase/database.types.ts src/app/api/evidence/route.ts src/lib/store.tsx tests
git commit -m "Struggle flags: confusion events get a source and a page (migration 20261105090000); the evidence route takes homework, slide and manual flags"
```

---

### Task 2: The fold — rotation, check-me, two new statuses

**Files:**
- Modify: `src/lib/mastery/types.ts` (`ObjectiveStatus`)
- Modify: `src/lib/mastery/flags.ts` (`isInRotation`)
- Modify: `src/lib/mastery/objective-state.ts:12-44,156-200,212-280,286-340`
- Modify: `tests/mastery/objective-state.test.ts`, `tests/mastery/snapshot.test.ts`
- Modify (compile only): `src/components/review/parts.tsx:36` (`MASTERY_LABEL`), `src/lib/server/connector.ts:50` (`DUE_ORDER`)

**Interfaces:**
- Consumes: `ConfusionEvent`, `flagStrength` (Task 1).
- Produces:
  ```ts
  export type ObjectiveStatus = "unseen" | "verified" | "check-due" | "learning" | "mixed-up" | "mastered" | "fading" | "retired";
  // src/lib/mastery/flags.ts
  export function isInRotation(status: ObjectiveStatus): boolean;
  // objective-state.ts: ObjectiveAccumulator gains inRotation: boolean, checkOpen: boolean;
  // MASTERY_RULES gains rotationSince: string; RULES_VERSION = 2
  ```

- [ ] **Step 1: Write the failing tests**

Add to `tests/mastery/objective-state.test.ts` (it already has `ev`, `day`, `at`, `state`, `masteredOnDay2`; add a flag builder and a fold over mixed events next to the existing `confused` helper):

```ts
import type { ConfusionEvent, FlagSource } from "../../src/lib/mastery/types.ts";
import { replayObjective } from "../../src/lib/mastery/objective-state.ts";

const flag = (when: string, flagSource: FlagSource = "manual", objectiveId = "t/o"): ConfusionEvent => ({
  kind: "confusion", id: `f-${flagSource}-${when}`, at: when, courseId: "ald", topicId: "t", objectiveId,
  materialId: flagSource === "manual" || flagSource === "connector" ? null : "m", note: null, flagSource, page: null,
});
const foldAll = (events: Array<EvidenceEvent | ConfusionEvent>, now: Date) =>
  stateAt("t/o", replayObjective("t/o", events, opts()), now).status;

/* ── Weak points first: rotation ─────────────────────────────────── */

test("an objective answered fully right, never flagged, is verified and never due", () => {
  assert.equal(foldAll([ev("q1", day(20))], at(20)), "verified");
});

test("a wrong or partly right answer puts an objective in rotation", () => {
  assert.equal(foldAll([ev("q1", day(20), { outcome: "incorrect" })], at(20)), "learning");
  assert.equal(foldAll([ev("q1", day(20), { outcome: "partial" })], at(20)), "learning");
  assert.equal(foldAll([ev("q1", day(20), { outcome: "incorrect", grader: "self" })], at(20)), "learning", "Don't know counts");
});

test("a struggled flag on a never-answered objective is learning with no credit", () => {
  const s = stateAt("t/o", replayObjective("t/o", [flag(day(20))], opts()), at(20));
  assert.equal(s.status, "learning");
  assert.equal(s.credit, 0);
  assert.equal(s.lastEvidenceAt, day(20));
});

test("in rotation, the usual bar, spacing and fading apply", () => {
  const events = [flag(day(20)), ev("q1", day(21)), ev("q2", day(21)), ev("q3", day(22))];
  assert.equal(foldAll(events, at(22)), "mastered");
  const dueAt = stateAt("t/o", replayObjective("t/o", events, opts()), at(22)).dueAt!;
  assert.equal(foldAll(events, new Date(Date.parse(dueAt) + 1)), "fading");
});

test("a check flag asks once: a pass verifies, a miss puts it in rotation", () => {
  assert.equal(foldAll([flag(day(20), "connector")], at(20)), "check-due");
  assert.equal(foldAll([flag(day(20), "connector"), ev("q1", day(21))], at(21)), "verified");
  assert.equal(foldAll([flag(day(20), "connector"), ev("q1", day(21), { outcome: "incorrect" })], at(21)), "learning");
});

test("a second check flag while one is open changes nothing", () => {
  const one = replayObjective("t/o", [flag(day(20), "connector")], opts());
  const two = replayObjective("t/o", [flag(day(20), "connector"), flag(day(20, 13), "connector")], opts());
  assert.deepEqual({ ...two, lastAt: one.lastAt }, one);
});

test("a check flag on a mastered objective makes its spaced check due now", () => {
  const mastered = [flag(day(20)), ev("q1", day(21)), ev("q2", day(21)), ev("q3", day(22))];
  assert.equal(foldAll([...mastered, flag(day(23), "connector")], at(23)), "fading");
});

test("a check flag on an objective still being learned changes nothing", () => {
  const learning = [ev("q1", day(20), { outcome: "incorrect" })];
  assert.equal(foldAll([...learning, flag(day(21), "connector")], at(21)), "learning");
});

test("mastered before rotationSince stays in rotation; mastered after it with no miss is verified", () => {
  // masteredOnDay2 is in October 2026, before MASTERY_RULES.rotationSince.
  assert.equal(foldAll(masteredOnDay2(), at(2)), "mastered");
  const after = Date.parse(MASTERY_RULES.rotationSince);
  const d = (n: number) => new Date(after + n * 86_400_000).toISOString();
  assert.equal(foldAll([ev("q1", d(1)), ev("q2", d(1)), ev("q3", d(2))], new Date(after + 2.1 * 86_400_000)), "verified");
});

test("old homework confusion replays as a struggled flag", () => {
  const missedCheck = [...masteredOnDay2(), ev("q1", day(30), { outcome: "incorrect" })];
  assert.equal(foldAll([...missedCheck, flag(day(31), "homework")], at(31)), "learning");
});
```

Then change the two existing confusion tests whose expectations the design reverses (a struggled flag now acts on an objective with no answers):

- `"confusion un-retires and un-fades, and does nothing to an objective with no answers"` → rename to `"confusion un-retires and un-fades, and puts an unanswered objective in rotation"` and change its first assertion to `assert.equal(fold([confused(day(1))], at(1)).status, "learning");`.
- `"confusion is never credit: a confusion-only log stays unseen …"` → keep the assertion (it's about another objective); rename to `"confusion is never credit, and other objectives are untouched"`.

Also change `"no answers is unseen"`: still `unseen` (no change needed; it stays green).

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/mastery/objective-state.test.ts`
Expected: FAIL (`verified`, `check-due` never returned; `rotationSince` undefined).

- [ ] **Step 3: Implement the fold**

`src/lib/mastery/types.ts`:

```ts
/**
 * unseen / verified / check-due: not in rotation (never due, except check-due's one question).
 * The rest: in rotation (a struggled flag, a wrong or partly right answer, or mastered before
 * MASTERY_RULES.rotationSince), under the mastery bar and FSRS spacing.
 */
export type ObjectiveStatus = "unseen" | "verified" | "check-due" | "learning" | "mixed-up" | "mastered" | "fading" | "retired";
```

`src/lib/mastery/flags.ts`, append:

```ts
import type { ObjectiveStatus } from "./types.ts";

const OUT_OF_ROTATION: ReadonlySet<ObjectiveStatus> = new Set(["unseen", "verified", "check-due"]);

/** In rotation: struggled-flagged, missed or partly right, or mastered before the weak-points rules. */
export function isInRotation(status: ObjectiveStatus): boolean {
  return !OUT_OF_ROTATION.has(status);
}
```

(merge the `import type` lines.)

`src/lib/mastery/objective-state.ts`:

1. In `MASTERY_RULES`, after `deepReviewStretch`:

```ts
  /**
   * Weak points first: an objective that reached mastery on an answer before this time stays in
   * rotation, so nothing a student had already mastered drops off their island. The day the rules
   * shipped (move it, and record the new hash, if Plan A merges later).
   */
  rotationSince: "2026-11-10T00:00:00.000Z",
```

2. `export const RULES_VERSION = 2;`

3. In `ObjectiveAccumulator`, after `card`:

```ts
  /** In rotation: a struggled flag, a wrong or partly right answer, or mastered before rotationSince. Never cleared. */
  inRotation: boolean;
  /** A check flag on an objective not in rotation, until its next answer. */
  checkOpen: boolean;
```

and in `EMPTY_ACCUMULATOR`: `inRotation: false, checkOpen: false,`.

4. In `applyAnswer`, the `next` line becomes:

```ts
  const next: ObjectiveAccumulator = { ...acc, answered: acc.answered + 1, lastAt: e.at, card: stored, checkOpen: false };
  if (e.outcome !== "correct") next.inRotation = true;
```

and inside the mastery check:

```ts
    if (enoughCredit && next.creditDays.length >= R.requiredDays && lastTwoCorrect && !next.mixedUp) {
      next.mastered = true;
      next.checkDueAt = stored.due;
      if (t < Date.parse(R.rotationSince)) next.inRotation = true;
    }
```

5. Replace `applyConfusion`:

```ts
/**
 * A struggle flag. Struggled: back to learning and into rotation (credit, credit days, attempted
 * questions and the mastery check cleared; FSRS's memory estimate kept, since past answers still
 * happened), also on an objective never answered. Check: one question for an objective not in
 * rotation; on a mastered one its spaced check is due now; on one still being learned, nothing.
 */
export function applyConfusion(acc: ObjectiveAccumulator, e: ConfusionEvent): ObjectiveAccumulator {
  const t = timeOf(e);
  if (acc.lastAt !== null && t < Date.parse(acc.lastAt)) {
    throw new Error(`Evidence ${e.id} is older than the last event applied to objective ${e.objectiveId}; rebuild its state from the log`);
  }
  if (flagStrength(e) === "check") {
    if (!acc.inRotation) return { ...acc, lastAt: e.at, checkOpen: true };
    if (acc.mastered) return { ...acc, lastAt: e.at, checkDueAt: e.at, retired: false };
    return { ...acc, lastAt: e.at };
  }
  return {
    ...acc,
    lastAt: e.at,
    inRotation: true,
    checkOpen: false,
    attempted: [],
    credit: 0,
    gradedCredit: 0,
    creditDays: [],
    lastTwo: [],
    lastMissQuestion: null,
    mastered: false,
    checkDueAt: null,
    spacedChecks: 0,
    missPending: false,
    missSessionId: null,
    retired: false,
  };
}
```

(import `flagStrength` from `./flags.ts`.)

6. In `stateAt`, replace the status block:

```ts
  let status: ObjectiveStatus;
  if (!acc.inRotation) status = acc.checkOpen ? "check-due" : acc.answered === 0 ? "unseen" : "verified";
  else if (!acc.mastered) status = acc.mixedUp ? "mixed-up" : "learning";
  else if (acc.retired) status = "retired";
  else if (acc.missPending || (acc.checkDueAt !== null && now.getTime() >= Date.parse(acc.checkDueAt))) status = "fading";
  else status = "mastered";
```

7. Compile-only entries so `Record<ObjectiveStatus, …>` maps stay complete (Task 4 gives them their final meaning):
   - `src/components/review/parts.tsx` `MASTERY_LABEL`: `unseen: "Not flagged", verified: "Verified ✓", "check-due": "Check",` (replacing `unseen: "Not started"`).
   - `src/lib/server/connector.ts` `DUE_ORDER`: `{ fading: 0, "mixed-up": 1, learning: 2, "check-due": 3, unseen: 4, verified: 5, mastered: 6, retired: 7 }`.

- [ ] **Step 4: Record the new rules hash and golden accumulators**

Run: `node --test tests/mastery/snapshot.test.ts`
Expected: FAIL with "The mastery rules changed … (hash: <h>)" and "No golden accumulators for RULES_VERSION 2 … <json>".

In `tests/mastery/snapshot.test.ts`:
- Update the golden log's `confusion` helper to the Task 1 shape (`flagSource: "homework", page: null`) if Task 1 didn't already.
- Add `2: "<h>"` to `RULES_HASHES` (never edit line `1`).
- Check the printed replay by hand against the old v1 golden: it must be identical except `inRotation` and `checkOpen` (`beforeConfusion`: `inRotation: true` because the log starts with misses; `checkOpen: false`; `end`: `inRotation: true, checkOpen: false`). Then add it as `GOLDEN[2]`.

- [ ] **Step 5: Run the mastery tests**

Run: `node --test tests/mastery/*.test.ts`
Expected: PASS. Any other mastery test that expected `unseen` for an objective with only correct answers now sees `verified`: change those expectations to `verified` (that is the design), never the code.

- [ ] **Step 6: Typecheck, lint, commit**

Run: `npx tsc --noEmit && npx eslint src/lib/mastery src/components/review/parts.tsx src/lib/server/connector.ts`

```bash
git add src/lib/mastery tests/mastery src/components/review/parts.tsx src/lib/server/connector.ts
git commit -m "Mastery fold: rotation (struggled flag, miss or partial, mastered before rotationSince), check-me flags, verified and check-due statuses; RULES_VERSION 2"
```

---

### Task 3: What's due, session order, progress, islands, Atlas strength

**Files:**
- Modify: `src/lib/mastery/agenda.ts:21,147-153,196-202`
- Modify: `src/lib/mastery/session.ts:70-87`
- Modify: `src/lib/mastery/priority.ts:44-52,64-100`
- Modify: `src/lib/mastery/progress.ts`
- Modify: `src/lib/mastery/percent.ts:17,33`
- Modify: `src/lib/course/topic-graph.ts:20-26`
- Test: `tests/mastery/agenda.test.ts`, `tests/mastery/session.test.ts`, `tests/mastery/priority.test.ts`, `tests/mastery/progress.test.ts`, `tests/mastery/percent.test.ts`, `tests/course/topic-graph.test.ts`

**Interfaces:**
- Consumes: `ObjectiveStatus`, `isInRotation`, `flagStrength` (Tasks 1–2).
- Produces:
  ```ts
  // progress.ts
  export interface TopicProgress { status: TopicStatus; mastered: number; inRotation: number; objectives: number }
  // agenda.ts: CourseAgenda.deepReview.candidates counts objectives in rotation, not retired, reached
  ```

- [ ] **Step 1: Write the failing tests**

`tests/mastery/progress.test.ts`: replace the four topic/island tests with:

```ts
test("a topic's progress counts weak points: objectives in rotation mastered or retired, out of those in rotation", () => {
  assert.deepEqual(topicProgress(["a", "b", "c"], map(s("a", "mastered"), s("b", "learning"), s("c", "verified"))), { status: "in-progress", mastered: 1, inRotation: 2, objectives: 3 });
  assert.deepEqual(topicProgress(["a", "b"], map(s("a", "mastered"), s("b", "retired"))), { status: "done", mastered: 2, inRotation: 2, objectives: 2 });
  assert.equal(topicProgress(["a", "b"], map(s("a", "mastered"), s("b", "fading"))).status, "in-progress", "a fading objective drops out until answered");
});

test("a topic with nothing in rotation is never done", () => {
  assert.deepEqual(topicProgress(["a"], map(s("a", "verified"))), { status: "in-progress", mastered: 0, inRotation: 0, objectives: 1 });
  assert.equal(topicProgress(["a", "b"], map(s("a", "unseen"), s("b", "unseen"))).status, "not-started");
  assert.equal(topicProgress(["a"], map(s("a", "check-due"))).status, "in-progress");
  assert.deepEqual(topicProgress([], map()), { status: "not-started", mastered: 0, inRotation: 0, objectives: 0 });
});

test("a missing objective state throws", () => {
  assert.throws(() => topicProgress(["a"], map()), /No state computed for objective a/);
});

test("the island follows the share of weak points mastered", () => {
  assert.equal(islandLevel([]), "uncharted");
  assert.equal(islandLevel([s("a", "unseen"), s("b", "verified"), s("c", "check-due")]), "uncharted", "nothing in rotation");
  assert.equal(islandLevel([s("a", "learning"), s("b", "verified"), s("c", "unseen")]), "sprouting");
  assert.equal(islandLevel([s("a", "mastered"), s("b", "learning"), s("c", "learning"), s("d", "unseen")]), "sprouting");
  assert.equal(islandLevel([s("a", "mastered"), s("b", "learning"), s("x", "verified")]), "growing");
  assert.equal(islandLevel([s("a", "mastered"), s("b", "retired"), s("c", "fading"), s("x", "unseen")]), "thriving");
});
```

Keep any other tests in the file and adjust their expected objects to the new shape (`total` → `objectives`, add `inRotation`).

`tests/mastery/agenda.test.ts`: use the file's existing builders for `CourseMastery` and `AgendaInput` (it builds `mastery.objectives` from a status per objective and `mastery.events` from an event list). Add:

```ts
test("only objectives in rotation or with an open check come due; unseen and verified never do", () => {
  const a = agendaWith({ o1: "unseen", o2: "verified", o3: "learning", o4: "check-due", o5: "mixed-up", o6: "fading", o7: "mastered" });
  assert.deepEqual(new Set(a.dueToday.map((r) => r.objectiveId)), new Set(["o3", "o4", "o5", "o6"]));
});

test("nothing in rotation: nothing due, no quick review due, and the dive cadence doesn't mark a dive due", () => {
  const a = agendaWith({ o1: "unseen", o2: "verified" }, { firstAnswerDaysAgo: 30 });
  assert.equal(a.dueToday.length, 0);
  assert.equal(a.quickReviewDue, false);
  assert.equal(a.deepReview.candidates, 0);
  assert.equal(a.deepReview.due, false);
});

test("a manual flag makes an objective from material the class hasn't reached due anyway", () => {
  const flagged = agendaWith({ o1: "learning", o2: "learning" }, { upcoming: ["o1", "o2"], events: [manualFlag("o1")] });
  assert.deepEqual(flagged.dueToday.map((r) => r.objectiveId), ["o1"]);
});
```

If the file has no `agendaWith`-style helper, write one at the top of the new tests: build `CourseMastery` with `objectives` = a `Map` of `ObjectiveState` (as `s(...)` in `progress.test.ts`), `topicObjectives` = `new Map([["t", ids]])`, `events` = the given events (plus one correct answer `firstAnswerDaysAgo` days before `now` when given), weights all `1`, `config` = `DEFAULT_CONFIG` from `src/lib/data.ts`, `schedule` = `{ meetings: [], quickDays: [], deepDays: [] }` (check `NO_SCHEDULE` in `src/lib/store.tsx` for the exact shape and copy it), `results` = `[]`, `examDays` = `[]`, `upcoming` = `new Set(opts.upcoming ?? [])`. `manualFlag(id)` builds a `ConfusionEvent` with `flagSource: "manual"`, `materialId: null`, `note: null`, `page: null`.

`tests/mastery/session.test.ts`, using its existing candidate builder:

```ts
test("a quick review asks check-due objectives after learning and fading ones, one question each", () => {
  // Candidates: one learning objective with 3 unseen questions, one check-due with 3, a long budget.
  const plan = assembleQuickReview([candidate("learn", "learning", 3), candidate("check", "check-due", 3)], { ...ctx, budgetSeconds: 3600 });
  const order = plan.items.map((i) => i.objectiveId);
  assert.equal(order[0], "learn");
  assert.equal(order.filter((id) => id === "check").length, 1);
});
```

(`candidate(id, status, n)` is whatever the file uses to build a `SessionCandidate` with `n` questions; adapt the call to it.)

`tests/course/topic-graph.test.ts`:

```ts
test("verified objectives count as evidence: a topic of verified objectives is strong, not new", () => {
  assert.equal(topicStrength(["a", "b"], states({ a: "verified", b: "mastered" })), "strong");
  assert.equal(topicStrength(["a", "b"], states({ a: "verified", b: "unseen" })), "developing");
  assert.equal(topicStrength(["a"], states({ a: "check-due" })), "developing");
  assert.equal(topicStrength(["a"], states({ a: "unseen" })), "unverified");
});
```

(`states` = the file's helper that builds a `Map<string, ObjectiveState>` from statuses; add one like `progress.test.ts`'s `s`/`map` if it has none.)

`tests/mastery/priority.test.ts`:

```ts
test("only struggled flags open the confusion term; a check flag doesn't", () => {
  const check: ConfusionEvent = { ...confusion(day(1)), id: "chk", flagSource: "connector", materialId: null };
  assert.equal(openConfusion("o", [check]), null);
  assert.notEqual(openConfusion("o", [confusion(day(1))]), null);
});
```

`tests/mastery/percent.test.ts`:

```ts
test("not flagged and verified objectives say they wait for a flag or practice", () => {
  assert.equal(reviewPhrase(st("unseen"), now, utcDay), "not flagged: Orca leaves it alone");
  assert.equal(reviewPhrase(st("verified"), now, utcDay), "verified: Orca leaves it alone");
  assert.equal(reviewPhrase(st("check-due"), now, utcDay), "comes up once in your next quick review");
});
```

(`st`, `now`, `utcDay`: the file's helpers; add them as in `progress.test.ts` if missing.)

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/mastery/progress.test.ts tests/mastery/agenda.test.ts tests/mastery/session.test.ts tests/mastery/priority.test.ts tests/mastery/percent.test.ts tests/course/topic-graph.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/lib/mastery/progress.ts`, replace the topic part and `islandLevel`:

```ts
import { isInRotation } from "./flags.ts";

export interface TopicProgress {
  status: TopicStatus;
  /** Objectives in rotation that are mastered or retired. A fading one doesn't count. */
  mastered: number;
  /** Objectives in rotation (the topic's weak points). */
  inRotation: number;
  /** Every live objective in the topic. */
  objectives: number;
}

/** done: every weak point mastered (at least one). not-started: nothing answered or flagged. */
export function topicProgress(objectiveIds: readonly string[], states: ReadonlyMap<string, ObjectiveState>): TopicProgress {
  const list = objectiveIds.map((id) => {
    const s = states.get(id);
    if (!s) throw new Error(`No state computed for objective ${id}`);
    return s;
  });
  const rotating = list.filter((s) => isInRotation(s.status));
  const mastered = rotating.filter(held).length;
  const status: TopicStatus =
    rotating.length > 0 && mastered === rotating.length ? "done" : list.every((s) => s.status === "unseen") ? "not-started" : "in-progress";
  return { status, mastered, inRotation: rotating.length, objectives: list.length };
}

export function islandLevel(states: readonly ObjectiveState[]): IslandLevel {
  const rotating = states.filter((s) => isInRotation(s.status));
  if (rotating.length === 0) return "uncharted";
  const share = rotating.filter(held).length / rotating.length;
  if (share >= ISLAND_THRESHOLDS.thriving) return "thriving";
  if (share >= ISLAND_THRESHOLDS.growing) return "growing";
  return "sprouting";
}
```

Update the file's header comment: "Topic progress and island level, computed from objective states: the share of weak points (objectives in rotation) mastered."

`src/lib/mastery/agenda.ts`:

```ts
/** Statuses that put an objective on today's list (when its weight isn't 0): weak points and open checks. */
const DUE_TODAY: readonly ObjectiveStatus[] = ["mixed-up", "learning", "fading", "check-due"];
```

Replace `const reached = …` with:

```ts
  // A manual flag is the student asking for it: due even before the class reaches its material.
  const manual = new Set(mastery.events.filter((e) => e.kind === "confusion" && e.flagSource === "manual").map((e) => e.objectiveId));
  const reached = (r: RankedObjective) => !input.upcoming?.has(r.objectiveId) || manual.has(r.objectiveId);
```

Replace the `candidates` line:

```ts
  // The dive cadence only marks a dive due when there are weak points to dive into (the student can always start one).
  const candidates = ranked.filter((r) => isInRotation(r.status) && r.status !== "retired" && reached(r)).length;
```

Update `DeepReviewDue.candidates`'s doc comment to "Objectives in rotation that aren't retired (the dive cadence counts only these)." and `CourseAgenda.dueToday`'s to "Weak points (mixed-up, learning, fading) and open checks with weight > 0, not practiced today, highest priority first." Import `isInRotation` from `./flags.ts`.

`src/lib/mastery/session.ts`:

```ts
/** Quick-review order (§3): mixed-up → fading, overdue before today → learning → fading due today → check-due. Priority order inside each group. */
function quickGroup(c: SessionCandidate, today: string, dayKey: (iso: string) => string): number {
  switch (c.status) {
    case "mixed-up":
      return 0;
    case "fading":
      return c.dueAt !== null && dayKey(c.dueAt) < today ? 1 : 3;
    case "learning":
      return 2;
    case "check-due":
      return 4;
    default:
      return 5;
  }
}
```

`needsMore` stays as it is (it leaves `check-due` out, so a check gets one question).

`src/lib/mastery/priority.ts`:
- In `openConfusion`, only struggled flags count: `.filter((e) => e.kind === "confusion" && e.objectiveId === objectiveId && flagStrength(e) === "struggled")` (import `flagStrength` from `./flags.ts`).
- In `objectivePriority`, after the `unseen` branch:

```ts
  } else if (state.status === "check-due") {
    terms.push({ term: "overdue", value: R.overdue, reason: "Flagged for a quick check" });
  }
```

  (insert as an `else if` before the `fading` branch), and leave `unseen` as it is (it ranks practice dives; `verified` gets only the importance term).

`src/lib/mastery/percent.ts` `reviewPhrase`, first lines:

```ts
  if (!state || state.status === "unseen") return "not flagged: Orca leaves it alone";
  if (state.status === "verified") return "verified: Orca leaves it alone";
  if (state.status === "check-due") return "comes up once in your next quick review";
```

`src/lib/course/topic-graph.ts` `topicStrength`:

```ts
export function topicStrength(objectiveIds: readonly string[], states: ReadonlyMap<string, ObjectiveState>): TopicStrength {
  const seen = objectiveIds.map((id) => states.get(id)).filter((s): s is ObjectiveState => !!s && s.status !== "unseen");
  if (seen.length === 0) return "unverified";
  if (seen.some((s) => s.status === "fading" || s.status === "mixed-up")) return "fragile";
  // Verified objectives count as evidence: answered right without being a weak point.
  if (seen.length === objectiveIds.length && seen.every((s) => s.status === "mastered" || s.status === "retired" || s.status === "verified")) return "strong";
  return "developing";
}
```

- [ ] **Step 4: Run the tests**

Run the Step 2 command. Expected: PASS. Then `node --test tests/mastery/*.test.ts tests/course/*.test.ts` and fix expectations (not code) where an old test assumed `unseen` objectives are due or count toward an island (that's the design change).

- [ ] **Step 5: Typecheck and fix callers of `TopicProgress.total`**

Run: `npx tsc --noEmit`. The only app caller is `src/components/path/KnowledgePath.tsx` (`p.total`): Task 4 rewrites it; for now replace `p.total` with `p.objectives` so it compiles.

- [ ] **Step 6: Lint and commit**

Run: `npx eslint src/lib/mastery src/lib/course/topic-graph.ts src/components/path/KnowledgePath.tsx`

```bash
git add src/lib/mastery src/lib/course/topic-graph.ts src/components/path/KnowledgePath.tsx tests/mastery tests/course
git commit -m "Due list, quick-review order, topic progress and islands follow weak points: only objectives in rotation or with an open check come due; islands count weak points mastered"
```

---

### Task 4: Screens follow the new statuses (trail, map, course page, connector, post-session top-up)

**Files:**
- Modify: `src/components/path/KnowledgePath.tsx:22-28,113-123`
- Modify: `src/components/ui/PathNode.tsx`
- Modify: `src/components/map/KnowledgeMap.tsx:120-124`
- Modify: `src/app/course/[slug]/page.tsx:126-140` (Dive in button)
- Modify: `src/lib/server/connector.ts:50-51`, `src/lib/connector/mcp.ts:109-120` (description)
- Modify: `src/components/quiz/QuizRunner.tsx:159-172`
- Test: `e2e/mastery-core.spec.ts` (run only; update in Task 8)

**Interfaces:**
- Consumes: `TopicProgress { mastered, inRotation, objectives }`, `isInRotation`, `CourseMastery.island` (Task 3).
- Produces: `PathNode` prop `ring?: { mastered: number; of: number }`; `data-part="topic-ring"`, `data-part="island-note"`.

- [ ] **Step 1: Trail line and ring**

`src/components/path/KnowledgePath.tsx`, replace `statusLine`:

```ts
function statusLine(p: TopicProgress, needing: number) {
  if (p.objectives === 0) return "No questions yet";
  const gap = needing > 0 ? ` · ${needing} without questions` : "";
  if (p.inRotation === 0) return `No weak spots flagged${gap}`;
  if (p.status === "done") return `Weak spots mastered${gap}`;
  return `${p.mastered} of ${p.inRotation} mastered${gap}`;
}
```

and pass the ring to each node: `ring={progressOf(t).inRotation > 0 ? { mastered: progressOf(t).mastered, of: progressOf(t).inRotation } : undefined}`.

`src/components/ui/PathNode.tsx`: add `ring?: { mastered: number; of: number }` to `PathNodeProps`, destructure it, and draw it inside the outer `div`, before the button:

```tsx
      {ring && ring.of > 0 && (
        <svg
          data-part="topic-ring"
          data-mastered={ring.mastered}
          data-of={ring.of}
          aria-hidden
          className="pointer-events-none absolute"
          width={size + 16}
          height={size + 16}
          style={{ left: -(size + 16) / 2, top: -(size + 16) / 2 }}
        >
          <circle cx={(size + 16) / 2} cy={(size + 16) / 2} r={size / 2 + 5} fill="none" stroke="var(--color-alice-deep)" strokeWidth={4} />
          <circle
            cx={(size + 16) / 2}
            cy={(size + 16) / 2}
            r={size / 2 + 5}
            fill="none"
            stroke="var(--color-wisteria-deep)"
            strokeWidth={4}
            strokeLinecap="round"
            strokeDasharray={`${(2 * Math.PI * (size / 2 + 5) * ring.mastered) / ring.of} ${2 * Math.PI * (size / 2 + 5)}`}
            transform={`rotate(-90 ${(size + 16) / 2} ${(size + 16) / 2})`}
          />
        </svg>
      )}
```

The full ring with the existing `done` visual (green with ✓) is the "everything mastered" state; nothing else changes in `PathNode`.

- [ ] **Step 2: Map caption**

`src/components/map/KnowledgeMap.tsx`, below the `LabelPill` (inside the same positioned `div`):

```tsx
                {levelOf(c.id) === "uncharted" && (mastery[c.id]?.objectives.size ?? 0) > 0 && (
                  <p data-part="island-note" className="mt-[6px] whitespace-nowrap text-center text-[13px] font-semibold text-wisteria-deep">
                    No weak spots flagged yet
                  </p>
                )}
```

- [ ] **Step 3: The course page's Dive in button no longer hides when nothing is in rotation**

`src/app/course/[slug]/page.tsx`: change `{agenda.deepReview.candidates > 0 && (` to `{agenda.ranked.length > 0 && (` (a dive can always be started; `deepReview.due` still adds " · due").

- [ ] **Step 4: The connector's due statuses**

`src/lib/server/connector.ts`:

```ts
const DUE_STATUSES: ReadonlySet<ObjectiveStatus> = new Set(["fading", "mixed-up", "learning", "check-due"]);
```

and make manual flags count past `upcoming` the way the agenda does: add to the `Promise.all` in `courseState`

```ts
      db.from("evidence_events").select("objective_id").eq("owner_id", ownerId).eq("course_id", courseId).eq("kind", "confusion").eq("flag_source", "manual"),
```

(destructure it as `manualFlags`, add it to the error loop), then:

```ts
    const manual = new Set((manualFlags.data ?? []).map((f) => f.objective_id));
```

and `upcoming: o.material_id !== null && upcoming.has(o.material_id) && !manual.has(o.id),`.

`src/lib/connector/mcp.ts`, the `course_state` description's status list becomes: `"(unseen = not flagged, verified, check-due, learning, mixed-up, mastered, fading, retired)"`, and add the sentence: `"Orca only schedules weak points: objectives the student struggled with, missed or asked to be checked on."`

- [ ] **Step 5: After a session, top up only weak points**

`src/components/quiz/QuizRunner.tsx`, the top-up effect's filter:

```ts
      return o && status !== undefined && isInRotation(status) && status !== "mastered" && status !== "retired" ? [o.id] : [];
```

(import `isInRotation` from `@/lib/mastery/flags`; a pass in optional practice never adds future work, spec decision 5.)

- [ ] **Step 6: Check by hand**

Run: `npx tsc --noEmit && npx eslint src/components/path/KnowledgePath.tsx src/components/ui/PathNode.tsx src/components/map/KnowledgeMap.tsx "src/app/course/[slug]/page.tsx" src/lib/server/connector.ts src/lib/connector/mcp.ts src/components/quiz/QuizRunner.tsx`
Run: `node --test --import ./tests/support/register.mjs tests/connector/mcp.test.ts`
Then one browser spec against the local stack: `npm run locked -- npx playwright test e2e/mastery-core.spec.ts`. Failures that only reflect the new copy or that new objectives are no longer due are fixed in Task 8; anything else is a bug here.

- [ ] **Step 7: Commit**

```bash
git add src/components src/app/course src/lib/server/connector.ts src/lib/connector/mcp.ts
git commit -m "Trail rows and rings count weak points; map says when nothing is flagged; connector schedules weak points; post-session top-ups only for them"
```

---

### Task 5: Top-ups for flagged objectives without a session

**Files:**
- Modify: `src/lib/jobs/start.ts:98,327-338`
- Modify: `src/app/api/top-up/route.ts`
- Test: `tests/jobs/start.test.ts`

**Interfaces:**
- Produces: `startTopUpJob(deps, ownerId, req: { courseId: string; sessionId?: string; objectiveIds: string[] })`; `TopUpStart` gains `{ state: "no-flag" }`. `POST /api/top-up` body `sessionId` optional.

- [ ] **Step 1: Write the failing tests**

In `tests/jobs/start.test.ts` (it has `fakeDb`, `deps`, `OWNER`, `session`):

```ts
test("a top-up without a session needs every objective to have a struggle flag", async () => {
  const flag = { id: "f1", owner_id: OWNER, course_id: "c1", objective_id: "o1", kind: "confusion" };
  const f = fakeDb({ evidence_events: [flag], pipeline_runs: [] });
  const { deps: d } = deps(f.db, "claude-opus-5-5");
  assert.deepEqual(await startTopUpJob(d, OWNER, { courseId: "c1", objectiveIds: ["o1", "o2"] }), { state: "no-flag" });
  assert.equal(f.tables.pipeline_runs.length, 0);
  assert.deepEqual(await startTopUpJob(d, OWNER, { courseId: "c1", objectiveIds: ["o1"] }), { state: "started", runId: "run-new" });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/jobs/start.test.ts`
Expected: FAIL (a missing session id returns `no-session`).

- [ ] **Step 3: Implement**

`src/lib/jobs/start.ts`:

```ts
export type TopUpStart = { state: "started"; runId: string } | { state: "queued"; runId: string } | { state: "busy" } | { state: "no-model" } | { state: "no-session" } | { state: "no-flag" };
```

Replace the session check at the top of `startTopUpJob`:

```ts
export async function startTopUpJob(deps: StartDeps, ownerId: string, req: { courseId: string; sessionId?: string; objectiveIds: string[] }): Promise<TopUpStart> {
  const { db, model } = deps;
  if (!model) return { state: "no-model" };
  if (req.sessionId !== undefined) {
    const { data: session, error } = await db.from("session_results").select("id").eq("owner_id", ownerId).eq("course_id", req.courseId).eq("session_id", req.sessionId).limit(1);
    if (error) throw new Error(`Couldn't read the session: ${error.message}`);
    if (!session.length) return { state: "no-session" };
  } else {
    // A flag the student just added (a manual flag, a reflection): each objective must carry one.
    const { data: flags, error } = await db.from("evidence_events").select("objective_id").eq("owner_id", ownerId).eq("course_id", req.courseId).eq("kind", "confusion").in("objective_id", req.objectiveIds);
    if (error) throw new Error(`Couldn't read the flags: ${error.message}`);
    const flagged = new Set((flags ?? []).map((f) => f.objective_id as string));
    if (req.objectiveIds.length === 0 || req.objectiveIds.some((id) => !flagged.has(id))) return { state: "no-flag" };
  }
  // …the rest of the function unchanged…
```

(If `fakeDb`'s `.in` filter isn't there, it is: its header lists `in`.)

`src/app/api/top-up/route.ts`:

```ts
const Body = z.object({ courseId: z.uuid(), sessionId: z.string().min(1).max(100).optional(), objectiveIds: z.array(z.uuid()).max(200) });
```

```ts
    if (out.state === "no-session") return reply(404, { error: "No such finished session." });
    if (out.state === "no-flag") return reply(404, { error: "Those objectives aren't flagged." });
```

Doc comment: `POST { courseId, sessionId?, objectiveIds } → top up the question stock after a finished session, or for objectives the student just flagged (no session; every objective must carry a struggle flag).`

- [ ] **Step 4: Run, check, commit**

Run: `node --test tests/jobs/start.test.ts && npx tsc --noEmit && npx eslint src/lib/jobs/start.ts src/app/api/top-up/route.ts`
Expected: PASS.

```bash
git add src/lib/jobs/start.ts src/app/api/top-up/route.ts tests/jobs/start.test.ts
git commit -m "Top-up without a session for objectives that carry a struggle flag (POST /api/top-up sessionId optional)"
```

---

### Task 6: "This is hard": manual flags on an objective or a topic

**Files:**
- Modify: `src/lib/store.tsx` (actions `flagObjectives`, `requestQuestions`; reflection asks for questions)
- Modify: `src/app/course/[slug]/objectives/page.tsx:94-150`
- Modify: `src/components/quiz/DiveModal.tsx` (a second action), `src/app/course/[slug]/page.tsx` (wires it)
- Create: `e2e/weak-points.spec.ts`
- Modify: `e2e/fixture.ts` (a `flagged` helper)

**Interfaces:**
- Consumes: `POST /api/evidence` flag bodies (Task 1), `POST /api/top-up` without session (Task 5), `isInRotation` (Task 2).
- Produces (on `useOrca()`):
  ```ts
  /** One struggled flag from `manual` per objective (random ids). */
  flagObjectives: (courseId: string, objectiveIds: readonly string[]) => void;
  /** Ask the server to write questions for flagged objectives short of them; the problem, or null. */
  requestQuestions: (courseId: string, objectiveIds: readonly string[]) => Promise<string | null>;
  ```
- Produces (e2e): `export function struggled(courseId: string, topicId: string, objectiveId: string, at: string): ConfusionEvent` in `e2e/fixture.ts`.

- [ ] **Step 1: The e2e helper and the failing browser test**

`e2e/fixture.ts`, next to `daysAgo`:

```ts
/** A manual struggle flag, for seeding an objective into rotation (weak points first: unflagged objectives are never due). */
export function struggled(courseId: string, topicId: string, objectiveId: string, at: string): ConfusionEvent {
  return { kind: "confusion", id: crypto.randomUUID(), at, courseId, topicId, objectiveId, materialId: null, note: null, flagSource: "manual", page: null };
}
```

(import `ConfusionEvent` as a type from `../src/lib/mastery/types`.)

`e2e/weak-points.spec.ts` — seed the fixture course (`seedFixtureCourse`), then:

```ts
import { COURSE_SLUG, expect, test, seedFixtureCourse, stored } from "./fixture";

test("nothing flagged: no quick review is due and the island says so", async ({ page, student }) => {
  await seedFixtureCourse(student);
  await page.goto("/");
  await expect(page.locator('[data-part="island-note"]')).toHaveText("No weak spots flagged yet");
  await expect(page.getByText("Quick review ·")).toHaveCount(0);
});

test("This is hard on an objective makes it due, and its topic shows a ring", async ({ page, student }) => {
  await seedFixtureCourse(student);
  await page.goto(`/course/${COURSE_SLUG}/objectives`);
  await page.locator('[data-part="flag-hard"]').first().click();
  await expect(page.locator('[data-part="flag-hard"]').first()).toHaveText("Flagged");
  await page.goto(`/course/${COURSE_SLUG}`);
  await expect(page.locator('[data-part="topic-ring"]')).toHaveCount(1);
  await expect(page.getByText("Quick review ·")).toBeVisible();
  const after = await stored(page, student);
  expect(after.evidence.filter((e) => e.kind === "confusion" && e.flagSource === "manual")).toHaveLength(1);
});
```

The fixture course (`seedFixtureCourse`, `COURSE_SLUG`) seeds no evidence, so nothing is in rotation at the start. Check the property name `stored()` returns for evidence (`e2e/fixture.ts:100`, `LoadedState`) and adjust `after.evidence` to it.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run locked -- npx playwright test e2e/weak-points.spec.ts`
Expected: the first test may pass after Tasks 3–4; the second FAILS (no `flag-hard`).

- [ ] **Step 3: Store actions**

`src/lib/store.tsx`, add to `OrcaActions` (next to `recordReflection`):

```ts
  /** "This is hard": one struggled flag from `manual` per objective. Random ids: flagging again later is recorded again. */
  flagObjectives: (courseId: string, objectiveIds: readonly string[]) => void;
  /** Write questions for flagged objectives short of them (POST /api/top-up, no session); the problem, or null. */
  requestQuestions: (courseId: string, objectiveIds: readonly string[]) => Promise<string | null>;
```

Implement them after `recordReflection`:

```ts
  const flagObjectives = useCallback<OrcaActions["flagObjectives"]>(
    (courseId, objectiveIds) => {
      const at = new Date().toISOString();
      const catalogue = state.objectives[courseId] ?? {};
      const flags: ConfusionEvent[] = objectiveIds.map((objectiveId) => {
        const o = catalogue[objectiveId];
        if (!o) throw new Error(`Objective ${objectiveId} is not in course ${courseId}`);
        return { kind: "confusion", id: crypto.randomUUID(), at, courseId, topicId: o.topicId, objectiveId, materialId: null, note: null, flagSource: "manual", page: null };
      });
      setState((s) => ({ ...s, evidence: [...s.evidence, ...flags] }));
      save(
        async () => {
          for (const f of flags) await postEvidence(f, { kind: "confusion", id: f.id, courseId, objectiveId: f.objectiveId, flagSource: "manual" });
        },
        { onFail: () => setState((s) => ({ ...s, evidence: s.evidence.filter((e) => !flags.includes(e as ConfusionEvent)) })) },
      );
    },
    [save, postEvidence, state.objectives],
  );

  const requestQuestions = useCallback<OrcaActions["requestQuestions"]>(
    async (courseId, objectiveIds) => {
      await afterSaves();
      const res = await fetch("/api/top-up", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ courseId, objectiveIds: [...new Set(objectiveIds)] }) }).catch(() => null);
      if (!res) return "Couldn't write questions for this yet: the server didn't answer.";
      const out = (await res.json().catch(() => null)) as { state?: string; error?: string } | null;
      if (!res.ok) return `Couldn't write questions for this yet: ${out?.error ?? `the server answered ${res.status}`}.`;
      if (out?.state === "no-model") return "Couldn't write questions for this yet: no AI is connected.";
      if (out?.state === "busy") return "Couldn't write questions for this yet: Orca is already writing questions for this course. Try again in a minute.";
      return null;
    },
    [afterSaves],
  );
```

Check the names used: `state.objectives` (the store's objectives-by-course map; `useOrca()` exposes it as `objectives`), `afterSaves` (already defined; used by `useTopUp`). Add both actions to the provider's value object and its `useMemo` dependency list (`src/lib/store.tsx:876-878`).

`recordReflection`: after its `save(...)`, ask for questions for the matched objectives:

```ts
      if (confusion.length) void requestQuestions(confusion[0].courseId, confusion.map((c) => c.objectiveId));
```

(move `requestQuestions` above `recordReflection`, add it to the deps.)

- [ ] **Step 4: "This is hard" on the objectives page**

`src/app/course/[slug]/objectives/page.tsx`: keep the last request so it can be retried (spec §4: "Couldn't write questions for this yet" with Try again):

```tsx
  const { flagObjectives, requestQuestions } = useOrca();
  const [problem, setProblem] = useState<{ message: string; ids: string[] } | null>(null);
  const ask = (ids: string[]) => void requestQuestions(course.id, ids).then((message) => setProblem(message ? { message, ids } : null));
```

and pass `onFlag={(id) => { flagObjectives(course.id, [id]); ask([id]); }}` into `TopicSection`. In each live objective's action row, before Reject:

```tsx
                  {status !== undefined && isInRotation(status) ? (
                    <span data-part="flag-hard" className="text-[13px] font-bold text-wisteria-deep">Flagged</span>
                  ) : (
                    <TextAction data-part="flag-hard" onClick={() => onFlag(o.id)}>This is hard</TextAction>
                  )}
```

and, above the topic sections, when `problem` is set:

```tsx
        {problem && (
          <p role="alert" data-part="flag-problem" className="text-[14px] font-semibold text-prussian">
            {problem.message}{" "}
            <TextAction onClick={() => ask(problem.ids)}>Try again</TextAction>
          </p>
        )}
```

If `TextAction` doesn't forward `data-*` props, wrap it: `<span data-part="flag-hard"><TextAction …/></span>` and make the test's locator `[data-part="flag-hard"] button` — check `src/components/review/parts.tsx` first.

- [ ] **Step 5: "This topic is hard" in the topic popup**

`src/components/quiz/DiveModal.tsx`: add a prop `onFlagTopic?: (topicId: string) => void`, and under the Start dive button:

```tsx
            {onFlagTopic && (
              <button type="button" data-part="flag-topic" onClick={() => onFlagTopic(topic.id)} className="text-[14px] font-bold text-wisteria-deep underline underline-offset-4">
                This topic is hard: flag all of it
              </button>
            )}
```

Update the component's doc comment: "…Start opens the session…; 'This topic is hard' flags every live objective in the topic."

`src/app/course/[slug]/page.tsx`, on `<DiveModal …>`:

```tsx
        onFlagTopic={(topicId) => {
          const ids = m.topicObjectives.get(topicId) ?? [];
          flagObjectives(course.id, ids);
          void requestQuestions(course.id, ids);
          closeDive();
        }}
```

(`const { flagObjectives, requestQuestions } = useOrca();` with the page's other store reads.)

Add one browser test to `e2e/weak-points.spec.ts`:

```ts
test("This topic is hard flags every objective in the topic", async ({ page, student }) => {
  await seedFixtureCourse(student);
  await page.goto(`/course/${COURSE_SLUG}`);
  await page.locator('[data-part="node"]').first().click();
  await page.locator('[data-part="flag-topic"]').click();
  await expect(page.locator('[data-part="topic-ring"]')).toHaveCount(1);
});
```

- [ ] **Step 6: Run, check, commit**

Run: `npx tsc --noEmit && npx eslint src/lib/store.tsx "src/app/course/[slug]/objectives/page.tsx" src/components/quiz/DiveModal.tsx "src/app/course/[slug]/page.tsx" e2e/fixture.ts e2e/weak-points.spec.ts`
Run: `npm run locked -- npx playwright test e2e/weak-points.spec.ts e2e/reflect.spec.ts`
Expected: PASS.

```bash
git add src/lib/store.tsx "src/app/course/[slug]" src/components/quiz/DiveModal.tsx e2e/fixture.ts e2e/weak-points.spec.ts
git commit -m "This is hard: manual struggle flags on an objective (objectives page) or a whole topic (topic popup); flagged objectives short of questions get a top-up"
```

---

### Task 7: Caught up — Practice other topics, Practice exam topics, course-wide dives

**Files:**
- Create: `src/components/layout/CaughtUp.tsx`
- Modify: `src/components/layout/Sidebar.tsx:25-42,56-63`
- Modify: `src/app/session/[slug]/page.tsx:29-49,120-134,195-215`
- Modify: `src/app/course/[slug]/page.tsx` (copy line)
- Create: `src/lib/mastery/practice.ts`
- Test: `tests/mastery/practice.test.ts`, `e2e/weak-points.spec.ts`

**Interfaces:**
- Consumes: `CourseAgenda.ranked` (statuses and priority terms), `Exam { courseId, date, topicIds }`, `AGENDA_RULES.examWindowDays`.
- Produces (`src/lib/mastery/practice.ts`, pure):
  ```ts
  export type DiveScope = "course" | "practice" | "exam";
  export function diveObjectives(ranked: readonly RankedObjective[], scope: DiveScope, opts?: { topicId?: string; examTopicIds?: readonly string[] | null }): string[];
  export function examInWindow(exams: readonly { courseId: string; date: string; topicIds: string[] }[], courseId: string, today: string): { topicIds: string[] } | null;
  ```
  Session URL: `/session/<slug>?kind=deep&scope=practice|exam`.

- [ ] **Step 1: Write the failing unit tests**

`tests/mastery/practice.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { diveObjectives, examInWindow } from "../../src/lib/mastery/practice.ts";
import type { RankedObjective } from "../../src/lib/mastery/agenda.ts";
import type { ObjectiveStatus } from "../../src/lib/mastery/types.ts";

const r = (objectiveId: string, status: ObjectiveStatus, weight: number, topicId = "t1"): RankedObjective => ({
  objectiveId, topicId, status,
  priority: { objectiveId, score: weight, terms: [{ term: "importance", value: weight, reason: null }] },
});

test("practice covers unflagged objectives (verified and not flagged), highest weight first", () => {
  const ranked = [r("a", "learning", 2), r("b", "unseen", 1), r("c", "verified", 1.5), r("d", "retired", 2)];
  assert.deepEqual(diveObjectives(ranked, "practice"), ["c", "b"]);
});

test("a course-wide dive covers weak points first, then unflagged objectives", () => {
  const ranked = [r("b", "unseen", 2), r("a", "learning", 1), r("c", "verified", 1), r("d", "retired", 2)];
  assert.deepEqual(diveObjectives(ranked, "course"), ["a", "b", "c"]);
});

test("a topic dive covers every objective in the topic but retired ones", () => {
  const ranked = [r("a", "unseen", 1, "t1"), r("b", "learning", 1, "t2"), r("c", "retired", 1, "t1")];
  assert.deepEqual(diveObjectives(ranked, "course", { topicId: "t1" }), ["a"]);
});

test("exam practice covers unflagged objectives in the exam's topics, or the whole course when it lists none", () => {
  const ranked = [r("a", "unseen", 1, "t1"), r("b", "unseen", 1, "t2"), r("c", "learning", 1, "t1")];
  assert.deepEqual(diveObjectives(ranked, "exam", { examTopicIds: ["t1"] }), ["a"]);
  assert.deepEqual(diveObjectives(ranked, "exam", { examTopicIds: [] }), ["a", "b"]);
});

test("an exam is in its window from 7 days before it", () => {
  const exams = [{ courseId: "c", date: "2026-11-20", topicIds: ["t1"] }];
  assert.deepEqual(examInWindow(exams, "c", "2026-11-13"), { topicIds: ["t1"] });
  assert.equal(examInWindow(exams, "c", "2026-11-12"), null);
  assert.equal(examInWindow(exams, "c", "2026-11-21"), null);
  assert.equal(examInWindow(exams, "other", "2026-11-15"), null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/mastery/practice.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `practice.ts`**

```ts
/**
 * What a dive covers (weak points first, docs/superpowers/specs/2026-11-04-weak-points-first-design.md).
 * A course-wide dive: weak points, then unflagged objectives. Practice other topics and Practice
 * exam topics: unflagged objectives only (not flagged or verified), highest weight first. A topic
 * dive: every objective in the topic. Retired objectives never. Pure.
 */
import { AGENDA_RULES, type RankedObjective, addDays } from "./agenda.ts";
import { isInRotation } from "./flags.ts";

export type DiveScope = "course" | "practice" | "exam";

const weightOf = (r: RankedObjective) => r.priority.terms.find((t) => t.term === "importance")?.value ?? 0;
const unflagged = (r: RankedObjective) => r.status === "unseen" || r.status === "verified";
const byWeight = (a: RankedObjective, b: RankedObjective) => weightOf(b) - weightOf(a) || a.objectiveId.localeCompare(b.objectiveId);

export function diveObjectives(ranked: readonly RankedObjective[], scope: DiveScope, opts: { topicId?: string; examTopicIds?: readonly string[] | null } = {}): string[] {
  const live = ranked.filter((r) => r.status !== "retired");
  if (scope === "course") {
    if (opts.topicId !== undefined) return live.filter((r) => r.topicId === opts.topicId).map((r) => r.objectiveId);
    // `ranked` is already highest priority first.
    const weak = live.filter((r) => isInRotation(r.status) || r.status === "check-due");
    const rest = live.filter(unflagged).sort(byWeight);
    return [...weak, ...rest].map((r) => r.objectiveId);
  }
  const topics = scope === "exam" && opts.examTopicIds && opts.examTopicIds.length > 0 ? new Set(opts.examTopicIds) : null;
  return live.filter((r) => unflagged(r) && (!topics || topics.has(r.topicId))).sort(byWeight).map((r) => r.objectiveId);
}

/** The course's next exam if today is in its "1 wk before exam" window. */
export function examInWindow(exams: readonly { courseId: string; date: string; topicIds: string[] }[], courseId: string, today: string): { topicIds: string[] } | null {
  const next = exams
    .filter((e) => e.courseId === courseId && e.date >= today && addDays(e.date, -AGENDA_RULES.examWindowDays) <= today)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  return next ? { topicIds: next.topicIds } : null;
}
```

Run: `node --test tests/mastery/practice.test.ts` → PASS.

- [ ] **Step 4: The caught-up card**

`src/components/layout/CaughtUp.tsx`:

```tsx
"use client";

import Link from "next/link";
import { motion } from "motion/react";
import type { Course } from "@/lib/data";
import { fadeUp } from "@/lib/motion";

export const FOCUS_COPY = "Orca focuses on what you flag: star things in your notes, study with Claude, or tap the slides that were hard.";

/** Nothing due in a course: "You're caught up", optional practice (a dive over unflagged objectives), and the exam's topics in its window. */
export function CaughtUp({ course, canPractise, examTopics }: { course: Course; canPractise: boolean; examTopics: boolean }) {
  return (
    <motion.div variants={fadeUp} data-part="caught-up" className="flex flex-col gap-[10px] rounded-[20px] bg-alice px-[18px] py-[16px] lip-4 lip-alice">
      <p className="text-[17px] font-bold text-prussian">You&apos;re caught up</p>
      <p className="text-[14px] text-wisteria-deep">{FOCUS_COPY}</p>
      {canPractise ? (
        <div className="flex flex-wrap gap-[8px]">
          <Link href={`/session/${course.slug}?kind=deep&scope=practice`} data-part="practice-other" className="pressable rounded-pill bg-prussian px-[14px] py-[7px] text-[13px] font-bold text-parchment lip-2 lip-ink">
            Practice other topics
          </Link>
          {examTopics && (
            <Link href={`/session/${course.slug}?kind=deep&scope=exam`} data-part="practice-exam" className="pressable rounded-pill bg-parchment px-[14px] py-[7px] text-[13px] font-bold text-prussian ring-2 ring-inset ring-alice-deep lip-2 lip-alice">
              Practice exam topics
            </Link>
          )}
        </div>
      ) : (
        <p className="text-[14px] font-semibold text-prussian">You&apos;ve practised everything here</p>
      )}
    </motion.div>
  );
}
```

`src/components/layout/Sidebar.tsx`: when the sidebar is on a course page (`course` is set) and that course has no `today` items, show `<CaughtUp …/>` instead of "Nothing due. Nice." Compute in `Sidebar`:

```tsx
  const { courses, hydrated, exams } = useOrca();
  const agenda = useAgenda();
  const dayKey = useDayKey();
  const today = dayKey(new Date().toISOString());
  const caughtUp = course && hydrated && !visibleTodos.some((d) => d.when === "today") && agenda[course.id]
    ? {
        canPractise: diveObjectives(agenda[course.id].ranked, "practice").length > 0,
        examTopics: examInWindow(exams, course.id, today) !== null,
      }
    : null;
```

and render `{caughtUp && course ? <CaughtUp course={course} {...caughtUp} /> : <Section title="Due today" … />}` in place of the first `Section` (keep "Due tomorrow" as is). Import `useAgenda`, `useDayKey` from `@/lib/store`, `diveObjectives`, `examInWindow` from `@/lib/mastery/practice`. Off a course page the home sidebar keeps "Nothing due. Nice." but adds the copy: change that paragraph to `Nothing due. Nice. {FOCUS_COPY}` (import `FOCUS_COPY`).

- [ ] **Step 5: Scoped dives in the session page**

`src/app/session/[slug]/page.tsx`:
- Read `const scope = (["practice", "exam"] as const).find((s) => s === sp.scope) ?? "course";` next to `kind`, include it in `SessionBody`'s key, and pass it down to `DeepReview` as `scope`.
- In `DeepReview`, replace the `objectiveIds` initialiser:

```tsx
  const { exams } = useOrca();
  const today = useDayKey()(new Date().toISOString());
  const [objectiveIds] = useState(() =>
    diveObjectives(agenda.ranked, scope, { topicId, examTopicIds: scope === "exam" ? examInWindow(exams, course.id, today)?.topicIds ?? null : null }),
  );
```

- The empty message: `scope === "course" ? (topicName ? \`${topicName} has no objectives to dive into yet.\` : "Nothing to dive into yet.") : "You've practised everything here"`.
- The setup title: `courseName={scope === "practice" ? \`${course.name} · Practice other topics\` : scope === "exam" ? \`${course.name} · Practice exam topics\` : topicName ? … : course.name}`.
- Update `DeepReview`'s doc comment: "Course-wide it covers weak points first, then unflagged objectives; scope=practice and scope=exam cover only unflagged objectives (the exam's topics in its window), highest weight first; for one topic…".
- `QuickReview`'s empty state: replace the `NothingToDo` return with a screen that shows the caught-up card:

```tsx
  if (items.length === 0) {
    const later = agenda.heldForNext.length ? " What you practiced today comes back in your next quick review." : "";
    return (
      <Screen bg="parchment" className="items-start gap-4 p-[32px]">
        <BackButton href={backHref} />
        <p className="text-[22px] font-bold text-prussian">Nothing to review in {course.name} right now.{later}</p>
        <CaughtUp course={course} canPractise={diveObjectives(agenda.ranked, "practice").length > 0} examTopics={examInWindow(exams, course.id, today) !== null} />
      </Screen>
    );
  }
```

  (`exams` from `useOrca()`, `today` from `useDayKey()`.)

- [ ] **Step 6: Browser test**

Add to `e2e/weak-points.spec.ts`:

```ts
test("caught up: Practice other topics starts a dive over unflagged objectives", async ({ page, student }) => {
  await seedFixtureCourse(student);
  await page.goto(`/course/${COURSE_SLUG}`);
  await expect(page.locator('[data-part="caught-up"]')).toBeVisible();
  await page.locator('[data-part="practice-other"]').click();
  await expect(page).toHaveURL(/kind=deep&scope=practice/);
  await expect(page.getByText("Practice other topics")).toBeVisible();
});
```

(The dive's question writing runs against the fake model in the e2e config, as `e2e/scheduling.spec.ts`'s dive test does; this test stops at the setup screen.)

- [ ] **Step 7: Run, check, commit**

Run: `node --test tests/mastery/practice.test.ts && npx tsc --noEmit && npx eslint src/lib/mastery/practice.ts src/components/layout "src/app/session/[slug]/page.tsx"`
Run: `npm run locked -- npx playwright test e2e/weak-points.spec.ts`

```bash
git add src/lib/mastery/practice.ts tests/mastery/practice.test.ts src/components/layout "src/app/session/[slug]/page.tsx" e2e/weak-points.spec.ts
git commit -m "Caught up: Practice other topics and Practice exam topics are dives over unflagged objectives; course-wide dives cover weak points first"
```

---

### Task 8: Browser suite and docs in line with weak points first

**Files:**
- Modify: the e2e specs that assume new objectives are due or count toward islands (expected: `e2e/scheduling.spec.ts`, `e2e/resume.spec.ts`, `e2e/feedback.spec.ts`, `e2e/store.spec.ts`, `e2e/mastery-core.spec.ts`, `e2e/settings.spec.ts`; the run decides)
- Modify: `docs/MASTERY-PLAN.md` §2.3, `docs/BACKEND-ROADMAP.md` ("Designed, not built (2026-11-04): weak points first"), `CLAUDE.md` (product model: Practice, islands, statuses; "Since …" handoff line), `docs/TO-DISCUSS.md` ("Island looks" entry: the share is now weak points mastered), the spec's status line, this plan's status block

- [ ] **Step 1: Run the whole browser suite**

Run: `npm run locked -- npm run test:e2e`
Collect the failures. For each, read its trace (`npx playwright show-trace test-results/<dir>/trace.zip`) before changing it.

- [ ] **Step 2: Fix each failure at its seed, not its assertion**

A test that needs objectives due adds a struggle flag to its seeded evidence, dated before the answers it seeds:

```ts
evidence: [struggled(course.id, topic.id, objective.id, daysAgo(3)), ...answers],
```

(`struggled` from `./fixture`.) A test that asserts old copy ("Not started", "N of M objectives mastered", the island's look with only unflagged objectives) asserts the new copy from Tasks 2–4 instead. A failure that isn't one of those two kinds is a bug in Tasks 1–7: fix the code there and say so in the commit.

- [ ] **Step 3: Docs**

- `docs/MASTERY-PLAN.md` §2.3: replace the status table with the spec's (section 1, "Statuses") and add the rotation rule in one paragraph.
- `docs/BACKEND-ROADMAP.md`: change the "Designed, not built (2026-11-04): weak points first" paragraph to "Built (Plan A, <date>)" with: only objectives in rotation come due; islands and rows count weak points mastered; manual flags; scoped practice dives; `RULES_VERSION` 2; migration `20261105090000`; Plans B and C still to do.
- `CLAUDE.md`: in "Product model", replace "**Islands show mastery.** … share of its course's objectives that are mastered." with "… from the share of its weak points (objectives in rotation) that are mastered; nothing flagged shows the uncharted look"; in "Practice", add "Only weak points come due: objectives with a struggled flag, a miss or a partly right answer, or mastered before the change; unflagged ones are `unseen`/`verified`; with nothing due, Practice other topics is a dive over unflagged objectives." Add a "Since 2026-11-…" bullet under "Where things stand" naming the plan.
- `docs/TO-DISCUSS.md` "Island looks: art": "the share of objectives currently held" → "the share of weak points (objectives in rotation) currently held".
- Spec status line: "Plan A built <date>; Plans B and C not written."

- [ ] **Step 4: Commit**

```bash
git add e2e docs CLAUDE.md
git commit -m "Browser tests seed struggle flags where they need objectives due; docs: weak points first Plan A built"
```

---

### Task 9 (last, separable): Uploads write questions only for objectives in rotation

A cost saving; everything above works without it. Merge it separately if its test churn is large.

**Files:**
- Modify: `src/lib/pipeline/run.ts:32-52,489-505` (`RunInput.writeFor`)
- Modify: `src/lib/jobs/jobs.ts:156-176` (computes `writeFor`)
- Modify: `src/lib/mastery/course-mastery.ts:71-75` (`objectivesNeedingQuestions` counts weak points only)
- Test: `tests/pipeline/run.test.ts`, `tests/mastery/course-mastery.test.ts`, `e2e/upload.spec.ts`

**Interfaces:**
- Produces: `RunInput.writeFor?: ReadonlySet<string>` — when given, only these objective ids get questions at upload. Plan B adds objectives flagged by markers in the same job.

- [ ] **Step 1: Write the failing tests**

`tests/pipeline/run.test.ts`, with the file's existing upload fixture and fake `call`:

```ts
test("with writeFor, an upload writes questions only for those objectives", async () => {
  const input = { ...baseInput(), writeFor: new Set<string>() };
  const plan = await runUpload(input, fakeDeps());
  assert.equal(Object.values(plan.questions).flat().length, 0);
  assert.equal(calls("generate").length, 0, "no question-writing call at all");
});
```

(`baseInput`, `fakeDeps` and `calls` stand for the file's own builders; use their real names.)

`tests/mastery/course-mastery.test.ts`:

```ts
test("objectives without questions are counted only among weak points", () => {
  // One topic, two objectives with no questions: one flagged (manual), one not.
  const m = courseMastery({ ...twoObjectivesNoQuestions(), evidence: [manualFlag("o1")] });
  assert.equal(m.objectivesNeedingQuestions.get("t"), 1);
});
```

(`twoObjectivesNoQuestions` and `manualFlag`: build them with the file's existing helpers; `manualFlag` as in Task 3.)

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/pipeline/run.test.ts tests/mastery/course-mastery.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`src/lib/pipeline/run.ts`, in `RunInput`:

```ts
  /**
   * Weak points first: only these objectives get questions at upload (objectives in rotation the
   * upload touched). Absent: every objective the upload touched, as before (top-ups and tests).
   */
  writeFor?: ReadonlySet<string>;
```

In the question loop (`for (const id of new Set([...newObjectives.map((o) => o.id), ...Object.keys(objectiveUpdates)]))`), first line inside:

```ts
    if (input.writeFor && !input.writeFor.has(id)) continue;
```

`src/lib/jobs/jobs.ts`, before `runUpload(...)`: read the course's snapshots (the store already exposes the course's state to jobs; use the same reader the connector uses, `readCourseState(supabaseSnapshotStore(…))`, through the job store if it has one, else add `store.rotation(courseId): Promise<Set<string>>` to the job store returning objective ids whose stored accumulator has `inRotation`), and pass `writeFor: await store.rotation(run.courseId)`. Unit-test the job store method in `tests/jobs/jobs.test.ts` with its fake store the way the file tests `store.flagged`.

`src/lib/mastery/course-mastery.ts`:

```ts
    objectivesNeedingQuestions.set(topicId, list.filter((o) => o.questionIds.length === 0 && isInRotation(objectives.get(o.id)!.status)).length);
```

(import `isInRotation` from `./flags.ts`; update the field's doc comment: "how many of its weak points have no questions at all".)

- [ ] **Step 4: Run, fix the upload specs, commit**

Run: `node --test tests/pipeline/run.test.ts tests/mastery/course-mastery.test.ts tests/jobs/jobs.test.ts && npx tsc --noEmit`
Run: `npm run locked -- npx playwright test e2e/upload.spec.ts e2e/review.spec.ts`
Specs that expected questions after an upload either seed a struggle flag on the objective first (a re-upload of material for a flagged objective writes questions) or assert none were written; never loosen what's written for a flagged objective.

```bash
git add src/lib/pipeline/run.ts src/lib/jobs src/lib/mastery/course-mastery.ts tests e2e
git commit -m "Uploads write questions only for objectives in rotation (weak points first); topic rows count only weak points without questions"
```

---

### Merge gate (once, before the PR to `main`)

- [ ] `npm test`
- [ ] `npm run locked -- npm run test:db`
- [ ] `npm run locked -- npm run test:e2e`
- [ ] `npm run locked -- npm run check:isolation`
- [ ] `npm run locked -- npm run check:evidence`
- [ ] If merging after 2026-11-10, move `MASTERY_RULES.rotationSince` to the merge day and record the new `RULES_HASHES[2]` (no other change; the golden accumulators don't move because the golden log is in October 2026).
- [ ] Deploy note: once the migration lands, the old code's homework reflection fails (it inserts confusion rows without `flag_source`, which the new check refuses) until the new code is live. Nothing else breaks: old code never reads the new columns, and the new code's manual flags only exist once it's live. Push the migration right before deploying; the Deploy workflow does both on merge to `main`.
