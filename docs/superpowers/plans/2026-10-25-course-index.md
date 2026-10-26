# Course Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uploads are mapped page by page through a table of contents (topics first, then one topic's objectives), every page of a file is read, and questions come from each objective's own pages.

**Architecture:** `topics.source` becomes a list of `{ materialId, from, to }` page ranges across uploads. `runUpload` splits a file into parts (~60,000 characters); per part a `map` call sees the part and the table of contents (built from topic rows, not stored), then one `objectives` call per topic touched sees only that topic's objectives and pages. Question writing goes through `pagesFor`, like top-ups.

**Tech Stack:** Next.js 16, TypeScript, zod, Supabase (Postgres), `node:test`, Playwright with the fake model API.

Spec: `docs/superpowers/specs/2026-10-25-course-index-design.md`.

## Global Constraints

- Branch `course-index` in `.claude/worktrees/course-index`; never commit to `phase-4` from here.
- Node: `export PATH=$HOME/.nvm/versions/node/v24.20.0/bin:$PATH`.
- Pure modules (`src/lib/pipeline`, `src/lib/course`, `src/lib/jobs`) keep relative `.ts` imports and `import type`.
- No length limits on model text (only URLs, HTML, links, instruction-like text are refused). No new dependency, no new table.
- Model sees file names, never material UUIDs.
- Per commit (Fix-mode checks): `npx tsc --noEmit`, `npx eslint <changed files>`, the unit test files touched. `npm run locked -- npm run test:db` only in Task 1 (migration). Browser specs once, in Task 4.
- Tests only where the spec lists them; no tests for prompt wording.

---

### Task 0: Check how production runs jobs (owner, no code)

- [ ] Ask the owner for production's `ORCA_JOBS` (Vercel → Settings → Environment Variables), or check production `pipeline_runs.job_id` (set only with Trigger.dev). If `inline`, note in the PR that long files need `ORCA_JOBS=trigger` (300 s request limit). Don't block the build on it.

---

### Task 1: Topics keep every page range they're taught on

**Files:**
- Create: `src/lib/course/places.ts`, `tests/course/places.test.ts`, `supabase/migrations/20261026090000_topic_source_places.sql`
- Modify: `src/lib/data.ts:39` (Topic.source), `src/lib/supabase/app-rows.ts` (topicToRow/topicFromRow), `src/lib/course/ops.ts` (mergeTopics), `src/lib/course/study.ts:51-67` (whereTaught), `src/lib/pipeline/topup.ts:78-90` (pagesFor), `src/lib/pipeline/run.ts:249` (new topic source), fixtures using `slideStart` in `e2e/fixture.ts`, `e2e/*.spec.ts`, `tests/**`; regenerate `src/lib/supabase/database.types.ts`.

**Interfaces (produced):**
```ts
// src/lib/data.ts
export interface TopicPlace { materialId: string; from: number; to: number }
// Topic.source: TopicPlace[]   (required; [] when unknown)

// src/lib/course/places.ts
export type PageRange = { from: number; to: number };
/** `places` with `ranges` in `materialId` added: overlapping or touching ranges merge; sorted per material. */
export function addRanges(places: readonly TopicPlace[], materialId: string, ranges: readonly PageRange[]): TopicPlace[];
/** Every place of both lists (a topic merge). */
export function unionPlaces(a: readonly TopicPlace[], b: readonly TopicPlace[]): TopicPlace[];
/** The page numbers `places` cover in one material. */
export function pagesIn(places: readonly TopicPlace[], materialId: string): Set<number>;
/** Contiguous ranges of a set of page numbers. */
export function toRanges(pages: Iterable<number>): PageRange[];
/** "L3.pdf p4–9, 14; HW2.pdf p1–2" (files the course no longer has are left out). */
export function describePlaces(places: readonly TopicPlace[], filenames: ReadonlyMap<string, string>): string;
```

- [ ] **Step 1: Test the range helpers** (`tests/course/places.test.ts`)

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { addRanges, describePlaces, pagesIn, toRanges, unionPlaces } from "../../src/lib/course/places.ts";

test("ranges in one material merge when they overlap or touch; other materials are kept apart", () => {
  const a = addRanges([], "m1", [{ from: 4, to: 6 }]);
  const b = addRanges(a, "m1", [{ from: 7, to: 9 }, { from: 14, to: 14 }]);
  const c = addRanges(b, "m2", [{ from: 1, to: 2 }]);
  assert.deepEqual(c, [{ materialId: "m1", from: 4, to: 9 }, { materialId: "m1", from: 14, to: 14 }, { materialId: "m2", from: 1, to: 2 }]);
  assert.deepEqual([...pagesIn(c, "m1")], [4, 5, 6, 7, 8, 9, 14]);
  assert.deepEqual(toRanges([3, 1, 2, 7]), [{ from: 1, to: 3 }, { from: 7, to: 7 }]);
  assert.deepEqual(unionPlaces(a, [{ materialId: "m1", from: 5, to: 8 }]), [{ materialId: "m1", from: 4, to: 8 }]);
  assert.equal(describePlaces(c, new Map([["m1", "L3.pdf"], ["m2", "HW2.pdf"]])), "L3.pdf p4–9, 14; HW2.pdf p1–2");
});
```

- [ ] **Step 2: Run it, see it fail** — `node --experimental-strip-types --import ./tests/support/register.mjs --test tests/course/places.test.ts` → module not found.

- [ ] **Step 3: Write `src/lib/course/places.ts`**

```ts
/** Where a topic is taught: page ranges per material, across uploads (`topics.source`). Pure. */
import type { TopicPlace } from "../data.ts";

export type PageRange = { from: number; to: number };

export function toRanges(pages: Iterable<number>): PageRange[] {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const out: PageRange[] = [];
  for (const n of sorted) {
    const last = out.at(-1);
    if (last && n <= last.to + 1) last.to = Math.max(last.to, n);
    else out.push({ from: n, to: n });
  }
  return out;
}

export function pagesIn(places: readonly TopicPlace[], materialId: string): Set<number> {
  const out = new Set<number>();
  for (const p of places) if (p.materialId === materialId) for (let n = p.from; n <= p.to; n++) out.add(n);
  return out;
}

export function addRanges(places: readonly TopicPlace[], materialId: string, ranges: readonly PageRange[]): TopicPlace[] {
  const pages = pagesIn(places, materialId);
  for (const r of ranges) for (let n = Math.min(r.from, r.to); n <= Math.max(r.from, r.to); n++) pages.add(n);
  return [...places.filter((p) => p.materialId !== materialId), ...toRanges(pages).map((r) => ({ materialId, ...r }))].sort(
    (a, b) => order(places, a.materialId) - order(places, b.materialId) || a.from - b.from,
  );
}

/** Materials keep the order they first appear in (a new one goes last). */
function order(places: readonly TopicPlace[], materialId: string): number {
  const i = places.findIndex((p) => p.materialId === materialId);
  return i === -1 ? places.length : i;
}

export function unionPlaces(a: readonly TopicPlace[], b: readonly TopicPlace[]): TopicPlace[] {
  let out = [...a];
  for (const p of b) out = addRanges(out, p.materialId, [{ from: p.from, to: p.to }]);
  return out;
}

export function describePlaces(places: readonly TopicPlace[], filenames: ReadonlyMap<string, string>): string {
  const byMaterial = new Map<string, string[]>();
  for (const p of places) {
    if (!filenames.has(p.materialId)) continue;
    byMaterial.set(p.materialId, [...(byMaterial.get(p.materialId) ?? []), p.from === p.to ? `${p.from}` : `${p.from}–${p.to}`]);
  }
  return [...byMaterial].map(([id, rs]) => `${filenames.get(id)} p${rs.join(", ")}`).join("; ");
}
```

- [ ] **Step 4: Run the test, see it pass.**

- [ ] **Step 5: Migration** `supabase/migrations/20261026090000_topic_source_places.sql`

```sql
-- topics.source: every page range a topic is taught on, across uploads (2026-10-26), as
-- [{ materialId, from, to }]. The old single range { filename, slideStart, slideEnd } came from the
-- upload that created the topic, which is its material_id.
update public.topics set source = case
  when source is null or material_id is null or jsonb_typeof(source) <> 'object' then '[]'::jsonb
  else jsonb_build_array(jsonb_build_object(
    'materialId', material_id,
    'from', (source ->> 'slideStart')::integer,
    'to', greatest((source ->> 'slideStart')::integer, (source ->> 'slideEnd')::integer)))
end;
alter table public.topics alter column source set default '[]'::jsonb;
alter table public.topics alter column source set not null;
alter table public.topics add constraint topics_source_is_array check (jsonb_typeof(source) = 'array');
```

Check the conversion once by hand before relying on it (no pgTAP test):
`psql "$(npx supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" -c "select case when jsonb_typeof(s)='object' then jsonb_build_array(jsonb_build_object('materialId','m','from',(s->>'slideStart')::int,'to',greatest((s->>'slideStart')::int,(s->>'slideEnd')::int))) end from (select '{\"filename\":\"L1.pdf\",\"slideStart\":4,\"slideEnd\":9}'::jsonb s) x"` → `[{"materialId":"m","from":4,"to":9}]`.

- [ ] **Step 6: Code that reads or writes `source`**
  - `data.ts`: `source: TopicPlace[]` (remove `?`), export `TopicPlace`.
  - `app-rows.ts`: `source: jsonValue(t.source)`; read `source: r.source as unknown as TopicPlace[]`.
  - `ops.ts` `mergeTopics`: survivor gets `source: unionPlaces(survivor.source, loser.source)`.
  - `study.ts` `whereTaught` fallback (no objective places): for each material in `topic.source` with a filename in `materials`, push `{ filename, where: slideRanges(ranges as "slide N" / "slides A–B" locators) }` — reuse `slideRanges` by passing `["slide 4", …]` built from `pagesIn`.
  - `topup.ts` `pagesFor` fallback: `if (wanted.size === 0 && topic) for (const n of pagesIn(topic.source, material.id)) wanted.add(n);`
  - `run.ts:249` (until Task 3 replaces it): `source: addRanges([], input.material.id, [{ from: t.slideStart, to: Math.max(t.slideStart, t.slideEnd) }])`.
  - Fixtures: replace `source: { filename, slideStart, slideEnd }` with `source: [{ materialId, from, to }]`; topics without a source get `source: []`.

- [ ] **Step 7: Check and commit**

```bash
npm run locked -- npm run db:types   # resets local DB with the migration, regenerates types
npm run locked -- npm run test:db
npx tsc --noEmit && npx eslint <changed files> && npm test
git add -A src tests e2e supabase && git commit -m "Topics keep every page range they're taught on: topics.source is [{ materialId, from, to }] across uploads (migration converts the old single range); merges union them; whereTaught and pagesFor read them"
```

---

### Task 2: The `map` and `objectives` steps

**Files:**
- Modify: `src/lib/pipeline/schemas.ts` (new input/output schemas, `STEPS`), `src/lib/pipeline/prompts.ts` (`mapPrompt`, `objectivesPrompt`, `buildPrompt`), `src/lib/pipeline/budget.ts`, `e2e/fake-anthropic.ts`
- Create: `tests/support/extract-scenario.ts` (shared by unit tests and the fake API)

**Interfaces (produced):**
```ts
// schemas.ts
export const MapInput = z.object({
  course: Course,
  material: z.object({ filename: z.string(), type: MaterialType }),
  pages: z.array(Page).min(1),                 // this part's pages only
  part: z.object({ index: z.number().int().min(1), count: z.number().int().min(1) }),
  toc: z.array(z.object({ id: z.string(), name: z.string(), summary: z.string(), objectives: z.number().int(), taught: z.string(), rejected: z.boolean() })),
});
export const MapOutput = z.object({
  topics: z.array(z.object({
    localId: z.string().max(60).describe("Your own short id for a new topic, e.g. 't1'. For an existing topic, repeat its id."),
    existingId: z.string().max(60).nullable().describe("The id of the existing topic these pages teach, or null for a new one"),
    name: z.string().min(1),
    summary: z.string(),
    pages: z.array(z.object({ from: z.number().int().min(1), to: z.number().int().min(1) })).min(1).describe("Every run of pages in this part that teaches it"),
  })),
  relations: /* exactly ExtractOutput's relations array */,
  instructionsFound: /* exactly ExtractOutput's instructionsFound */,
});
export const ObjectivesInput = z.object({
  course: Course,
  material: z.object({ filename: z.string(), type: MaterialType }),
  pages: z.array(Page).min(1),                 // this topic's pages in this part
  topic: z.object({ id: z.string(), name: z.string(), summary: z.string() }),
  existingObjectives: z.array(Named),          // this topic's objectives only (Named = id, name, description, rejected)
});
export const ObjectivesOutput = z.object({
  objectives: z.array(/* ExtractOutput's objective object without `topicRef` */),
});
// STEPS gains: map: { input: MapInput, output: MapOutput }, objectives: { input: ObjectivesInput, output: ObjectivesOutput }
// budget.ts: map: { effort: "medium", maxTokens: 16000 }, objectives: { effort: "medium", maxTokens: 16000 }

// tests/support/extract-scenario.ts — answers both steps from one ExtractOutput-shaped scenario
export function mapAnswer(scenario: Partial<ExtractOutput>, input: StepInput<"map">): StepOutput<"map">;
export function objectivesAnswer(scenario: Partial<ExtractOutput>, input: StepInput<"objectives">): StepOutput<"objectives">;
```

- [ ] **Step 1: Schemas.** Add the four schemas above (reuse `ExtractAnchor`, the relations and objective object shapes from `ExtractOutput` by pulling them into named consts, e.g. `const ExtractedObjective = z.object({...})`, `ExtractOutput` keeps `topicRef` via `ExtractedObjective.extend({ topicRef })` until Task 3 removes it). Add both to `STEPS`, both to `STEP_BUDGET`.

- [ ] **Step 2: Prompts.** In `prompts.ts`:
  - `mapPrompt(input)`: system text starts with a new first line the fake can recognise, `"You map part of one piece of college course material onto a course's topics"`, then `UNTRUSTED_POLICY`, `MATERIAL_RULES`, and the **topic** rules now in `extractPrompt` (topic definition, scale/~200 topics, the Data Structures / Calculus / Computer Systems examples, headings and curriculum-list evidence, broader topic and subtype, cover everything, short names and one-or-two-sentence summaries, plain text), links rules (`LINK_RULES`), reuse first and never propose `rejectedByStudent`, and: "Give each topic every run of pages in this part that teaches it; a page may teach more than one topic." `context: materialContext({ course, material, pages })` (the part). Prompt: `TYPE_RULES[type]`, the AI-chat rules, "This is part {index} of {count} of the file.", and the table of contents as a data block (`untrustedBlock("generated_question", toc)` with `rejected` shown as `rejectedByStudent`).
  - `objectivesPrompt(input)`: first line `"You list the skills one topic of college course material teaches"`, `UNTRUSTED_POLICY`, `MATERIAL_RULES`, and the **objective** rules now in `extractPrompt` (objective definition, split/fold, grain with the K-map example, places, inferred, emphasis, plain text), reuse first for this topic's existing objectives and never propose `rejectedByStudent`. `context: materialContext({ course, material, pages })` (the topic's pages). Prompt: `TYPE_RULES[type]`, the topic (name, summary), its existing objectives as a data block.
  - `buildPrompt`: cases `"map"`, `"objectives"`.
  - Remove `materialContext`'s `MAX_CONTEXT_CHARS` filter (parts keep each call small).

- [ ] **Step 3: Scenario helper** `tests/support/extract-scenario.ts`

```ts
/** Answers the map and objectives steps from one extract-shaped scenario (unit tests and e2e/fake-anthropic.ts). Pure. */
import type { ExtractOutput, StepInput, StepOutput } from "../../src/lib/pipeline/schemas.ts";

type Scenario = Partial<ExtractOutput>;

export function mapAnswer(s: Scenario, input: StepInput<"map">): StepOutput<"map"> {
  const pages = new Set(input.pages.map((p) => p.n));
  const topics = (s.topics ?? [])
    .map((t) => ({ ...t, from: Math.max(t.slideStart, Math.min(...pages)), to: Math.min(Math.max(t.slideStart, t.slideEnd), Math.max(...pages)) }))
    .filter((t) => t.from <= t.to)
    .map((t) => ({ localId: t.localId, existingId: t.existingId, name: t.name, summary: t.summary, pages: [{ from: t.from, to: t.to }] }));
  // A scenario's relations and instructions are reported once, with the first part.
  return { topics, relations: input.part.index === 1 ? (s.relations ?? []) : [], instructionsFound: input.part.index === 1 ? (s.instructionsFound ?? []) : [] };
}

export function objectivesAnswer(s: Scenario, input: StepInput<"objectives">): StepOutput<"objectives"> {
  // The topic is named by its existing id, or (new) by its name, so match the scenario's refs to either.
  const refs = new Set([input.topic.id, ...(s.topics ?? []).filter((t) => t.name === input.topic.name).map((t) => t.localId)]);
  return { objectives: (s.objectives ?? []).filter((o) => refs.has(o.topicRef)).map(({ topicRef: _, ...o }) => o) };
}
```

- [ ] **Step 4: Fake API.** In `e2e/fake-anthropic.ts`: add the two first lines to the step table; read the step's input from its data blocks the way `generate` does (the part's pages from `uploaded_pdf`, the toc / topic from `generated_question`), and answer with `mapAnswer(scenario.extract ?? {}, …)` / `objectivesAnswer(…)` imported from `../tests/support/extract-scenario.ts`. Keep the `extract` case until Task 3.

- [ ] **Step 5: Check and commit**

```bash
npx tsc --noEmit && npx eslint src/lib/pipeline/schemas.ts src/lib/pipeline/prompts.ts src/lib/pipeline/budget.ts e2e/fake-anthropic.ts tests/support/extract-scenario.ts && npm test
git add -A src e2e tests && git commit -m "map and objectives steps: map reads one part of a file against the course's table of contents (topics with where they're taught), objectives reads one topic's objectives and pages; the fake API answers both from the same scenario"
```

---

### Task 3: `runUpload` maps a file part by part

**Files:**
- Modify: `src/lib/pipeline/run.ts` (`runUpload`, `UploadPlan`, `RunInput`, `Progress`), `src/lib/pipeline/apply.ts`, `src/lib/pipeline/progress-text.ts`, `src/lib/jobs/jobs.ts:154` (pass `materials`), `scripts/score-extraction.ts` (pass `materials`), `tests/pipeline/run.test.ts`, `src/lib/pipeline/schemas.ts` + `prompts.ts` + `e2e/fake-anthropic.ts` (remove `extract`)

**Interfaces:**
- Consumes: Task 1 `addRanges`, `pagesIn`, `toRanges`, `describePlaces`; Task 2 `map` / `objectives` steps.
- Produces:
```ts
// run.ts
export const PART_CHARS = 60_000;
/** Consecutive pages up to PART_CHARS of text each; a page is never split; a page over the budget is a part of its own. */
export function splitParts(pages: ReadonlyArray<{ n: number; text: string }>, maxChars = PART_CHARS): Array<Array<{ n: number; text: string }>>;
// RunInput gains: materials: ReadonlyArray<{ id: string; filename: string }>  (the course's, for the table of contents)
// UploadPlan gains: topicSources: Record<string, TopicPlace[]>  (existing topics' new source lists)
// Progress gains: { stage: "mapping"; part: number; parts: number; from: number; to: number } and { stage: "objectives"; topic: string }
```

- [ ] **Step 1: Tests first** (`tests/pipeline/run.test.ts`). Switch the file's fake model from `extract:` handlers to `map: (i) => mapAnswer(fixture, i), objectives: (i) => objectivesAnswer(fixture, i)` (keep the existing fixtures; give `input()` a `materials: [{ id: "mat", filename: "L02.pdf" }]`). Add:

```ts
test("a long file is mapped part by part: every page is read once, and a topic running across parts is extended, not made twice", async () => {
  const long = Array.from({ length: 30 }, (_, i) => ({ n: i + 1, text: "x".repeat(5000) }));   // 150,000 chars → 3 parts
  const scenario: ExtractOutput = { topics: [{ localId: "t1", existingId: null, name: "Heaps", summary: "s", slideStart: 1, slideEnd: 30 }], objectives: [{ localId: "o1", existingId: null, topicRef: "t1", name: "Insert into a heap", description: "", origin: "material", places: [{ locator: "slide 2", excerpt: "e" }], emphasis: null }], relations: [], instructionsFound: [] };
  const seen: number[][] = [];
  const model = fakeModel({ map: (i) => (seen.push(i.pages.map((p) => p.n)), mapAnswer(scenario, i)), objectives: (i) => objectivesAnswer(scenario, i), generate: () => ({ questions: [] }) });
  const plan = await runUpload(input({ pages: long }), { call: model.call, newId });
  assert.deepEqual(seen.flat(), long.map((p) => p.n));
  assert.equal(seen.length, 3);
  assert.equal(plan.newTopics.length, 1);
  assert.deepEqual(plan.newTopics[0].source, [{ materialId: "mat", from: 1, to: 30 }]);
});

test("an objectives call gets only its topic's objectives and pages", async () => { /* existing topics T1 (pages 1–2) and T2 (pages 3–4) with objectives each; scenario touches T1 only; assert the one objectives call has topic.id "T1", existingObjectives = T1's, pages = [1, 2] */ });

test("a part that can't be mapped is listed with its pages and the rest of the file is kept", async () => { /* 2 parts; map throws for part 2; assert dropped has `Pages 7–12` with "couldn't be mapped", part 1's topic is kept */ });

test("upload questions are written from each objective's own pages", async () => { /* 10-page file, objective places "slide 7"; assert the generate call's pages are [6, 7, 8] */ });
```

Write the three stubs out in full when implementing (same fixtures style as the first). Run: `node --experimental-strip-types --import ./tests/support/register.mjs --test tests/pipeline/run.test.ts` → new tests fail.

- [ ] **Step 2: Rewrite `runUpload`'s structure half.** Keep sections 2–4's logic (validators, `resolve`, twins, `topicIdOf`, relation checks) but run them per part:

```ts
const filenames = new Map(input.materials.map((m) => [m.id, m.filename]));
const parts = splitParts(input.pages);
const topicSources: Record<string, TopicPlace[]> = {};        // existing topics touched
const sourceOf = (id: string) => newTopics.find((t) => t.id === id)?.source ?? topicSources[id] ?? input.course.topics.find((t) => t.id === id)!.source;
for (const [i, part] of parts.entries()) {
  progress({ stage: "mapping", part: i + 1, parts: parts.length, from: part[0].n, to: part.at(-1)!.n });
  const toc = [...input.course.topics.filter((t) => !t.mergedInto), ...newTopics].map((t) => ({
    id: t.id, name: t.name, summary: t.summary ?? "", rejected: t.review === "archived",
    objectives: [...Object.values(input.objectives), ...newObjectives].filter((o) => o.topicId === t.id && o.review !== "archived").length,
    taught: describePlaces(sourceOf(t.id), filenames),
  }));
  let mapped: MapOutput;
  try { mapped = await call("map", { course, material, pages: part, part: { index: i + 1, count: parts.length }, toc }); }
  catch (e) { dropped.push({ prompt: `Pages ${part[0].n}–${part.at(-1)!.n}`, reason: `couldn't be mapped: ${errorText(e)}` }); continue; }
  // topics: validate, resolve against existing + earlier parts' new topics (same code as today), then
  //   new → push Topic with source addRanges([], material.id, t.pages)
  //   existing → topicSources[id] = addRanges(sourceOf(id), material.id, t.pages)
  //   twin (same name earlier in this upload) → extend that new topic's source
  // relations: resolve this part's refs now (localIds are per part) into `relations`, same checks as today
  // objectives, per live topic this part touched, 4 at a time:
  //   progress({ stage: "objectives", topic: topic.name })
  //   pages = part.filter((p) => pagesIn(rangesThisPart, material.id).has(p.n))
  //   existingObjectives = objectives of that topic (input + this upload's new ones), listed as today
  //   call("objectives", …) in try/catch → dropped `Objectives for "<topic>"` couldn't be found
  //   then today's objective code with topicId fixed to this topic, resolve() against that topic's objectives only
}
```

Remove the single `extract` call. `materialScreen` stays over all pages, `instructionsFound` collects from every part, and the link step (section 4b) runs once after the last part, unchanged.

- [ ] **Step 3: Questions from their own pages.** Replace the single `writeQuestions` call over `input.pages` with targets grouped by the pages `pagesFor(o, topicOf(o), input.material, input.pages)` returns (fall back to the topic's pages in this file for inferred objectives — `pagesFor` already does via `topic.source` after Task 1; pass topics with this upload's sources applied). One `writeQuestions` per group of objectives sharing a page set is fine; simplest: group by topic, union the topic's objectives' pages.

- [ ] **Step 4: Wire through.** `apply.ts`: `topics: [...s.topics.map((t) => (plan.topicSources[t.id] ? { ...t, source: plan.topicSources[t.id] } : t)), ...plan.newTopics]`. `jobs.ts`: pass `materials: (await store.materials(run.courseId)).map(({ id, filename }) => ({ id, filename }))` (reuse the list already loaded at line 127). `scripts/score-extraction.ts`: pass `materials` with the decks uploaded so far. `progress-text.ts`: `"mapping"` with a part → `Mapping pages ${from}–${to} (part ${part} of ${parts})…`, without → today's text; `"objectives"` → `Finding objectives in ${topic}…`.

- [ ] **Step 5: Remove `extract`.** Delete `ExtractInput`/`ExtractOutput` from `STEPS` and `buildPrompt`, `extractPrompt`, its budget, the fake's `extract` case (the scenario key stays `extract` so specs don't change). Keep the `ExtractOutput` type only if the scenario helper and tests still use it as the scenario shape (rename to `ExtractScenario` in `tests/support/extract-scenario.ts` if it no longer lives in schemas).

- [ ] **Step 6: Check and commit**

```bash
npx tsc --noEmit && npx eslint src/lib/pipeline src/lib/jobs/jobs.ts scripts/score-extraction.ts tests/pipeline/run.test.ts e2e/fake-anthropic.ts && npm test
git add -A src tests e2e scripts && git commit -m "Uploads are mapped part by part through the table of contents: a map call per ~60,000 characters of pages, then an objectives call per topic touched with only that topic's objectives and pages; a part or topic that fails is listed and the rest kept; questions are written from each objective's own pages; the extract step is gone"
```

---

### Task 4: Browser check, docs, push

- [ ] Run the specs that upload or seed topics: `npm run locked -- npx playwright test e2e/upload.spec.ts e2e/review.spec.ts e2e/injection.spec.ts e2e/cost-guard.spec.ts` (needs port 3000 free or the `SCRATCH_DIST` trick in CLAUDE.md). Fix what they find.
- [ ] Docs, briefly: `CLAUDE.md` (pipeline line: "extract" → "map + objectives, part by part through the table of contents"; `topics.source` shape), `docs/BACKEND-ROADMAP.md` (one paragraph under 2026-10-25/26 decisions: course index, link to the spec), spec status line → "built".
- [ ] Commit (`Docs: course index`), push `course-index` (`git push -u origin course-index`), open a PR into `phase-4` with Task 0's finding in the description.
