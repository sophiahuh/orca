# Questions Filed by Objective Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A question's topic is always its objective's current topic (following merges), never a stored copy, so a question saved under a stale topic can't break a course.

**Architecture:** Today every loader groups questions into `bank: topicId → questions` by the stored `questions.topic_id`, and merges keep that column right by moving the questions the browser knows about. Questions written on the server while the student edits (a dive, an upload, a top-up, or a merge from a browser that hasn't refreshed) keep a stale `topic_id`; `objectivesForTopic` then throws ("Question … is in topic T1 but its objective Y belongs to T2") in the browser's fold and in `POST /api/evidence`. This plan adds one pure function, `fileQuestions`, that files each question under its objective's current topic, and makes every loader and every merge use it. The in-memory `bank` shape stays (15 source files read it); only how it's built changes. Then, once the hosted databases are checked, `questions.objective_id` becomes required and the "unsorted" bucket goes.

**Tech Stack:** TypeScript (Node type stripping for pure modules), `node:test`, Supabase Postgres migrations, pgTAP.

## Status (2026-10-26)

- Tasks 1–4 done on `questions-by-objective` (unit suite 348/348, `test:db` and `check:evidence` 44/44 pass).
- Deviation from Task 2: objectives have the same stale-copy problem (an upload can create an
  objective in a topic the student merges meanwhile), so the loaders also pass objectives through
  `withCurrentTopics` (catalogue.ts) before filing questions. Covered by the `courseView` test.
- Task 5 waits on the owner's hosted check; Tasks 6–7 wait on Task 5.

## Background (read first)

- Course → topic → objective → questions (CLAUDE.md, "Product model"). Every generation path writes questions only for objectives it was given: the upload's questions step drops any question "written for an objective it wasn't asked about" (`src/lib/pipeline/run.ts:610`); top-ups and dives write for named objective ids. The browser never creates questions. So a question without an objective can only be an old row.
- The "unsorted" bucket (`unsortedObjectiveId`, `src/lib/mastery/catalogue.ts`) dates from 2026-10-05, when the built-in ALD questions were being tagged with objectives. The app ships no built-in questions now.
- Merges (`src/lib/course/ops.ts`): an objective merge sets `mergedInto` on the loser; a topic merge archives the loser topic with `mergedInto` and rewrites its objectives' `topicId`. Nothing is deleted.
- Reproduction of the crash (from the investigation, 2026-10-26): structure with topics T1 {X}, T2 {Y}; the student merges X into Y; a dive then saves a deep question with `topic_id` T1 and `objective_id` X. `attribution({ topicIds: ["T1","T2"], … })` throws. With a topic merge T1 → T2 instead, nothing throws but the question sits under the archived T1 and counts nowhere outside its dive.

## Global Constraints

- Pure modules (`src/lib/mastery`, `src/lib/course`, `src/lib/pipeline`, `src/lib/jobs`) load under plain Node: relative imports ending in `.ts`, `import type`, no TS parameter properties.
- No silent placeholders: a question whose objective isn't in the course throws with a clear message; never file it somewhere plausible.
- Nothing is deleted: no migration deletes questions or objectives.
- Node: `export PATH=$HOME/.nvm/versions/node/v24.20.0/bin:$PATH` before any command.
- Per commit (Fix mode checks): `npx tsc --noEmit`, `npx eslint <changed files>`, the unit test files named in the task. `npm run locked -- npm run test:db` only in tasks that add a migration.
- Commits on branch `questions-by-objective`, authored `-c user.name="Sophia Huh" -c user.email=sophiahuh@gmail.com` (commits reach production), messages one or two lines.
- Migration timestamps in this plan: `20261029090000`, `20261029090100` (the dive fix on `phase-4` uses `20261028090000`).
- `RULES_VERSION` stays 1: no course that computed before computes differently. The cross-topic objective-merge case threw (no result); in the topic-merge case an answer already fell back to its recorded objective's survivor (`attribution.refile`), which is where it's filed now too. If a reviewer finds a case where an answer's objective changes, bump it per `tests/mastery/snapshot.test.ts`.

## File map

| File | Change |
|---|---|
| `src/lib/mastery/catalogue.ts` | Add `currentTopicOf`, `fileQuestions` (Task 1); later drop the unsorted helpers (Task 6) |
| `src/lib/supabase/rows.ts` | `courseView` files questions with `fileQuestions` (Task 2) |
| `supabase/migrations/20261029090000_course_structure_topic_merges.sql` | `course_structure` returns each topic's `merged_into` (Task 2) |
| `src/lib/supabase/app-rows.ts` | `loadedState` files questions with `fileQuestions` (Task 2) |
| `src/lib/server/job-store.ts` | `course()` files questions with `fileQuestions` (Task 2) |
| `src/lib/course/ops.ts` | Merges and restores re-file the whole bank instead of moving known questions (Task 3) |
| `src/app/api/evidence/route.ts` | An answer event's `topicId` is its question's objective's topic (Task 4) |
| `supabase/migrations/20261029090100_questions_need_objectives.sql` | `questions.objective_id` not null (Task 6, after Task 5) |
| `src/lib/data.ts`, `src/lib/mastery/agenda.ts`, `src/lib/store.tsx`, tests | Remove the unsorted bucket (Task 6) |
| `CLAUDE.md`, `.claude/skills/assessment/SKILL.md`, `docs/BACKEND-ROADMAP.md` | Record the decision (Task 7) |

---

### Task 1: `fileQuestions`: a question's topic is its objective's current topic

**Files:**
- Modify: `src/lib/mastery/catalogue.ts`
- Test: `tests/mastery/catalogue.test.ts`

**Interfaces:**
- Produces:
  - `currentTopicOf(objectiveId: string, catalogue: Readonly<Record<string, Pick<ObjectiveInfo, "topicId" | "mergedInto">>>, topicMergedInto: ReadonlyMap<string, string>): string`
  - `fileQuestions<Q extends { id: string; objectiveId?: string }>(stored: ReadonlyArray<{ topicId: string; question: Q }>, catalogue: Readonly<Record<string, Pick<ObjectiveInfo, "topicId" | "mergedInto">>>, topicMergedInto: ReadonlyMap<string, string>): Record<string, Q[]>`: questions keep the order given; a question with no `objectiveId` stays under its stored topic (until Task 6).

- [ ] **Step 1: Write the failing tests** (append to `tests/mastery/catalogue.test.ts`; add `currentTopicOf, fileQuestions` to its import from `../../src/lib/mastery/catalogue.ts`)

```ts
const filing = {
  X: { topicId: "T1", mergedInto: "Y" },
  Y: { topicId: "T2" },
  Z: { topicId: "T3" },
};
const topicMerges = new Map([["T3", "T2"]]);

test("a question is filed under its objective's current topic, following objective and topic merges", () => {
  assert.equal(currentTopicOf("X", filing, topicMerges), "T2", "X was merged into Y, which lives in T2");
  assert.equal(currentTopicOf("Z", filing, topicMerges), "T2", "Z's topic T3 was merged into T2");
  const bank = fileQuestions(
    [
      { topicId: "T1", question: { id: "dive-q", objectiveId: "X" } }, // saved by a dive after the merge, stale topic
      { topicId: "T2", question: { id: "q2", objectiveId: "Y" } },
      { topicId: "T3", question: { id: "q3", objectiveId: "Z" } },
    ],
    filing,
    topicMerges,
  );
  assert.deepEqual(Object.keys(bank), ["T2"]);
  assert.deepEqual(bank.T2.map((q) => q.id), ["dive-q", "q2", "q3"], "order is kept");
});

test("a question with no objective stays under its stored topic; one naming an unknown objective throws", () => {
  assert.deepEqual(fileQuestions([{ topicId: "T1", question: { id: "old" } }], filing, topicMerges), { T1: [{ id: "old" }] });
  assert.throws(() => fileQuestions([{ topicId: "T1", question: { id: "q", objectiveId: "nope" } }], filing, topicMerges), /Question q points at objective "nope", which isn't in the course/);
});

test("a topic merge cycle throws instead of looping", () => {
  assert.throws(() => currentTopicOf("Y", filing, new Map([["T2", "T4"], ["T4", "T2"]])), /Topic merge cycle/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --import ./tests/support/register.mjs --test tests/mastery/catalogue.test.ts`
Expected: FAIL, `currentTopicOf` is not exported.

- [ ] **Step 3: Implement** (in `src/lib/mastery/catalogue.ts`, after `resolveObjectiveId`)

```ts
/**
 * The topic an objective lives in now: follow the objective's merges to its survivor, then that
 * survivor's topic's merges. A question's topic is always this, never a stored copy (2026-10-26:
 * questions saved by a job while the student merged kept the old topic and broke the course).
 */
export function currentTopicOf(
  objectiveId: string,
  catalogue: Readonly<Record<string, Pick<ObjectiveInfo, "topicId" | "mergedInto">>>,
  topicMergedInto: ReadonlyMap<string, string>,
): string {
  const objective = catalogue[resolveObjectiveId(objectiveId, catalogue as Readonly<Record<string, ObjectiveInfo>>)];
  if (!objective) throw new Error(`Objective "${objectiveId}" isn't in the course`);
  const seen = new Set<string>();
  let topic = objective.topicId;
  while (topicMergedInto.has(topic)) {
    if (seen.has(topic)) throw new Error(`Topic merge cycle through "${topic}"`);
    seen.add(topic);
    topic = topicMergedInto.get(topic)!;
  }
  return topic;
}

/**
 * Group questions by topic, each under its objective's current topic (`currentTopicOf`), in the
 * order given. `topicId` is where the row says it is: used only for a question with no objective.
 */
export function fileQuestions<Q extends { id: string; objectiveId?: string }>(
  stored: ReadonlyArray<{ topicId: string; question: Q }>,
  catalogue: Readonly<Record<string, Pick<ObjectiveInfo, "topicId" | "mergedInto">>>,
  topicMergedInto: ReadonlyMap<string, string>,
): Record<string, Q[]> {
  const bank: Record<string, Q[]> = {};
  for (const { topicId, question } of stored) {
    let topic = topicId;
    if (question.objectiveId) {
      if (!catalogue[question.objectiveId]) throw new Error(`Question ${question.id} points at objective "${question.objectiveId}", which isn't in the course`);
      topic = currentTopicOf(question.objectiveId, catalogue, topicMergedInto);
    }
    (bank[topic] ??= []).push(question);
  }
  return bank;
}
```

(`resolveObjectiveId` takes `Record<string, ObjectiveInfo>` but only reads `mergedInto`; if `tsc` objects to the cast, widen `resolveObjectiveId`'s parameter to `Readonly<Record<string, Pick<ObjectiveInfo, "mergedInto">>>` instead of casting.)

- [ ] **Step 4: Run to verify they pass**

Run: `node --import ./tests/support/register.mjs --test tests/mastery/catalogue.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npx eslint src/lib/mastery/catalogue.ts tests/mastery/catalogue.test.ts
git add src/lib/mastery/catalogue.ts tests/mastery/catalogue.test.ts
git -c user.name="Sophia Huh" -c user.email=sophiahuh@gmail.com commit -m "fileQuestions: a question's topic is its objective's current topic, following objective and topic merges"
```

---

### Task 2: Every loader files questions by objective

**Files:**
- Create: `supabase/migrations/20261029090000_course_structure_topic_merges.sql`
- Modify: `src/lib/supabase/rows.ts:58-82` (`courseView`)
- Modify: `src/lib/supabase/app-rows.ts:460-464` (`loadedState`)
- Modify: `src/lib/server/job-store.ts:90-91` (`course()`)
- Test: `tests/supabase/rows.test.ts`, `tests/supabase/app-rows.test.ts`, `supabase/tests/05_store_reads.test.sql`

**Interfaces:**
- Consumes: `fileQuestions`, `currentTopicOf` from Task 1.
- Produces: `courseView`'s `rows.topics` items gain `merged_into: string | null`; `course_structure` returns it.

- [ ] **Step 1: Write the failing tests**

In `tests/supabase/rows.test.ts` (the reproduction, through the server's view):

```ts
test("the server's view files a question saved under a stale topic by its objective, so a merge mid-job can't break the course", () => {
  const view = courseView({
    timezone: "UTC",
    topics: [
      { id: "T1", review: "confirmed", sort_order: 0, merged_into: null },
      { id: "T2", review: "confirmed", sort_order: 1, merged_into: null },
    ],
    objectives: [
      { id: "X", topic_id: "T1", name: "X", review: "archived", merged_into: "Y" },
      { id: "Y", topic_id: "T2", name: "Y", review: "confirmed", merged_into: null },
    ],
    questions: [
      { id: "q-y", topic_id: "T2", objective_id: "Y", tier: null, sort_order: 0 },
      { id: "dive-q", topic_id: "T1", objective_id: "X", tier: null, sort_order: 1 },
    ],
  });
  assert.deepEqual(view.attribution.objectives.get("Y")?.questionIds, ["q-y", "dive-q"]);
});
```

In `tests/supabase/app-rows.test.ts`, next to "loading groups rows by course…", a test that builds a `MyData` with the same rows (copy that test's fixture builder and change only the topics/objectives/questions) and asserts `loadedState(d).questionBank[courseId]` is `{ T2: [q-y, dive-q] }` by id.

In `supabase/tests/05_store_reads.test.sql`, bump `plan(n)` by one and add after the timezone assertion:

```sql
select ok(public.course_structure(:'course', :'A') -> 'topics' -> 0 ? 'merged_into', 'each topic says what it was merged into');
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --import ./tests/support/register.mjs --test tests/supabase/rows.test.ts tests/supabase/app-rows.test.ts`
Expected: FAIL: `courseView` throws "Question dive-q is in topic "T1" but its objective "Y" belongs to "T2"".

- [ ] **Step 3: Implement**

Migration `supabase/migrations/20261029090000_course_structure_topic_merges.sql`: `create or replace function public.course_structure` with the body of `20261005180000_store_reads.sql:15-32` unchanged except the topics object:

```sql
-- A question's topic is its objective's current topic (2026-10-26), so the fold needs each topic's
-- merge pointer: an objective a job created in a topic the student merged meanwhile still names it.
create or replace function public.course_structure(course uuid, owner uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'timezone', p.timezone,
    'topics', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'review', t.review, 'sort_order', t.sort_order, 'merged_into', t.merged_into) order by t.sort_order, t.id)
        from public.topics t where t.course_id = c.id and t.owner_id = c.owner_id), '[]'::jsonb),
    'objectives', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'topic_id', o.topic_id, 'name', o.name, 'review', o.review, 'merged_into', o.merged_into) order by o.id)
        from public.objectives o where o.course_id = c.id and o.owner_id = c.owner_id), '[]'::jsonb),
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object('id', q.id, 'topic_id', q.topic_id, 'objective_id', q.objective_id, 'tier', q.tier, 'sort_order', q.sort_order) order by q.sort_order, q.id)
        from public.questions q where q.course_id = c.id and q.owner_id = c.owner_id), '[]'::jsonb))
    from public.courses c
    join public.profiles p on p.owner_id = c.owner_id
   where c.id = course and c.owner_id = owner;
$$;
```

(`create or replace` keeps the existing grants.)

`src/lib/supabase/rows.ts`, `courseView`: add `"merged_into"` to the topics `Pick`, then replace the bank loop:

```ts
  const topicMergedInto = new Map(rows.topics.flatMap((t) => (t.merged_into ? [[t.id, t.merged_into] as const] : [])));
  const sorted = [...rows.questions].sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
  const bank = fileQuestions(
    sorted.map((q) => ({
      topicId: q.topic_id,
      question: { id: q.id, ...(q.objective_id ? { objectiveId: q.objective_id } : {}), ...(q.tier ? { tier: q.tier as QuestionRef["tier"] } : {}) },
    })),
    catalogue,
    topicMergedInto,
  );
```

`src/lib/supabase/app-rows.ts`, `loadedState`: replace the `questionBank` loop:

```ts
  const questionBank = byCourse<Record<string, QuizQuestion[]>>(() => ({}));
  const sortedQuestions = [...d.questions].sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
  for (const c of courses) {
    const topicMergedInto = new Map(c.topics.flatMap((t) => (t.mergedInto ? [[t.id, t.mergedInto] as const] : [])));
    const stored = sortedQuestions.filter((q) => q.course_id === c.id).map((q) => ({ topicId: q.topic_id, question: questionFromRow(q) }));
    questionBank[c.id] = fileQuestions(stored, objectives[c.id], topicMergedInto);
  }
```

`src/lib/server/job-store.ts`, `course()`: replace the two bank lines:

```ts
      const objectiveMap = Object.fromEntries(objectives.map((o) => [o.id, objectiveFromRow(o)]));
      const topicMergedInto = new Map(topics.flatMap((t) => (t.merged_into ? [[t.id, t.merged_into] as const] : [])));
      const bank = fileQuestions(questions.map((q) => ({ topicId: q.topic_id, question: questionFromRow(q) })), objectiveMap, topicMergedInto);
```

and use `objectiveMap` for `structure.objectives`. Import `fileQuestions` from `@/lib/mastery/catalogue` in the two non-pure files and from `../mastery/catalogue.ts` in `rows.ts`.

- [ ] **Step 4: Run to verify they pass**

```bash
node --import ./tests/support/register.mjs --test tests/supabase/rows.test.ts tests/supabase/app-rows.test.ts tests/mastery/*.test.ts tests/jobs/jobs.test.ts
npm run locked -- npm run test:db
```

Expected: PASS (the mastery and jobs tests must not change: loading is the only difference).

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npx eslint src/lib/supabase/rows.ts src/lib/supabase/app-rows.ts src/lib/server/job-store.ts tests/supabase/rows.test.ts tests/supabase/app-rows.test.ts
git add supabase/migrations/20261029090000_course_structure_topic_merges.sql supabase/tests/05_store_reads.test.sql src/lib/supabase/rows.ts src/lib/supabase/app-rows.ts src/lib/server/job-store.ts tests/supabase/rows.test.ts tests/supabase/app-rows.test.ts
git -c user.name="Sophia Huh" -c user.email=sophiahuh@gmail.com commit -m "Questions load under their objective's current topic (browser, server view, jobs), so one saved under a stale topic can't break a course"
```

---

### Task 3: Merges re-file the whole bank

**Files:**
- Modify: `src/lib/course/ops.ts` (`moveQuestions`, `mergeTopics`, `mergeObjectives`, `restoreObjective`)
- Test: `tests/course/ops.test.ts`

**Interfaces:**
- Consumes: `fileQuestions` (Task 1).
- Produces: `refiled(s: CourseStructure): CourseStructure` (module-private).

Why: the browser's structure must match what a reload would give (Task 2), including questions it learned about after the merge. Moving only "the loser's questions" is the stale-copy pattern this plan removes.

- [ ] **Step 1: Write the failing test** (append to `tests/course/ops.test.ts`; reuse that file's structure builders)

```ts
test("a merge re-files every question by its objective, including one saved under a stale topic", () => {
  // X in T1, Y in T2; a job's question for X arrived under T2 by mistake before the merge.
  const s = structure({ topics: ["T1", "T2"], objectives: { X: "T1", Y: "T2" }, bank: { T1: [q("q1", "X")], T2: [q("q2", "Y"), q("stray", "X")] } });
  const merged = mergeObjectives(s, "Y", "X");
  assert.deepEqual(Object.fromEntries(Object.entries(merged.bank).map(([t, qs]) => [t, qs.map((x) => x.id)])), { T1: ["q1", "q2", "stray"] });
});
```

(If `tests/course/ops.test.ts` has no `structure`/`q` builders, write the literal `CourseStructure` the way its existing merge tests do.)

- [ ] **Step 2: Run to verify it fails**

Run: `node --import ./tests/support/register.mjs --test tests/course/ops.test.ts`
Expected: FAIL: `stray` stays under T2 (or ordering differs).

- [ ] **Step 3: Implement**

In `src/lib/course/ops.ts`: delete `moveQuestions` and `mergedFamily`'s use in it (keep `mergedFamily`: the cycle check uses it). Add:

```ts
/**
 * File every question under its objective's current topic (`fileQuestions`). Questions already in
 * place keep their positions and moved ones follow them, so a save sends only the moved rows.
 */
function refiled(s: CourseStructure): CourseStructure {
  const topicMergedInto = new Map(s.topics.flatMap((t) => (t.mergedInto ? [[t.id, t.mergedInto] as const] : [])));
  const stored = Object.entries(s.bank).flatMap(([topicId, questions]) => questions.map((question) => ({ topicId, question })));
  const staysPut = (x: { topicId: string; question: QuizQuestion }) => !x.question.objectiveId || currentTopicOf(x.question.objectiveId, s.objectives, topicMergedInto) === x.topicId;
  return { ...s, bank: fileQuestions([...stored.filter(staysPut), ...stored.filter((x) => !staysPut(x))], s.objectives, topicMergedInto) };
}
```

Then:
- `mergeTopics`: drop the `bank` lines; `return refiled(next);`.
- `mergeObjectives`: `return refiled(withObjectives(s, [loserId], …));` (no `moveQuestions`).
- `restoreObjective`: drop the `moveQuestions` branch; `return refiled(withObjectives(next, [id], …));` with `next = s`.

`refiled` drops empty topics from `bank`; where an existing test asserts `bank[loser]` is `[]`, change it to `bank[loser] ?? []`. Update the header comment ("both can be undone (except a topic merge, which moves questions)") to say questions follow their objectives.

- [ ] **Step 4: Run to verify**

Run: `node --import ./tests/support/register.mjs --test tests/course/ops.test.ts tests/supabase/app-rows.test.ts`
Expected: PASS, including the existing "merging topics moves objectives and questions…", "merging objectives… moves questions across topics" and "undoing a merge restores the objective and its questions".

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npx eslint src/lib/course/ops.ts tests/course/ops.test.ts
git add src/lib/course/ops.ts tests/course/ops.test.ts
git -c user.name="Sophia Huh" -c user.email=sophiahuh@gmail.com commit -m "Merges re-file every question by its objective instead of moving the ones the browser knew about"
```

---

### Task 4: An answer event's topic is its objective's topic

**Files:**
- Modify: `src/app/api/evidence/route.ts:61-80`

`event.topicId` feeds per-topic stats (`/api/metrics`); it must not come from the stale column.

- [ ] **Step 1: Implement**

Replace the question read and the event's `topicId`:

```ts
      const { data: q, error } = await db
        .from("questions")
        .select("topic_id, objective_id, tier")
        .eq("owner_id", student.id)
        .eq("course_id", body.courseId)
        .eq("id", body.questionId)
        .maybeSingle();
      if (error) throw new Error(`Couldn't read the question: ${error.message}`);
      if (!q) return reply(404, { error: "No such question in this course." });
      if (!q.objective_id) return reply(422, { error: "This question isn't sorted into an objective yet, so its answer can't be recorded." });
      // The question's topic is its objective's (a question's own topic_id can be stale: 2026-10-26).
      const { data: objective, error: objectiveError } = await db.from("objectives").select("topic_id").eq("owner_id", student.id).eq("course_id", body.courseId).eq("id", q.objective_id).maybeSingle();
      if (objectiveError) throw new Error(`Couldn't read the question's objective: ${objectiveError.message}`);
      if (!objective) throw new Error(`Question ${body.questionId} points at objective ${q.objective_id}, which isn't in the course`);
```

and `topicId: objective.topic_id,` in the event. (The recorded objective is the question's own; the fold follows merges from it, as before.)

- [ ] **Step 2: Verify over HTTP**

```bash
npx tsc --noEmit && npx eslint src/app/api/evidence/route.ts
npm run locked -- npm run check:evidence
```

Expected: check:evidence passes.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/evidence/route.ts
git -c user.name="Sophia Huh" -c user.email=sophiahuh@gmail.com commit -m "An answer is recorded under its question's objective's topic, not the question's stored topic"
```

---

### Task 5: Check the hosted databases (owner; gates Task 6)

The agent's auto mode blocks reading hosted data. The owner runs this in each project's SQL editor (production `fbbimuspcsytjhbqlzzc`, development `mtztzsxgcopohlokragm`):

```sql
select count(*) filter (where objective_id is null) as without_objective, count(*) as questions from public.questions;
```

- [ ] Production: `without_objective` = 0
- [ ] Development: `without_objective` = 0

If either is above 0: stop. Those rows need the owner's decision (archive them, or attach them to an objective) before Task 6, and that decision goes in `docs/TO-DISCUSS.md`.

---

### Task 6: Every question has an objective; the unsorted bucket goes

**Files:**
- Create: `supabase/migrations/20261029090100_questions_need_objectives.sql`
- Modify: `src/lib/data.ts:351-352` (`QuizQuestion.objectiveId` required)
- Modify: `src/lib/mastery/catalogue.ts` (remove `unsortedObjectiveId`, `isUnsortedObjectiveId`, `objectiveIdOf`; `fileQuestions` no longer needs a stored topic)
- Modify: `src/lib/mastery/agenda.ts:76-84` (`withNeutralWeights` loses its `isUnsorted` parameter), `src/lib/store.tsx:63,932,972`
- Modify: `src/lib/supabase/app-rows.ts` (`questionFromRow`, `questionToRow`), `src/lib/supabase/rows.ts`
- Test: `tests/mastery/catalogue.test.ts`, `tests/mastery/agenda.test.ts`, `tests/mastery/attribution.test.ts`, `tests/mastery/course-mastery.test.ts`, `supabase/tests/03_*` (whichever pgTAP file covers questions; find with `grep -ln "insert into public.questions" supabase/tests`)

**Interfaces:**
- Produces: `QuizQuestion.objectiveId: string`; `fileQuestions(questions: ReadonlyArray<Q>, catalogue, topicMergedInto)` with `Q extends { id: string; objectiveId: string }` (the `{ topicId, question }` wrapper goes; update the three loaders from Task 2 and `refiled` from Task 3).

- [ ] **Step 1: Migration and its pgTAP test**

```sql
-- Every question tests one objective (2026-10-26): every generation path writes questions only for
-- objectives it was given, and the hosted databases had none without one (checked by the owner).
-- Fails, and changes nothing, if a question without an objective exists.
alter table public.questions alter column objective_id set not null;
```

pgTAP (bump that file's `plan`):

```sql
select throws_ok(format($$insert into public.questions (id, owner_id, course_id, topic_id, objective_id, kind, prompt) values (gen_random_uuid(), %L, %L, %L, null, 'Short answer', 'p')$$, :'A', :'course', :'topic'),
  '23502', null, 'a question needs an objective');
```

(Adapt the column list to that file's existing question inserts; `23502` is not_null_violation.)

- [ ] **Step 2: Types, then let `tsc` list every call site**

Make `objectiveId: string` in `QuizQuestion` (comment: "The objective this question tests; every question has one."). Run `npx tsc --noEmit`; fix each error by removing the optional handling (`q.objectiveId ?? …`, `...(q.objective_id ? …)`), never by inventing a fallback. `npm run db:types` (under `npm run locked --`) refreshes `database.types.ts` so `objective_id` is `string`.

- [ ] **Step 3: Remove the unsorted bucket**

Delete `unsortedObjectiveId`, `isUnsortedObjectiveId`, `objectiveIdOf`; in `objectivesForTopic` and `liveObjectiveOf` use `q.objectiveId` directly. `withNeutralWeights(objectiveIds, computed)` keeps the neutral 1.0 only for ids without a computed weight (keep throwing for anything else, as today). Remove the "Questions not yet sorted into objectives" label in `store.tsx`. Delete or rewrite the tests that exercise the bucket (`grep -n "unsorted" tests/mastery/*.ts`).

- [ ] **Step 4: Run**

```bash
npx tsc --noEmit && npm run lint
npm test
npm run locked -- npm run test:db
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A supabase src tests
git -c user.name="Sophia Huh" -c user.email=sophiahuh@gmail.com commit -m "Every question has an objective (not null); the unsorted bucket is gone"
```

---

### Task 7: Docs and the full gate

**Files:**
- Modify: `CLAUDE.md` (Product model: "Every question belongs to one objective" → add "and its topic is its objective's current topic"; remove nothing else)
- Modify: `.claude/skills/assessment/SKILL.md` (the first rule: drop the "unsorted" sentence; say a question's topic follows its objective)
- Modify: `docs/BACKEND-ROADMAP.md` (a dated decision line under the Phase 4 follow-ups: questions filed by objective, why, and that `questions.topic_id` is now only written, never read for filing; dropping it is a follow-up)

- [ ] **Step 1: Edit the three docs as above.**
- [ ] **Step 2: Merge gate** (CLAUDE.md "Merge or deploy gate")

```bash
npm test
npm run locked -- npm run test:db
npm run locked -- npm run test:e2e
npm run locked -- npm run check:isolation
npm run locked -- npm run check:evidence
```

Expected: all pass. Read a failing e2e trace before changing a test.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md .claude/skills/assessment/SKILL.md docs/BACKEND-ROADMAP.md
git -c user.name="Sophia Huh" -c user.email=sophiahuh@gmail.com commit -m "Docs: a question's topic is its objective's; every question has an objective"
```

## Follow-ups (not in this plan)

- Drop `questions.topic_id` (and `topic_name`) once nothing reads them: the FK, `questionToRow`, the e2e seeds and `database.types.ts` change together.
- Re-key the in-memory bank by objective instead of topic, if the topic-keyed index starts costing more than it saves.
