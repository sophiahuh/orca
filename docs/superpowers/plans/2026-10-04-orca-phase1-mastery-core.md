# Orca Phase 1: Mastery Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hand-set topic statuses with learner state derived from an append-only evidence log (objective → topic → island), remove the in-app AI chat, and show each course's mastery level on its island. Everything stays on-device (localStorage).

**Architecture:** Every quiz answer appends an `EvidenceEvent` to the store. Pure functions in `src/lib/mastery/` turn events + the clock into objective states (`docs/MASTERY-PLAN.md` §2.3–2.5), topic progress and an island level. Screens read those through one hook, `useMasteryByCourse()`. Built-in ALD questions are tagged with objectives from a catalogue in `src/lib/content/ald-objectives.ts`. Context: `docs/BACKEND-ROADMAP.md` (why), `docs/TO-DISCUSS.md` (what's provisional).

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v4, `motion`. Tests: `node:test` with Node's built-in TypeScript type stripping (no new dependency).

## Global Constraints

- Node ≥ 22.6. On this machine the default `node` is v16 (nvm). In every shell run `export PATH=/usr/local/bin:$PATH` (Node 22.13), or `nvm install 22 && nvm use`.
- No new npm dependencies in this phase.
- Pure modules (`src/lib/mastery/*.ts`, `src/lib/content/ald-objectives.ts`, `src/lib/content/ald.ts`) import each other with relative paths ending in `.ts`, use `import type` for anything type-only, and never use the `@/` alias, enums or namespaces. This is what lets `npm test` run them without a build step.
- Learner state is never written directly. Only `recordEvidence` changes it; everything else is computed.
- No silent placeholders: a missing value throws or renders an explicit empty state. Never invent a stand-in.
- Colors only from tokens (`globals.css`); animation presets only from `src/lib/motion.ts`; pixel values from Figma inline are fine.
- Work on branch `backend-implementation`. Commit at the end of every task. Do not push.
- Before every commit: `npx tsc --noEmit`, `npm run lint`, `npm test` all pass. Run `npx next typegen` once before the first `tsc` (it generates the `PageProps` types).

---

### Task 1: Tooling and guardrails

**Files:**
- Create: `.nvmrc`, `tests/grading.test.ts`, `.claude/settings.json`, `.claude/skills/learner-evidence/SKILL.md`, `.claude/skills/assessment/SKILL.md`
- Modify: `package.json` (scripts), `tsconfig.json`, `CLAUDE.md` (new Invariants section)

**Interfaces:**
- Produces: `npm test` runs every `tests/**/*.test.ts` in UTC.

- [ ] **Step 1: Branch and install**

```bash
export PATH=/usr/local/bin:$PATH
git checkout backend-implementation
node --version   # expect v22.x
npm install
npx next typegen
```

- [ ] **Step 2: Pin Node and add the test script**

`.nvmrc`:
```
22
```

In `package.json` `scripts`, add after `"lint"`:
```json
"test": "TZ=UTC node --experimental-strip-types --test \"tests/**/*.test.ts\""
```

In `tsconfig.json` `compilerOptions`, add after `"noEmit": true,`:
```json
"allowImportingTsExtensions": true,
```

- [ ] **Step 3: Write a first test against existing code**

`tests/grading.test.ts`:
```ts
import test from "node:test";
import assert from "node:assert/strict";
import { gradeExact, normaliseExact } from "../src/lib/grading.ts";

test("normaliseExact ignores case, spacing, middle dots and a trailing period", () => {
  assert.equal(normaliseExact(" X1 · X2' . "), "x1x2'");
});

test("gradeExact accepts an equivalent spelling and rejects a different answer", () => {
  assert.equal(gradeExact("1010", ["1010"]).outcome, "correct");
  const wrong = gradeExact("1011", ["1010"]);
  assert.equal(wrong.outcome, "incorrect");
  assert.match(wrong.feedback, /1010/);
});
```

- [ ] **Step 4: Run it**

Run: `npm test`
Expected: `# pass 2`, `# fail 0` (an `ExperimentalWarning` about type stripping is normal).

- [ ] **Step 5: Confirm the invariants are in CLAUDE.md**

`CLAUDE.md` already has an `## Invariants (ported from ai-native-learning-platform)` section (added
with the docs update on 2026-10-04). Check it contains the points below; add any that are missing.
For reference, the intended content:
```markdown
## Invariants (ported from ai-native-learning-platform)

- Learner state is derived. Every answer appends an `EvidenceEvent`; objective state, topic progress
  and island level are computed from events and the clock. Never store or write mastery directly.
- Exposure is not mastery. Uploads, reading and connector signals may raise priority; only scored
  answers count toward mastery, and self-marked answers count half.
- Check exactly when the domain allows (bit strings, numbers, Boolean expressions by truth table).
  Use a model grader only with a structured rubric.
- Course-specific questions carry a source anchor into the course material.
- No silent placeholders: a fallback or unknown value must never look like a computed one. Throw, or
  show an explicit empty or unknown state. This applies to existing code you touch.
- When live credentials exist (Supabase, Anthropic), run the live check. A typecheck around a live
  dependency is not the same claim.
- Don't add a dependency when an existing one solves the problem. Don't add a persistence layer
  without recording why in `docs/BACKEND-ROADMAP.md`.
- Pure domain modules (`src/lib/mastery/`, content catalogues) use relative imports ending in `.ts`
  and `import type`, so `npm test` runs them with Node's type stripping.
- Plans and roadmap: `docs/BACKEND-ROADMAP.md`; open questions: `docs/TO-DISCUSS.md`.
```

- [ ] **Step 6: Add the two skills and the typecheck hook**

`.claude/skills/learner-evidence/SKILL.md`:
```markdown
---
name: learner-evidence
description: Use when changing evidence events, objective state, mastery rules, topic progress, island levels, or anything that records a student's answer.
---

# Learner evidence

The model is in `docs/MASTERY-PLAN.md`; the code is `src/lib/mastery/`.

## Rules

- Answers append `EvidenceEvent`s. Nothing else changes learner state. Never add a field that
  stores mastery, status or progress; compute it from events + now.
- Course structure (topics, objectives, questions) and learner state stay separate. Never put
  per-student state on a topic, objective or question record.
- A grading failure is not evidence. If an answer couldn't be graded, record nothing.
- Self-marked answers (`grader: "self"`) count half and never clear a mix-up.
- Connector, upload and reading signals may raise priority later; they never produce mastery.
- Every rule change goes in `MASTERY_RULES` and gets a test in `tests/mastery/`.
- Provisional numbers (island thresholds, mix-up clearing) are listed in `docs/TO-DISCUSS.md`;
  update that file when you touch them.
```

`.claude/skills/assessment/SKILL.md`:
```markdown
---
name: assessment
description: Use when building or changing question generation, question validation, grading, or the quiz flow that records answers.
---

# Assessment

## Rules

- Every question belongs to one objective (`objectiveId`). Built-in content maps questions to
  objectives in a catalogue (`src/lib/content/ald-objectives.ts`); a question with no objective
  falls into its topic's explicit "unsorted" objective, never a guessed one.
- Prefer exact checkers (bit strings, numbers, Boolean expressions by truth table). Model grading
  needs a structured rubric (`requiredIdeas`, `acceptableAlternatives`, `knownMisconceptions`).
- Course-specific questions carry a source anchor (`anchor.locator`, `anchor.excerpt`).
- Generated questions must not copy the source verbatim, and pass an ambiguity check before a
  student sees them (Phase 2 ports the platform's check).
- The quiz records evidence only after grading finishes. A grading error records nothing.
- Never show a placeholder question. A topic with no questions shows an empty state that points
  to adding material.
```

`.claude/settings.json`:
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '.tool_input.file_path // .tool_response.filePath' | { read -r f; case \"$f\" in *src/*.ts|*src/*.tsx) PATH=/usr/local/bin:$PATH npx tsc --noEmit ;; esac; } 2>/dev/null || true",
            "statusMessage": "Typechecking..."
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 7: Verify and commit**

```bash
npx tsc --noEmit && npm run lint && npm test
git add .nvmrc package.json package-lock.json tsconfig.json tests/grading.test.ts CLAUDE.md .claude
git commit -m "Tooling: node:test runner on Node 22, ported invariants, learner-evidence and assessment skills, typecheck hook"
```

---

### Task 2: Remove the AI chat

**Files:**
- Delete: `src/app/chat/page.tsx`, `src/app/api/chat/route.ts`, `src/components/chat/ChatBubble.tsx`
- Modify: `src/components/layout/NavBar.tsx`, `src/components/icons.tsx`, `src/lib/llm.ts`, `src/lib/llm-server.ts`, `src/components/settings/YourAI.tsx:21`, `src/components/ui/Chip.tsx:36`

**Interfaces:**
- Produces: no `/chat` route. `compatChat` and `ChatTurn` stay (extraction and grading use them).

- [ ] **Step 1: Delete the chat files**

```bash
git rm src/app/chat/page.tsx src/app/api/chat/route.ts src/components/chat/ChatBubble.tsx
```

- [ ] **Step 2: Drop the nav entry**

In `src/components/layout/NavBar.tsx`, replace the import and `ITEMS`:
```tsx
import { IconCalendar, IconGear, IconUpload } from "@/components/icons";
import { cn } from "@/lib/cn";

const ITEMS = [
  { href: "/calendar", label: "Calendar", Icon: IconCalendar },
  { href: "/add-material", label: "Add material", Icon: IconUpload },
  { href: "/settings", label: "Configurations", Icon: IconGear },
] as const;

/** Three-icon nav pinned to the bottom of the sidebar. */
```
Delete the `IconChat` function from `src/components/icons.tsx`.

- [ ] **Step 3: Remove chat-only helpers**

In `src/lib/llm.ts` delete `ChatCourseContext`, `SYSTEM_BASE`, `systemFor` and `cannedReply`. Keep `ChatTurn`, `compatChat` and everything else.

In `src/lib/llm-server.ts` delete `completeChat` and `anthropicChat`, and remove `ChatCourseContext` and `systemFor` from the import on line 9. Then run `npx tsc --noEmit && npm run lint`; if `EFFORT_MODELS` or `FALLBACK_MODELS` are reported unused, delete them too. Do not delete anything `/api/extract`, `/api/grade` or `/api/llm/*` still use.

- [ ] **Step 4: Fix comments that mention chat**

- `src/components/settings/YourAI.tsx:21` → ` * The key is kept in this browser only and sent with each extraction or grading request.`
- `src/components/ui/Chip.tsx:36` → `/** Small context pill, e.g. the "ALD" badge top-right of Add Material. */`

- [ ] **Step 5: Verify nothing still points at chat**

Run: `grep -rn "/chat\|ChatBubble\|IconChat\|completeChat\|cannedReply" src`
Expected: no output.

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add -A src
git commit -m "Remove the in-app AI chat: /chat, /api/chat, ChatBubble, nav entry and chat-only prompt helpers"
```

---

### Task 3: Objective catalogue for ALD

**Files:**
- Create: `src/lib/mastery/types.ts`, `src/lib/mastery/catalogue.ts`, `src/lib/content/ald-objectives.ts`, `tests/content/ald-objectives.test.ts`, `tests/mastery/catalogue.test.ts`
- Modify: `src/lib/data.ts` (`QuizQuestion`), `src/lib/content/ald.ts` (bank builder)

**Interfaces:**
- Produces:
  - `types.ts`: `Outcome`, `Grader`, `EvidenceSource`, `EvidenceEvent`, `ObjectiveInfo`, `ObjectiveStatus`, `ObjectiveState` (exact shapes below)
  - `catalogue.ts`: `unsortedObjectiveId(topicId: string): string`, `objectiveIdOf(q: { objectiveId?: string }, topicId: string): string`, `objectivesForTopic(topicId: string, questions: readonly QuestionRef[], catalogue: Readonly<Record<string, ObjectiveInfo>>): TopicObjective[]`, `interface TopicObjective extends ObjectiveInfo { hasMechanismQuestions: boolean; questionIds: string[] }`, `type QuestionRef = Pick<QuizQuestion, "id" | "objectiveId" | "tier">`
  - `ald-objectives.ts`: `ALD_OBJECTIVES: Record<string, ObjectiveInfo>`, `ALD_QUESTION_OBJECTIVE: Record<string, string>`
  - `QuizQuestion.objectiveId?: string`

- [ ] **Step 1: Write the types**

`src/lib/mastery/types.ts`:
```ts
/**
 * Learner-evidence types. Evidence is append-only; every learner-facing state
 * (objective status, topic progress, island level) is computed from it.
 */
import type { QuestionTier } from "../data.ts";

export type Outcome = "correct" | "partial" | "incorrect";

/** How an answer was judged. "self" = the student marked it without a grader; it counts as assisted. */
export type Grader = "choice" | "exact" | "rubric" | "self";

/** Where the answer happened. Later phases add deep review, exam review, drills and the connector. */
export type EvidenceSource = "quiz";

export interface EvidenceEvent {
  id: string;
  /** ISO timestamp. */
  at: string;
  courseId: string;
  topicId: string;
  objectiveId: string;
  questionId: string;
  tier: QuestionTier | null;
  outcome: Outcome;
  grader: Grader;
  source: EvidenceSource;
}

/** A "can do X" statement. Questions belong to exactly one. */
export interface ObjectiveInfo {
  id: string;
  topicId: string;
  name: string;
}

export type ObjectiveStatus = "unseen" | "learning" | "mixed-up" | "mastered" | "fading" | "retired";

export interface ObjectiveState {
  objectiveId: string;
  status: ObjectiveStatus;
  /** Credit toward mastery: 1 per first-try unaided correct question, 0.5 for self-marked or partial. */
  credit: number;
  /** Distinct calendar days on which credit was earned. */
  creditDays: number;
  /** Days until the next spaced check is due; null until mastered. */
  stabilityDays: number | null;
  /** ISO time the next spaced check is due; null until mastered. */
  dueAt: string | null;
  /** Successful unaided checks made at or after their due time. */
  spacedChecks: number;
  lastEvidenceAt: string | null;
}
```

- [ ] **Step 2: Add `objectiveId` to questions**

In `src/lib/data.ts`, inside `interface QuizQuestion`, after `tier?: QuestionTier;` add:
```ts
  /** The objective this question tests. Missing on generated questions until extraction assigns one. */
  objectiveId?: string;
```

- [ ] **Step 3: Write the failing tests**

`tests/content/ald-objectives.test.ts`:
```ts
import test from "node:test";
import assert from "node:assert/strict";
import { ALD_QUESTION_BANK, ALD_TOPICS } from "../../src/lib/content/ald.ts";
import { ALD_OBJECTIVES, ALD_QUESTION_OBJECTIVE } from "../../src/lib/content/ald-objectives.ts";

const allQuestions = Object.values(ALD_QUESTION_BANK).flat();

test("every built-in ALD question has an objective from the catalogue", () => {
  assert.equal(allQuestions.length, 69);
  for (const q of allQuestions) {
    assert.ok(q.objectiveId, `${q.id} has no objectiveId`);
    assert.ok(ALD_OBJECTIVES[q.objectiveId], `${q.id} points at unknown objective ${q.objectiveId}`);
  }
});

test("each question's objective belongs to the question's own topic", () => {
  for (const topic of ALD_TOPICS) {
    for (const q of ALD_QUESTION_BANK[topic.id]) {
      assert.equal(ALD_OBJECTIVES[q.objectiveId!].topicId, topic.id, q.id);
    }
  }
});

test("the mapping names only questions that exist, and every objective has a question", () => {
  const ids = new Set(allQuestions.map((q) => q.id));
  for (const qid of Object.keys(ALD_QUESTION_OBJECTIVE)) assert.ok(ids.has(qid), `mapping names missing question ${qid}`);
  const used = new Set(allQuestions.map((q) => q.objectiveId));
  for (const oid of Object.keys(ALD_OBJECTIVES)) assert.ok(used.has(oid), `objective ${oid} has no questions`);
});
```

`tests/mastery/catalogue.test.ts`:
```ts
import test from "node:test";
import assert from "node:assert/strict";
import { objectiveIdOf, objectivesForTopic, unsortedObjectiveId } from "../../src/lib/mastery/catalogue.ts";

const catalogue = {
  "t/a": { id: "t/a", topicId: "t", name: "Do A" },
  "t/b": { id: "t/b", topicId: "t", name: "Do B" },
  "other/c": { id: "other/c", topicId: "other", name: "Do C" },
};

test("groups questions by objective in first-seen order and notes mechanism questions", () => {
  const list = objectivesForTopic(
    "t",
    [
      { id: "q1", objectiveId: "t/b", tier: "retrieval" },
      { id: "q2", objectiveId: "t/a", tier: "mechanism" },
      { id: "q3", objectiveId: "t/b" },
    ],
    catalogue,
  );
  assert.deepEqual(list.map((o) => o.id), ["t/b", "t/a"]);
  assert.deepEqual(list[0].questionIds, ["q1", "q3"]);
  assert.equal(list[0].hasMechanismQuestions, false);
  assert.equal(list[1].hasMechanismQuestions, true);
  assert.equal(list[1].name, "Do A");
});

test("a question without an objective lands in the topic's explicit unsorted objective", () => {
  const [o] = objectivesForTopic("t", [{ id: "q1" }], catalogue);
  assert.equal(o.id, unsortedObjectiveId("t"));
  assert.equal(o.id, "t#unsorted");
  assert.equal(o.name, "Questions not yet sorted into objectives");
  assert.equal(objectiveIdOf({}, "t"), "t#unsorted");
});

test("an objective missing from the catalogue throws instead of guessing", () => {
  assert.throws(() => objectivesForTopic("t", [{ id: "q1", objectiveId: "t/zzz" }], catalogue), /not in the catalogue/);
});

test("an objective from another topic throws", () => {
  assert.throws(() => objectivesForTopic("t", [{ id: "q1", objectiveId: "other/c" }], catalogue), /belongs to "other"/);
});

test("a topic with no questions has no objectives", () => {
  assert.deepEqual(objectivesForTopic("t", [], catalogue), []);
});
```

- [ ] **Step 4: Run to confirm they fail**

Run: `npm test`
Expected: FAIL, `Cannot find module '.../ald-objectives.ts'` and `.../catalogue.ts`.

- [ ] **Step 5: Write the catalogue helpers**

`src/lib/mastery/catalogue.ts`:
```ts
/** Which objectives a topic has, derived from the questions in its bank. */
import type { QuizQuestion } from "../data.ts";
import type { ObjectiveInfo } from "./types.ts";

export type QuestionRef = Pick<QuizQuestion, "id" | "objectiveId" | "tier">;

export interface TopicObjective extends ObjectiveInfo {
  hasMechanismQuestions: boolean;
  questionIds: string[];
}

/** The explicit bucket for questions extraction hasn't assigned to an objective yet. */
export function unsortedObjectiveId(topicId: string) {
  return `${topicId}#unsorted`;
}

export function objectiveIdOf(q: { objectiveId?: string }, topicId: string) {
  return q.objectiveId ?? unsortedObjectiveId(topicId);
}

export function objectivesForTopic(
  topicId: string,
  questions: readonly QuestionRef[],
  catalogue: Readonly<Record<string, ObjectiveInfo>>,
): TopicObjective[] {
  const byId = new Map<string, TopicObjective>();
  for (const q of questions) {
    const id = objectiveIdOf(q, topicId);
    let objective = byId.get(id);
    if (!objective) {
      let info: ObjectiveInfo;
      if (id === unsortedObjectiveId(topicId)) {
        info = { id, topicId, name: "Questions not yet sorted into objectives" };
      } else {
        const found = catalogue[id];
        if (!found) throw new Error(`Question ${q.id} points at objective "${id}", which is not in the catalogue`);
        if (found.topicId !== topicId) {
          throw new Error(`Question ${q.id} is in topic "${topicId}" but its objective "${id}" belongs to "${found.topicId}"`);
        }
        info = found;
      }
      objective = { ...info, hasMechanismQuestions: false, questionIds: [] };
      byId.set(id, objective);
    }
    objective.questionIds.push(q.id);
    if (q.tier === "mechanism") objective.hasMechanismQuestions = true;
  }
  return [...byId.values()];
}
```

- [ ] **Step 6: Write the ALD catalogue**

Question ids are `${topicId}-${n}`, n = 1-based position in that topic's `questions` array in `src/lib/content/ald.ts`. Before trusting the numbers below, read each topic's questions and confirm the prompts match the objective; if one doesn't, move it and say so in the commit message.

`src/lib/content/ald-objectives.ts`:
```ts
/**
 * ALD objectives ("can do X") and which built-in question tests each one.
 * Drafted from docs/OBJECTIVES-ALD.md, limited to objectives the current bank
 * has questions for; the rest arrive with generation and drills (Phases 2 and 6).
 */
import type { ObjectiveInfo } from "../mastery/types.ts";

interface Row {
  topicId: string;
  slug: string;
  name: string;
  /** 1-based positions in the topic's questions array. */
  questions: number[];
}

const ROWS: Row[] = [
  { topicId: "logic-circuits-switches", slug: "switch-networks", name: "Translate a series/parallel switch network to its Boolean function and back", questions: [1, 3, 4, 5] },
  { topicId: "logic-circuits-switches", slug: "why-binary", name: "Explain why digital systems use binary logic", questions: [2] },

  { topicId: "boolean-algebra", slug: "simplify", name: "Simplify an expression with absorption, combining and the other theorems", questions: [1, 2, 3] },
  { topicId: "boolean-algebra", slug: "dual", name: "State the dual of an identity", questions: [4] },
  { topicId: "boolean-algebra", slug: "precedence", name: "Apply operator precedence (NOT, AND, OR) to read an expression", questions: [5] },
  { topicId: "boolean-algebra", slug: "cost", name: "Explain what simplifying buys a designer", questions: [6] },

  { topicId: "sop-and-pos", slug: "canonical-forms", name: "Write canonical sum-of-products and product-of-sums forms from a truth table", questions: [1, 2, 3, 4] },

  { topicId: "nand-nor-demorgan", slug: "cmos", name: "Explain why NAND and NOR are preferred in CMOS", questions: [1] },
  { topicId: "nand-nor-demorgan", slug: "demorgan", name: "Apply DeMorgan's theorem to complement an expression", questions: [2, 4] },
  { topicId: "nand-nor-demorgan", slug: "nand-nor-networks", name: "Realise two-level networks with only NAND or only NOR gates", questions: [3] },

  { topicId: "karnaugh-maps", slug: "adjacency", name: "Place minterms on a K-map using Gray-code order and wrap-around adjacency", questions: [1, 2] },
  { topicId: "karnaugh-maps", slug: "dont-cares", name: "Use don't-cares to enlarge groups", questions: [3] },
  { topicId: "karnaugh-maps", slug: "grouping", name: "Cover 1s with valid groups and the fewest product terms", questions: [4] },

  { topicId: "binary-and-twos-complement", slug: "convert", name: "Convert between decimal and n-bit 2's complement, and compare with sign-and-magnitude", questions: [1, 2, 6] },
  { topicId: "binary-and-twos-complement", slug: "add-sub-overflow", name: "Add and subtract in 2's complement and decide whether overflow occurred", questions: [3, 4] },
  { topicId: "binary-and-twos-complement", slug: "sign-extend", name: "Sign-extend a 2's complement number when widening", questions: [5] },

  { topicId: "fixed-and-floating-point", slug: "q-format", name: "Read a Qi.f fixed-point pattern and say where the radix point lives", questions: [1, 2] },
  { topicId: "fixed-and-floating-point", slug: "choose-format", name: "Choose a fixed-point format for a required range and precision", questions: [3] },
  { topicId: "fixed-and-floating-point", slug: "fixed-multiply", name: "Predict precision loss and overflow in a fixed-point multiply", questions: [4] },
  { topicId: "fixed-and-floating-point", slug: "float-decode", name: "Decode a float's biased exponent", questions: [5] },
  { topicId: "fixed-and-floating-point", slug: "float-special", name: "Recognise special floating-point values such as ±0", questions: [6] },

  { topicId: "adders", slug: "full-adder", name: "Compute the sum and carry of a full adder", questions: [1] },
  { topicId: "adders", slug: "ripple-delay", name: "Find the worst case and estimate the delay of a ripple-carry adder", questions: [2, 3] },
  { topicId: "adders", slug: "carry-lookahead", name: "Write lookahead carries from generate and propagate, and explain hierarchical CLA", questions: [4, 5, 6] },

  { topicId: "multipliers", slug: "product-width", name: "Determine product width and which bits a constant-width result keeps", questions: [1] },
  { topicId: "multipliers", slug: "array-critical-path", name: "Compare carry-ripple and carry-save array multipliers", questions: [2, 3] },
  { topicId: "multipliers", slug: "signed-multiply", name: "Handle signs in a 2's complement array multiply", questions: [4, 5] },

  { topicId: "booth-recoding", slug: "count-partial-products", name: "Count partial products with and without Booth recoding", questions: [1, 3] },
  { topicId: "booth-recoding", slug: "recode", name: "Recode a multiplier with radix-4 Booth: pad, group, look up", questions: [2, 4] },
  { topicId: "booth-recoding", slug: "trade-offs", name: "Explain what Booth recoding speeds up and why radix-8 is rarely used", questions: [5, 6] },

  { topicId: "verilog-basics", slug: "literals-values", name: "Read sized literals and Verilog's four signal values", questions: [1, 2] },
  { topicId: "verilog-basics", slug: "declarations", name: "Read and write net, variable and array declarations and legal identifiers", questions: [3, 4, 6] },
  { topicId: "verilog-basics", slug: "tristate", name: "Describe a tri-state buffer with the conditional operator", questions: [5] },

  { topicId: "behavioral-verilog", slug: "loops-generate", name: "Explain what a for loop unrolls into and when generate is required", questions: [1, 2] },
  { topicId: "behavioral-verilog", slug: "always-blocks", name: "Declare the outputs of an always block correctly", questions: [3] },
  { topicId: "behavioral-verilog", slug: "tasks-functions", name: "Decide between a task and a function", questions: [4] },
  { topicId: "behavioral-verilog", slug: "mux-styles", name: "Describe a multiplexer with conditional expressions", questions: [5] },

  { topicId: "verilog-pitfalls-testbenches", slug: "pitfalls", name: "Spot the classic mistakes: blocking assignment, multiple drivers, net vs variable, replication", questions: [1, 3, 4, 6] },
  { topicId: "verilog-pitfalls-testbenches", slug: "parameters", name: "Instantiate a parameterised module per instance", questions: [2] },
  { topicId: "verilog-pitfalls-testbenches", slug: "testbenches", name: "Read a testbench: stimulus timing and ending the simulation", questions: [5] },
];

function build(rows: readonly Row[]) {
  const objectives: Record<string, ObjectiveInfo> = {};
  const byQuestion: Record<string, string> = {};
  for (const row of rows) {
    const id = `${row.topicId}/${row.slug}`;
    if (objectives[id]) throw new Error(`Duplicate objective ${id}`);
    objectives[id] = { id, topicId: row.topicId, name: row.name };
    for (const n of row.questions) {
      const questionId = `${row.topicId}-${n}`;
      if (byQuestion[questionId]) throw new Error(`Question ${questionId} is mapped to both ${byQuestion[questionId]} and ${id}`);
      byQuestion[questionId] = id;
    }
  }
  return { objectives, byQuestion };
}

const built = build(ROWS);
export const ALD_OBJECTIVES: Readonly<Record<string, ObjectiveInfo>> = built.objectives;
export const ALD_QUESTION_OBJECTIVE: Readonly<Record<string, string>> = built.byQuestion;
```

- [ ] **Step 7: Attach objectives in the ALD bank**

In `src/lib/content/ald.ts`, change the type import on line 7 to `import type { QuizQuestion } from "../data.ts";`, add below it:
```ts
import { ALD_QUESTION_OBJECTIVE } from "./ald-objectives.ts";
```
and replace the `ALD_QUESTION_BANK` export at the bottom with:
```ts
/** Question bank in the store's shape: topicId → questions with ids and objectives. */
export const ALD_QUESTION_BANK: Record<string, QuizQuestion[]> = Object.fromEntries(
  ALD_TOPICS.map((t) => [
    t.id,
    t.questions.map((q, i) => {
      const id = `${t.id}-${i + 1}`;
      const objectiveId = ALD_QUESTION_OBJECTIVE[id];
      if (!objectiveId) throw new Error(`ALD question ${id} has no objective in ald-objectives.ts`);
      return { id, topic: t.name, objectiveId, ...q };
    }),
  ]),
);
```

- [ ] **Step 8: Run tests**

Run: `npm test`
Expected: PASS, including all 3 catalogue-content tests and 5 catalogue tests.

- [ ] **Step 9: Commit**

```bash
npx tsc --noEmit && npm run lint
git add src/lib/mastery src/lib/content src/lib/data.ts tests
git commit -m "Objectives: evidence types, catalogue helpers, and every built-in ALD question tagged with an objective"
```

---

### Task 4: Objective state from evidence

**Files:**
- Create: `src/lib/mastery/objective-state.ts`, `tests/mastery/objective-state.test.ts`
- Modify: `src/lib/mastery/types.ts` (add `"due"` to `ObjectiveStatus`)

**Interfaces:**
- Consumes: `EvidenceEvent`, `ObjectiveState`, `ObjectiveStatus`, `Outcome` from Task 3.
- Produces: `MASTERY_RULES`, `localDayKey(iso: string): string`, `interface ObjectiveStateOptions { hasMechanismQuestions: boolean; dayKey?: (iso: string) => string }`, `interface ObjectiveAccumulator` (plain JSON), `EMPTY_ACCUMULATOR`, `applyAnswer(acc: ObjectiveAccumulator, e: EvidenceEvent, options: ObjectiveStateOptions): ObjectiveAccumulator`, `stateAt(objectiveId: string, acc: ObjectiveAccumulator, now: Date): ObjectiveState`, `replayObjective(objectiveId: string, events: readonly EvidenceEvent[], options: ObjectiveStateOptions): ObjectiveAccumulator`, `computeObjectiveState(objectiveId: string, events: readonly EvidenceEvent[], now: Date, options: ObjectiveStateOptions): ObjectiveState`.

**Why a step function.** The rule is written as `applyAnswer(state, answer) → state` (a fold over the log) plus `stateAt(state, now)`. Phase 1 still replays the whole log in the browser, which is cheap at this size. In the Supabase phase the accumulator becomes a stored snapshot updated in the same transaction as each new answer (event sourcing with snapshots), so reads stop replaying the log. Time-based states (due, fading) are computed at read from the stored due time, never by a timer.

Rules being implemented (from `docs/MASTERY-PLAN.md` §2.3–2.5):
- Credit counts only a question's **first** attempt: unaided correct = 1, self-marked correct = 0.5, partial = 0.5, incorrect = 0. Repeats never add.
- Mastered when credit ≥ 3, credit earned on ≥ 2 calendar days, the last two non-partial answers are correct, and there's no open mix-up.
- Mix-up: two unaided misses in a row on different questions. Cleared by an unaided correct on a mechanism-tier question, or any unaided correct if the objective has no mechanism question (provisional, see TO-DISCUSS).
- On mastery: stability 3 days, due 3 days later. An unaided correct at or after the due time is a spaced check: stability × 2.2 (cap 60), due again after the new stability. Early answers don't change it. An unaided miss: stability ÷ 3 (min 2), due tomorrow, fading until the next check. Stability at the cap with ≥ 3 checks = retired.
- Status at `now`: `unseen` (no answers) → `learning` / `mixed-up` → `mastered` (due time not reached) → `due` (due, but still counts as mastered, for half its interval) → `fading` (a miss pending, or more than half an interval overdue; stops counting) → `retired`.
- Answers must be applied in time order. `applyAnswer` throws on an answer older than the last one applied, telling the caller to rebuild from the log.

- [ ] **Step 1: Add the "due" status**

In `src/lib/mastery/types.ts`:
```ts
export type ObjectiveStatus = "unseen" | "learning" | "mixed-up" | "mastered" | "due" | "fading" | "retired";
```

- [ ] **Step 2: Write the failing tests**

`tests/mastery/objective-state.test.ts`:
```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_ACCUMULATOR,
  MASTERY_RULES,
  applyAnswer,
  computeObjectiveState,
  stateAt,
} from "../../src/lib/mastery/objective-state.ts";
import type { EvidenceEvent } from "../../src/lib/mastery/types.ts";

/** Noon UTC on 2026-10-<n>. */
const day = (n: number, hour = 12) => new Date(Date.UTC(2026, 9, n, hour)).toISOString();
const at = (n: number, hour = 13) => new Date(day(n, hour));
const utcDay = (iso: string) => iso.slice(0, 10);

let seq = 0;
function ev(questionId: string, when: string, over: Partial<EvidenceEvent> = {}): EvidenceEvent {
  seq += 1;
  return {
    id: `e${seq}`,
    at: when,
    courseId: "ald",
    topicId: "t",
    objectiveId: "t/o",
    questionId,
    tier: null,
    outcome: "correct",
    grader: "choice",
    source: "quiz",
    ...over,
  };
}

const opts = (hasMechanismQuestions = false) => ({ hasMechanismQuestions, dayKey: utcDay });
const state = (events: EvidenceEvent[], now: Date, hasMechanismQuestions = false) =>
  computeObjectiveState("t/o", events, now, opts(hasMechanismQuestions));

/** Mastered on day 2: q1, q2 on day 1 and q3 on day 2. Due on day 5. */
const masteredOnDay2 = () => [ev("q1", day(1)), ev("q2", day(1)), ev("q3", day(2))];

test("no answers is unseen", () => {
  const s = state([], at(1));
  assert.equal(s.status, "unseen");
  assert.equal(s.credit, 0);
  assert.equal(s.dueAt, null);
  assert.equal(s.lastEvidenceAt, null);
});

test("events for other objectives are ignored", () => {
  assert.equal(state([ev("q1", day(1), { objectiveId: "t/other" })], at(1)).status, "unseen");
});

test("three correct answers on one day is still learning", () => {
  const s = state([ev("q1", day(1)), ev("q2", day(1)), ev("q3", day(1))], at(1));
  assert.equal(s.status, "learning");
  assert.equal(s.credit, 3);
  assert.equal(s.creditDays, 1);
});

test("three credited answers over two days with the last two correct is mastered", () => {
  const s = state(masteredOnDay2(), at(2));
  assert.equal(s.status, "mastered");
  assert.equal(s.stabilityDays, MASTERY_RULES.initialStabilityDays);
  assert.equal(s.dueAt, day(5));
  assert.equal(s.spacedChecks, 0);
});

test("repeating a question never adds credit", () => {
  const s = state([ev("q1", day(1)), ev("q1", day(2)), ev("q2", day(2))], at(2));
  assert.equal(s.credit, 2);
  assert.equal(s.status, "learning");
});

test("a question first missed earns nothing when later answered correctly", () => {
  const s = state([ev("q1", day(1), { outcome: "incorrect" }), ev("q1", day(2))], at(2));
  assert.equal(s.credit, 0);
});

test("self-marked answers count half", () => {
  const events = [ev("q1", day(1)), ev("q2", day(1)), ev("q3", day(2), { grader: "self" }), ev("q4", day(2), { grader: "self" })];
  const s = state(events, at(2));
  assert.equal(s.credit, 3);
  assert.equal(s.status, "mastered");
});

test("the last two answers must be correct", () => {
  const events = [ev("q1", day(1)), ev("q2", day(1)), ev("q3", day(2), { outcome: "incorrect" }), ev("q4", day(2))];
  assert.equal(state(events, at(2)).status, "learning");
  assert.equal(state([...events, ev("q5", day(3))], at(3)).status, "mastered");
});

test("partial answers count half and don't break the streak", () => {
  const events = [ev("q1", day(1)), ev("q2", day(1)), ev("q3", day(2), { outcome: "partial", grader: "rubric" }), ev("q4", day(2), { outcome: "partial", grader: "rubric" })];
  const s = state(events, at(2));
  assert.equal(s.credit, 3);
  assert.equal(s.status, "mastered");
});

test("two misses in a row on different questions is a mix-up, cleared only by a mechanism question", () => {
  const misses = [ev("q1", day(1), { outcome: "incorrect" }), ev("q2", day(1), { outcome: "incorrect" })];
  assert.equal(state(misses, at(1), true).status, "mixed-up");
  const retrieval = [...misses, ev("q3", day(1), { tier: "retrieval" })];
  assert.equal(state(retrieval, at(1), true).status, "mixed-up");
  const mechanism = [...retrieval, ev("q4", day(1), { tier: "mechanism" })];
  assert.equal(state(mechanism, at(1), true).status, "learning");
});

test("missing the same question twice is not a mix-up", () => {
  const s = state([ev("q1", day(1), { outcome: "incorrect" }), ev("q1", day(1), { outcome: "incorrect" })], at(1));
  assert.equal(s.status, "learning");
});

test("without mechanism questions any unaided correct answer clears a mix-up", () => {
  const events = [ev("q1", day(1), { outcome: "incorrect" }), ev("q2", day(1), { outcome: "incorrect" }), ev("q3", day(1))];
  assert.equal(state(events, at(1), false).status, "learning");
});

test("self-marked answers neither cause nor clear a mix-up", () => {
  const selfMisses = [ev("q1", day(1), { outcome: "incorrect", grader: "self" }), ev("q2", day(1), { outcome: "incorrect", grader: "self" })];
  assert.equal(state(selfMisses, at(1)).status, "learning");
  const misses = [ev("q1", day(1), { outcome: "incorrect" }), ev("q2", day(1), { outcome: "incorrect" }), ev("q3", day(1), { grader: "self" })];
  assert.equal(state(misses, at(1)).status, "mixed-up");
});

test("an open mix-up blocks mastery", () => {
  const events = [
    ev("q1", day(1), { outcome: "incorrect" }),
    ev("q2", day(1), { outcome: "incorrect" }),
    ev("q3", day(1), { tier: "retrieval" }),
    ev("q4", day(2), { tier: "retrieval" }),
    ev("q5", day(2), { tier: "retrieval" }),
  ];
  const s = state(events, at(2), true);
  assert.equal(s.credit, 3);
  assert.equal(s.status, "mixed-up");
});

test("a correct answer before the due time is not a spaced check", () => {
  const s = state([...masteredOnDay2(), ev("q4", day(3))], at(3));
  assert.equal(s.status, "mastered");
  assert.equal(s.stabilityDays, 3);
  assert.equal(s.spacedChecks, 0);
  assert.equal(s.dueAt, day(5));
});

test("an unaided correct answer at the due time grows stability", () => {
  const s = state([...masteredOnDay2(), ev("q4", day(5))], at(5));
  assert.equal(s.status, "mastered");
  assert.ok(Math.abs(s.stabilityDays! - 6.6) < 1e-9);
  assert.equal(s.spacedChecks, 1);
});

test("a review coming due still counts as mastered for half its interval, then fades", () => {
  // Due day 5 at noon with a 3-day interval, so the grace runs to day 7 at midnight.
  assert.equal(state(masteredOnDay2(), at(5, 11)).status, "mastered");
  assert.equal(state(masteredOnDay2(), at(5, 12)).status, "due");
  assert.equal(state(masteredOnDay2(), at(6, 23)).status, "due");
  assert.equal(state(masteredOnDay2(), at(7, 0)).status, "fading");
});

test("a miss after mastery cuts stability, fades at once, and recovers on the next check", () => {
  const missed = [...masteredOnDay2(), ev("q4", day(3), { outcome: "incorrect" })];
  const s = state(missed, at(3));
  assert.equal(s.status, "fading");
  assert.equal(s.stabilityDays, MASTERY_RULES.minStabilityDays);
  assert.equal(s.dueAt, day(4));
  const recovered = state([...missed, ev("q5", day(4))], at(4));
  assert.equal(recovered.status, "mastered");
  assert.ok(Math.abs(recovered.stabilityDays! - 4.4) < 1e-9);
});

test("stability capped with at least three checks is retired", () => {
  const events = masteredOnDay2();
  const statuses: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    const due = state(events, at(2)).dueAt!;
    events.push(ev(`check${i}`, due));
    statuses.push(state(events, new Date(due)).status);
  }
  assert.deepEqual(statuses, ["mastered", "mastered", "mastered", "retired"]);
  const s = state(events, at(2));
  assert.equal(s.stabilityDays, MASTERY_RULES.stabilityCapDays);
  assert.equal(s.spacedChecks, 4);
});

test("events are ordered by time, not by array position", () => {
  const s = state([ev("q3", day(2)), ev("q1", day(1)), ev("q2", day(1))], at(2));
  assert.equal(s.status, "mastered");
});

test("applying answers one at a time gives the same state as replaying the log", () => {
  const events = [
    ev("q1", day(1), { outcome: "incorrect" }),
    ev("q2", day(1)),
    ev("q3", day(2)),
    ev("q4", day(2)),
    ev("q5", day(5)),
    ev("q6", day(9), { outcome: "incorrect" }),
    ev("q7", day(10)),
  ];
  let acc = EMPTY_ACCUMULATOR;
  for (let i = 0; i < events.length; i += 1) {
    acc = applyAnswer(acc, events[i], opts());
    const now = at(12);
    assert.deepEqual(stateAt("t/o", acc, now), state(events.slice(0, i + 1), now), `after answer ${i + 1}`);
  }
});

test("the accumulator survives a JSON round trip, so it can be stored as a snapshot", () => {
  const acc = masteredOnDay2().reduce((a, e) => applyAnswer(a, e, opts()), EMPTY_ACCUMULATOR);
  const restored = JSON.parse(JSON.stringify(acc));
  assert.deepEqual(restored, acc);
  const next = ev("q4", day(5));
  assert.deepEqual(applyAnswer(restored, next, opts()), applyAnswer(acc, next, opts()));
});

test("an answer older than the last one applied throws instead of corrupting the state", () => {
  const acc = applyAnswer(EMPTY_ACCUMULATOR, ev("q2", day(2)), opts());
  assert.throws(() => applyAnswer(acc, ev("q1", day(1)), opts()), /rebuild/);
});

test("applyAnswer never mutates the state it was given", () => {
  const before = applyAnswer(EMPTY_ACCUMULATOR, ev("q1", day(1)), opts());
  const snapshot = JSON.stringify(before);
  applyAnswer(before, ev("q2", day(2)), opts());
  assert.equal(JSON.stringify(before), snapshot);
});

test("an unparseable timestamp throws", () => {
  assert.throws(() => state([ev("q1", "garbage")], at(1)), /unparseable timestamp/);
});
```

- [ ] **Step 3: Run to confirm they fail**

Run: `npm test`
Expected: FAIL, `Cannot find module '.../objective-state.ts'`.

- [ ] **Step 4: Implement**

`src/lib/mastery/objective-state.ts`:
```ts
/**
 * Objective state as a fold over evidence (docs/MASTERY-PLAN.md §2.3–2.5).
 * applyAnswer is the step; stateAt reads the result against the clock.
 * Nothing here is stored in Phase 1; the accumulator is shaped so it can be.
 */
import type { EvidenceEvent, ObjectiveState, ObjectiveStatus, Outcome } from "./types.ts";

export const MASTERY_RULES = {
  /** Credited answers needed for mastery. */
  requiredCredit: 3,
  /** Distinct days that credit must come from. */
  requiredDays: 2,
  initialStabilityDays: 3,
  stabilityGrowth: 2.2,
  stabilityCapDays: 60,
  missDivisor: 3,
  minStabilityDays: 2,
  retireAfterChecks: 3,
  /** A review that has come due still counts as mastered until it is this fraction of its interval overdue. */
  fadingGraceFraction: 0.5,
} as const;

const DAY_MS = 86_400_000;

/** Whole milliseconds, so a due time survives a round trip through an ISO string exactly. */
const after = (t: number, days: number) => t + Math.round(days * DAY_MS);

export interface ObjectiveStateOptions {
  /** True when the objective has a mechanism-tier question; a mix-up then needs one to clear. */
  hasMechanismQuestions: boolean;
  /** Calendar day of an ISO timestamp. Defaults to the local day. */
  dayKey?: (iso: string) => string;
}

export function localDayKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Everything the rules remember about one objective's history. Plain JSON, so it can be stored as a snapshot. */
export interface ObjectiveAccumulator {
  answered: number;
  /** ISO time of the last applied answer. */
  lastAt: string | null;
  /** Questions already attempted; only first attempts earn credit. */
  attempted: string[];
  credit: number;
  creditDays: string[];
  /** The last two non-partial outcomes. */
  lastTwo: Outcome[];
  mixedUp: boolean;
  lastMissQuestion: string | null;
  mastered: boolean;
  stabilityDays: number;
  /** Epoch ms; meaningful once mastered. */
  dueAt: number;
  spacedChecks: number;
  missPending: boolean;
  retired: boolean;
}

export const EMPTY_ACCUMULATOR: ObjectiveAccumulator = Object.freeze({
  answered: 0,
  lastAt: null,
  attempted: [],
  credit: 0,
  creditDays: [],
  lastTwo: [],
  mixedUp: false,
  lastMissQuestion: null,
  mastered: false,
  stabilityDays: 0,
  dueAt: 0,
  spacedChecks: 0,
  missPending: false,
  retired: false,
}) as ObjectiveAccumulator;

function timeOf(e: EvidenceEvent) {
  const t = Date.parse(e.at);
  if (Number.isNaN(t)) throw new Error(`Evidence ${e.id} has an unparseable timestamp: "${e.at}"`);
  return t;
}

/** One step of the fold. Returns a new accumulator; never mutates the one it was given. */
export function applyAnswer(acc: ObjectiveAccumulator, e: EvidenceEvent, options: ObjectiveStateOptions): ObjectiveAccumulator {
  const R = MASTERY_RULES;
  const t = timeOf(e);
  if (acc.lastAt !== null && t < Date.parse(acc.lastAt)) {
    throw new Error(`Evidence ${e.id} is older than the last answer applied to objective ${e.objectiveId}; rebuild its state from the log`);
  }
  const dayKey = options.dayKey ?? localDayKey;
  const assisted = e.grader === "self";
  const next: ObjectiveAccumulator = { ...acc, answered: acc.answered + 1, lastAt: e.at };

  if (!next.mastered) {
    if (e.outcome === "incorrect" && !assisted) {
      if (next.lastMissQuestion !== null && next.lastMissQuestion !== e.questionId) next.mixedUp = true;
      next.lastMissQuestion = e.questionId;
    } else if (e.outcome === "correct" && !assisted) {
      next.lastMissQuestion = null;
      if (next.mixedUp && (e.tier === "mechanism" || !options.hasMechanismQuestions)) next.mixedUp = false;
    }

    if (!next.attempted.includes(e.questionId)) {
      next.attempted = [...next.attempted, e.questionId];
      const value = e.outcome === "correct" ? (assisted ? 0.5 : 1) : e.outcome === "partial" ? 0.5 : 0;
      if (value > 0) {
        next.credit += value;
        const d = dayKey(e.at);
        if (!next.creditDays.includes(d)) next.creditDays = [...next.creditDays, d];
      }
    }

    if (e.outcome !== "partial") next.lastTwo = [...next.lastTwo, e.outcome].slice(-2);
    const lastTwoCorrect = next.lastTwo.length === 2 && next.lastTwo.every((o) => o === "correct");
    if (next.credit >= R.requiredCredit && next.creditDays.length >= R.requiredDays && lastTwoCorrect && !next.mixedUp) {
      next.mastered = true;
      next.stabilityDays = R.initialStabilityDays;
      next.dueAt = after(t, next.stabilityDays);
    }
    return next;
  }

  if (e.outcome === "incorrect" && !assisted) {
    next.stabilityDays = Math.max(R.minStabilityDays, next.stabilityDays / R.missDivisor);
    next.dueAt = after(t, 1);
    next.missPending = true;
    next.retired = false;
  } else if (e.outcome === "correct" && !assisted && t >= next.dueAt) {
    next.stabilityDays = Math.min(R.stabilityCapDays, next.stabilityDays * R.stabilityGrowth);
    next.spacedChecks += 1;
    next.dueAt = after(t, next.stabilityDays);
    next.missPending = false;
    if (next.stabilityDays >= R.stabilityCapDays && next.spacedChecks >= R.retireAfterChecks) next.retired = true;
  }
  return next;
}

/** Read an accumulator against the clock. Due and fading are computed here, never by a timer. */
export function stateAt(objectiveId: string, acc: ObjectiveAccumulator, now: Date): ObjectiveState {
  const t = now.getTime();
  let status: ObjectiveStatus;
  if (acc.answered === 0) status = "unseen";
  else if (!acc.mastered) status = acc.mixedUp ? "mixed-up" : "learning";
  else if (acc.retired) status = "retired";
  else if (acc.missPending || t >= after(acc.dueAt, acc.stabilityDays * MASTERY_RULES.fadingGraceFraction)) status = "fading";
  else if (t >= acc.dueAt) status = "due";
  else status = "mastered";

  return {
    objectiveId,
    status,
    credit: acc.credit,
    creditDays: acc.creditDays.length,
    stabilityDays: acc.mastered ? acc.stabilityDays : null,
    dueAt: acc.mastered ? new Date(acc.dueAt).toISOString() : null,
    spacedChecks: acc.spacedChecks,
    lastEvidenceAt: acc.lastAt,
  };
}

/** Rebuild one objective's accumulator from the full log (in time order). */
export function replayObjective(objectiveId: string, events: readonly EvidenceEvent[], options: ObjectiveStateOptions): ObjectiveAccumulator {
  return events
    .filter((e) => e.objectiveId === objectiveId)
    .map((e) => ({ e, t: timeOf(e) }))
    .sort((a, b) => a.t - b.t)
    .reduce((acc, { e }) => applyAnswer(acc, e, options), EMPTY_ACCUMULATOR);
}

export function computeObjectiveState(
  objectiveId: string,
  events: readonly EvidenceEvent[],
  now: Date,
  options: ObjectiveStateOptions,
): ObjectiveState {
  return stateAt(objectiveId, replayObjective(objectiveId, events, options), now);
}
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: PASS (all objective-state tests).

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit && npm run lint
git add src/lib/mastery/objective-state.ts src/lib/mastery/types.ts tests/mastery/objective-state.test.ts
git commit -m "Mastery: objective state as a fold over evidence (criteria, mix-ups, spaced checks, due vs fading, retirement)"
```

---

### Task 5: Topic progress, island level, course mastery

**Files:**
- Create: `src/lib/mastery/progress.ts`, `src/lib/mastery/course-mastery.ts`, `tests/mastery/progress.test.ts`, `tests/mastery/course-mastery.test.ts`

**Interfaces:**
- Consumes: `computeObjectiveState` (Task 4), `objectivesForTopic` (Task 3).
- Produces:
  - `progress.ts`: `type TopicStatus = "not-started" | "in-progress" | "done"`, `interface TopicProgress { status: TopicStatus; mastered: number; total: number }`, `topicProgress(objectiveIds: readonly string[], states: ReadonlyMap<string, ObjectiveState>): TopicProgress`, `type IslandLevel = "uncharted" | "sprouting" | "growing" | "thriving"`, `ISLAND_THRESHOLDS`, `islandLevel(states: readonly ObjectiveState[]): IslandLevel`
  - `course-mastery.ts`: `interface CourseMastery { objectives: Map<string, ObjectiveState>; topicObjectives: Map<string, string[]>; topics: Map<string, TopicProgress>; island: IslandLevel }`, `courseMastery(input: CourseMasteryInput): CourseMastery`, `interface CourseMasteryInput { courseId: string; topicIds: readonly string[]; bank: Readonly<Record<string, readonly QuestionRef[]>>; catalogue: Readonly<Record<string, ObjectiveInfo>>; evidence: readonly EvidenceEvent[]; now: Date; dayKey?: (iso: string) => string }`

- [ ] **Step 1: Write the failing tests**

`tests/mastery/progress.test.ts`:
```ts
import test from "node:test";
import assert from "node:assert/strict";
import { islandLevel, topicProgress } from "../../src/lib/mastery/progress.ts";
import type { ObjectiveState, ObjectiveStatus } from "../../src/lib/mastery/types.ts";

const s = (objectiveId: string, status: ObjectiveStatus): ObjectiveState => ({
  objectiveId,
  status,
  credit: 0,
  creditDays: 0,
  stabilityDays: null,
  dueAt: null,
  spacedChecks: 0,
  lastEvidenceAt: null,
});
const map = (...states: ObjectiveState[]) => new Map(states.map((x) => [x.objectiveId, x]));

test("a topic is done only when every objective is mastered, due (within grace) or retired", () => {
  assert.deepEqual(topicProgress(["a", "b"], map(s("a", "mastered"), s("b", "retired"))), { status: "done", mastered: 2, total: 2 });
  assert.equal(topicProgress(["a", "b"], map(s("a", "due"), s("b", "mastered"))).status, "done");
  assert.equal(topicProgress(["a", "b"], map(s("a", "mastered"), s("b", "fading"))).status, "in-progress");
});

test("a topic with no answers is not started; any answer makes it in progress", () => {
  assert.equal(topicProgress(["a", "b"], map(s("a", "unseen"), s("b", "unseen"))).status, "not-started");
  assert.equal(topicProgress(["a", "b"], map(s("a", "learning"), s("b", "unseen"))).status, "in-progress");
});

test("a topic with no objectives is not started", () => {
  assert.deepEqual(topicProgress([], map()), { status: "not-started", mastered: 0, total: 0 });
});

test("a missing objective state throws", () => {
  assert.throws(() => topicProgress(["a"], map()), /No state computed for objective a/);
});

test("island level follows the share of objectives held", () => {
  assert.equal(islandLevel([]), "uncharted");
  assert.equal(islandLevel([s("a", "unseen"), s("b", "unseen")]), "uncharted");
  assert.equal(islandLevel([s("a", "learning"), s("b", "unseen"), s("c", "unseen")]), "sprouting");
  assert.equal(islandLevel([s("a", "mastered"), s("b", "unseen"), s("c", "unseen")]), "growing");
  assert.equal(islandLevel([s("a", "mastered"), s("b", "retired"), s("c", "unseen")]), "thriving");
});

test("fading objectives don't hold an island's level; due ones still do", () => {
  assert.equal(islandLevel([s("a", "fading"), s("b", "fading"), s("c", "mastered")]), "growing");
  assert.equal(islandLevel([s("a", "due"), s("b", "due"), s("c", "mastered")]), "thriving");
});
```

`tests/mastery/course-mastery.test.ts`:
```ts
import test from "node:test";
import assert from "node:assert/strict";
import { courseMastery } from "../../src/lib/mastery/course-mastery.ts";
import type { EvidenceEvent } from "../../src/lib/mastery/types.ts";

const catalogue = {
  "t1/a": { id: "t1/a", topicId: "t1", name: "A" },
  "t2/b": { id: "t2/b", topicId: "t2", name: "B" },
};
const bank = {
  t1: [{ id: "q1", objectiveId: "t1/a" }, { id: "q2", objectiveId: "t1/a" }, { id: "q3", objectiveId: "t1/a" }],
  t2: [{ id: "q4", objectiveId: "t2/b" }],
};
const ev = (questionId: string, at: string, courseId = "c"): EvidenceEvent => ({
  id: `${questionId}-${at}`,
  at,
  courseId,
  topicId: "t1",
  objectiveId: "t1/a",
  questionId,
  tier: null,
  outcome: "correct",
  grader: "choice",
  source: "quiz",
});

const base = { courseId: "c", topicIds: ["t1", "t2", "t3"], bank, catalogue, dayKey: (iso: string) => iso.slice(0, 10) };

test("rolls evidence up into objectives, topics and an island level", () => {
  const evidence = [ev("q1", "2026-10-01T12:00:00Z"), ev("q2", "2026-10-01T12:00:00Z"), ev("q3", "2026-10-02T12:00:00Z")];
  const m = courseMastery({ ...base, evidence, now: new Date("2026-10-02T13:00:00Z") });
  assert.equal(m.objectives.get("t1/a")!.status, "mastered");
  assert.equal(m.objectives.get("t2/b")!.status, "unseen");
  assert.equal(m.topics.get("t1")!.status, "done");
  assert.equal(m.topics.get("t2")!.status, "not-started");
  assert.deepEqual(m.topics.get("t3"), { status: "not-started", mastered: 0, total: 0 });
  assert.deepEqual(m.topicObjectives.get("t1"), ["t1/a"]);
  assert.deepEqual(m.topicObjectives.get("t3"), []);
  assert.equal(m.island, "growing");
});

test("answers follow their question's current objective, not the one recorded", () => {
  const filedUnderOldId = ["q1", "q2", "q3"].map((q, i) => ({
    ...ev(q, i < 2 ? "2026-10-01T12:00:00Z" : "2026-10-02T12:00:00Z"),
    objectiveId: "t1#unsorted",
  }));
  const m = courseMastery({ ...base, evidence: filedUnderOldId, now: new Date("2026-10-02T13:00:00Z") });
  assert.equal(m.objectives.get("t1/a")!.status, "mastered");
  assert.equal(m.objectives.has("t1#unsorted"), false);
});

test("evidence from another course is ignored", () => {
  const evidence = [ev("q1", "2026-10-01T12:00:00Z", "other")];
  const m = courseMastery({ ...base, evidence, now: new Date("2026-10-02T13:00:00Z") });
  assert.equal(m.objectives.get("t1/a")!.status, "unseen");
  assert.equal(m.island, "uncharted");
});
```

- [ ] **Step 2: Run to confirm they fail**

Run: `npm test`
Expected: FAIL, missing `progress.ts` and `course-mastery.ts`.

- [ ] **Step 3: Implement**

`src/lib/mastery/progress.ts`:
```ts
/** Topic progress and island level, computed from objective states. */
import type { ObjectiveState } from "./types.ts";

export type TopicStatus = "not-started" | "in-progress" | "done";

export interface TopicProgress {
  status: TopicStatus;
  /** Objectives mastered, due (within grace) or retired. */
  mastered: number;
  total: number;
}

/** Counts as mastered: a review coming due (within its grace) still counts; fading doesn't. */
const held = (s: ObjectiveState) => s.status === "mastered" || s.status === "due" || s.status === "retired";

export function topicProgress(objectiveIds: readonly string[], states: ReadonlyMap<string, ObjectiveState>): TopicProgress {
  const list = objectiveIds.map((id) => {
    const s = states.get(id);
    if (!s) throw new Error(`No state computed for objective ${id}`);
    return s;
  });
  const mastered = list.filter(held).length;
  const total = list.length;
  const status: TopicStatus =
    total > 0 && mastered === total ? "done" : list.every((s) => s.status === "unseen") ? "not-started" : "in-progress";
  return { status, mastered, total };
}

/** Fixed island visuals, one per level. Names and cut-offs are provisional (docs/TO-DISCUSS.md). */
export type IslandLevel = "uncharted" | "sprouting" | "growing" | "thriving";

export const ISLAND_THRESHOLDS = { growing: 1 / 3, thriving: 2 / 3 } as const;

export function islandLevel(states: readonly ObjectiveState[]): IslandLevel {
  if (states.length === 0 || states.every((s) => s.status === "unseen")) return "uncharted";
  const share = states.filter(held).length / states.length;
  if (share >= ISLAND_THRESHOLDS.thriving) return "thriving";
  if (share >= ISLAND_THRESHOLDS.growing) return "growing";
  return "sprouting";
}
```

`src/lib/mastery/course-mastery.ts`:
```ts
/** Everything learner-facing about one course, derived in one pass. */
import { objectivesForTopic, type QuestionRef } from "./catalogue.ts";
import { computeObjectiveState } from "./objective-state.ts";
import { type IslandLevel, type TopicProgress, islandLevel, topicProgress } from "./progress.ts";
import type { EvidenceEvent, ObjectiveInfo, ObjectiveState } from "./types.ts";

export interface CourseMastery {
  objectives: Map<string, ObjectiveState>;
  /** topicId → its objective ids, in first-seen order. */
  topicObjectives: Map<string, string[]>;
  topics: Map<string, TopicProgress>;
  island: IslandLevel;
}

export interface CourseMasteryInput {
  courseId: string;
  topicIds: readonly string[];
  /** topicId → that topic's questions. */
  bank: Readonly<Record<string, readonly QuestionRef[]>>;
  catalogue: Readonly<Record<string, ObjectiveInfo>>;
  evidence: readonly EvidenceEvent[];
  now: Date;
  dayKey?: (iso: string) => string;
}

export function courseMastery({ courseId, topicIds, bank, catalogue, evidence, now, dayKey }: CourseMasteryInput): CourseMastery {
  const perTopic = topicIds.map((topicId) => ({ topicId, list: objectivesForTopic(topicId, bank[topicId] ?? [], catalogue) }));

  // An answer counts toward its question's *current* objective, so re-sorting questions into
  // objectives re-files past answers too. The objective recorded at answer time is used only
  // when the question is no longer in the bank.
  const objectiveOfQuestion = new Map<string, string>();
  for (const { list } of perTopic) for (const o of list) for (const q of o.questionIds) objectiveOfQuestion.set(q, o.id);
  const events = evidence
    .filter((e) => e.courseId === courseId)
    .map((e) => {
      const current = objectiveOfQuestion.get(e.questionId);
      return current && current !== e.objectiveId ? { ...e, objectiveId: current } : e;
    });

  const objectives = new Map<string, ObjectiveState>();
  const topicObjectives = new Map<string, string[]>();
  const topics = new Map<string, TopicProgress>();
  for (const { topicId, list } of perTopic) {
    for (const o of list) {
      objectives.set(o.id, computeObjectiveState(o.id, events, now, { hasMechanismQuestions: o.hasMechanismQuestions, dayKey }));
    }
    const ids = list.map((o) => o.id);
    topicObjectives.set(topicId, ids);
    topics.set(topicId, topicProgress(ids, objectives));
  }
  return { objectives, topicObjectives, topics, island: islandLevel([...objectives.values()]) };
}
```

Note: `bank[topicId] ?? []` is not a masking fallback; a topic with no bank entry genuinely has no questions, and that shows as an explicit "No questions yet" state on the trail (Task 8).

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit && npm run lint
git add src/lib/mastery tests/mastery
git commit -m "Mastery: topic progress, island levels, and a per-course roll-up"
```

---

### Task 6: Evidence in the store

**Files:**
- Create: `src/hooks/useNow.ts`
- Modify: `src/lib/store.tsx`

**Interfaces:**
- Consumes: `EvidenceEvent` (Task 3), `courseMastery`, `CourseMastery` (Task 5), `ALD_OBJECTIVES` (Task 3).
- Produces: `useOrca().objectives: Record<string, Record<string, ObjectiveInfo>>`, `useOrca().evidence: EvidenceEvent[]`, `useOrca().recordEvidence(e: Omit<EvidenceEvent, "id" | "at">): void`, `useMasteryByCourse(): Record<string, CourseMastery>`, `useNow(): number`.

- [ ] **Step 1: A clock hook that is safe to render**

`src/hooks/useNow.ts`:
```ts
"use client";

import { useSyncExternalStore } from "react";

const subscribe = (cb: () => void) => {
  const id = window.setInterval(cb, 60_000);
  return () => window.clearInterval(id);
};

/** Current time in ms, floored to the minute so the snapshot is stable; 0 during server render. */
const minute = () => Math.floor(Date.now() / 60_000) * 60_000;

export function useNow() {
  return useSyncExternalStore(subscribe, minute, () => 0);
}
```

- [ ] **Step 2: Add evidence to state and actions**

In `src/lib/store.tsx`:

Add imports:
```ts
import type { EvidenceEvent } from "./mastery/types";
import { type CourseMastery, courseMastery } from "./mastery/course-mastery";
import { ALD_OBJECTIVES } from "./content/ald-objectives";
import { useNow } from "@/hooks/useNow";
```

In `interface OrcaState`, after `questionBank`:
```ts
  /** Course structure: courseId → objectiveId → objective. Created once (built-in content now, uploads from Phase 2), never regenerated. */
  objectives: Record<string, Record<string, ObjectiveInfo>>;
  /** Append-only answer log. Every learner-facing state is computed from it. */
  evidence: EvidenceEvent[];
```
(and import `ObjectiveInfo` alongside `EvidenceEvent` from `./mastery/types`).

In `initialState`, after `questionBank: { ald: ALD_QUESTION_BANK },`:
```ts
  objectives: { ald: ALD_OBJECTIVES },
  evidence: [],
```

In the load effect, next to the existing built-in bank merge, make built-in objectives win for their course the same way:
```ts
        saved.objectives = { ...(saved.objectives ?? {}), ald: ALD_OBJECTIVES };
```

In `addCourse`, give the new course an empty objective list alongside its config and weights:
```ts
        objectives: { ...s.objectives, [id]: {} },
```

In `interface OrcaActions`, after `recordQuiz`:
```ts
  /** Append one graded answer. The only way learner state changes. */
  recordEvidence: (e: Omit<EvidenceEvent, "id" | "at">) => void;
```

After the `recordQuiz` callback:
```ts
  const recordEvidence = useCallback<OrcaActions["recordEvidence"]>((e) => {
    const event: EvidenceEvent = { ...e, id: crypto.randomUUID(), at: new Date().toISOString() };
    setState((s) => ({ ...s, evidence: [...s.evidence, event] }));
  }, []);
```

Add `recordEvidence` to the `value` object and its dependency list.

Below `useCourse`, add:
```ts
/** Derived learner state for every course: objective states, topic progress, island level. */
export function useMasteryByCourse(): Record<string, CourseMastery> {
  const { courses, questionBank, objectives, evidence } = useOrca();
  const nowMs = useNow();
  return useMemo(
    () =>
      Object.fromEntries(
        courses.map((c) => [
          c.id,
          courseMastery({
            courseId: c.id,
            topicIds: c.topics.map((t) => t.id),
            bank: questionBank[c.id] ?? {},
            catalogue: objectives[c.id] ?? {},
            evidence,
            now: new Date(nowMs),
          }),
        ]),
      ),
    [courses, questionBank, objectives, evidence, nowMs],
  );
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useNow.ts src/lib/store.tsx
git commit -m "Store: objectives as course data, append-only evidence log, recordEvidence, and useMasteryByCourse"
```

---

### Task 7: The quiz records evidence

**Files:**
- Modify: `src/app/quiz/[slug]/[topic]/page.tsx`, `src/lib/data.ts` (delete `quizFor` and `KMAPS_QUIZ`)

**Interfaces:**
- Consumes: `recordEvidence` (Task 6), `objectiveIdOf` (Task 3), `Grader`, `Outcome` (Task 3).

- [ ] **Step 1: Remove the placeholder quiz**

In `src/lib/data.ts` delete `KMAPS_QUIZ` and `quizFor`. They show study-habit questions for topics with no bank, and answers to those would now count as evidence about the topic. Run `grep -rn "KMAPS_QUIZ\|quizFor" src` and expect only the quiz page's import.

- [ ] **Step 2: Wire evidence into the quiz page**

In `src/app/quiz/[slug]/[topic]/page.tsx`:

Imports:
```ts
import type { QuizQuestion } from "@/lib/data";
import { objectiveIdOf } from "@/lib/mastery/catalogue";
import type { Grader, Outcome } from "@/lib/mastery/types";
```
(replacing `import { type QuizQuestion, quizFor } from "@/lib/data";`).

Store and question set:
```ts
  const { hydrated, streak, recordQuiz, recordEvidence, questionBank, llm } = useOrca();
  ...
  const generated = course ? questionBank[course.id]?.[topicId] : undefined;
  const fullSet = useMemo(() => (generated ?? []).slice(0, 8), [generated]);
```

Add after `const total = questions.length;`:
```ts
  /** One graded answer → one evidence event. Called only after grading has finished. */
  const logAnswer = useCallback(
    (question: QuizQuestion, outcome: Outcome, grader: Grader) => {
      if (!course || !topic) return;
      recordEvidence({
        courseId: course.id,
        topicId: topic.id,
        objectiveId: objectiveIdOf(question, topic.id),
        questionId: question.id,
        tier: question.tier ?? null,
        outcome,
        grader,
        source: "quiz",
      });
    },
    [course, topic, recordEvidence],
  );
```

Replace `check`:
```ts
  const check = useCallback(() => {
    if (!q || selected === null || checked) return;
    setChecked(true);
    const ok = selected === q.answer;
    if (ok) setCorrect((c) => c + 1);
    else setMissed((m) => [...m, q]);
    logAnswer(q, ok ? "correct" : "incorrect", "choice");
  }, [selected, checked, q, logAnswer]);
```

Replace `settle` (a `null` grader means grading failed, so nothing is recorded):
```ts
  const settle = useCallback(
    (result: GradeResult, grader: Grader | null) => {
      if (!q) return;
      setGrade(result);
      setChecked(true);
      if (result.outcome === "correct") setCorrect((c) => c + 1);
      else setMissed((m) => [...m, q]);
      if (grader) logAnswer(q, result.outcome, grader);
    },
    [q, logAnswer],
  );
```

In `submitShort`: `settle(gradeExact(response, q.exact), "exact");`, `settle(result, "rubric");`, and the catch becomes:
```ts
        settle(
          {
            outcome: "incorrect",
            feedback: `Couldn't grade this one (${error instanceof Error ? error.message : "error"}), so it wasn't counted. Compare with the key below.`,
          },
          null,
        );
```

In the `ShortAnswer` element:
```tsx
                  onSelfReport={(ok) =>
                    settle({ outcome: ok ? "correct" : "incorrect", feedback: ok ? "Marked as known." : "Marked as missed; it'll come back." }, "self")
                  }
```

Add an empty state right after `const backHref = ...;` (before the `topic.status === "locked"` block):
```tsx
  if (questions.length === 0) {
    return (
      <Screen bg="parchment" className="items-start gap-4 p-[32px]">
        <BackButton href={backHref} />
        {hydrated && (
          <>
            <p className="text-[22px] font-bold text-prussian">No questions for {topic.name} yet.</p>
            <p className="text-[16px] text-wisteria-deep">Add course material for this topic and Orca will write some.</p>
            <Button size="sm" onClick={() => router.push("/add-material")}>
              Add material
            </Button>
          </>
        )}
      </Screen>
    );
  }
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: all pass.

Run `npm run dev`, open `http://localhost:3000/quiz/ald/boolean-algebra`, answer two questions, then in the browser console run `JSON.parse(localStorage.getItem("orca:v3")).evidence` and expect two events with `objectiveId` values starting `boolean-algebra/`. (No seeded topic has an empty bank, so the "No questions yet" state isn't reachable from the demo; it covers topics imported without questions.)

- [ ] **Step 4: Commit**

```bash
git add src/app/quiz src/lib/data.ts
git commit -m "Quiz: record one evidence event per graded answer; grading failures record nothing; no placeholder quiz"
```

---

### Task 8: Trail, course page and sidebar read derived progress

**Files:**
- Modify: `src/lib/data.ts` (`Topic`, seeds, delete `TopicStatus` and `courseProgress`), `src/lib/extraction.ts` (`topicsFrom`), `src/lib/store.tsx` (`addCourse`, `recordQuiz`, `importExtraction`, `STORAGE_KEY`), `src/components/ui/PathNode.tsx`, `src/components/path/KnowledgePath.tsx`, `src/app/course/[slug]/page.tsx`, `src/app/quiz/[slug]/[topic]/page.tsx`, `src/components/layout/Sidebar.tsx`

**Interfaces:**
- Consumes: `useMasteryByCourse` (Task 6), `TopicProgress` (Task 5).
- Produces: `Topic` without `status | lessons | lessonsDone`; `PathNode` prop `visual: NodeVisual` where `type NodeVisual = "done" | "current" | "upcoming"`; `KnowledgePath` prop `progress: ReadonlyMap<string, TopicProgress>`.

- [ ] **Step 1: Topics stop carrying status**

In `src/lib/data.ts`:
- Delete `export type TopicStatus = ...` and `courseProgress`.
- `interface Topic` becomes:
```ts
export interface Topic {
  id: string;
  name: string;
  /** Node centre in the 854-wide path canvas. */
  pos: { x: number; y: number };
  /** One-paragraph summary (from extracted course material). */
  summary?: string;
  /** Where this topic came from. */
  source?: { filename: string; slideStart: number; slideEnd: number };
}
```
- `ALD_SEED_TOPICS` becomes:
```ts
/** ALD's trail comes from the authored lecture content. Progress is derived from evidence, so it starts empty. */
const ALD_POSITIONS = defaultTopicPositions(ALD_TOPICS.length);
const ALD_SEED_TOPICS: Topic[] = ALD_TOPICS.map((t, i) => ({
  id: t.id,
  name: t.name,
  pos: ALD_POSITIONS[i],
  summary: t.summary,
  source: t.source,
}));
```
- Delete the four seed courses with no real content (`circuit`, `signals`, `linear`, `stats`) from `SEED_COURSES`, so only ALD ships. Delete the seed rows that point at them: `SEED_DUE` `d1`, and `SEED_EVENTS` `e1`, `e6`, `e8`, `e10`, `e13`, `e14`. Then run `grep -n '"circuit"\|"signals"\|"linear"\|"stats"' src/lib/data.ts` and expect matches only in the `IslandVariant` type (variants remain as island shapes for new courses).

In `src/lib/extraction.ts`, `topicsFrom` returns `Array<Omit<Topic, "pos">>` and drops `lessons: 1`.

- [ ] **Step 2: The store stops writing topic status**

In `src/lib/store.tsx`:
- `const STORAGE_KEY = "orca:v4"; // v4: topics no longer store status; learner state comes from the evidence log`
- In `addCourse`, drop `const positions = defaultTopicPositions(4);` and set `topics: [],` (a new course has no topics until material is added). Remove `defaultTopicPositions` from the imports if it's now unused here.
- `recordQuiz` becomes:
```ts
  const recordQuiz = useCallback<OrcaActions["recordQuiz"]>((r) => {
    setState((s) => ({
      ...s,
      streak: s.streak + (s.results.length === 0 ? 1 : 0),
      results: [...s.results, { ...r, finishedAt: new Date().toISOString() }],
    }));
  }, []);
```
- In `importExtraction`, replace the push of a new topic with:
```ts
            topics.push({ ...t, pos: { x: 0, y: 0 } });
```

- [ ] **Step 3: Path nodes describe position on the trail, not a lock**

Replace `src/components/ui/PathNode.tsx` with:
```tsx
"use client";

import { motion } from "motion/react";
import { IconCheck, IconPlay } from "@/components/icons";
import { cn } from "@/lib/cn";
import { popIn, pulseHalo, springBouncy } from "@/lib/motion";

/**
 * Figma: Knowledge Path node. done = periwinkle + check, current = large
 * wisteria + play with a pulsing halo and a START bubble (the first topic not
 * yet done), upcoming = parchment + small play. Topics are never locked.
 * Positioned absolutely by its centre inside the 854×834 path canvas.
 */
export type NodeVisual = "done" | "current" | "upcoming";

export const NODE_SIZE: Record<NodeVisual, number> = { done: 72, current: 104, upcoming: 72 };
const HALO = 150;

export interface PathNodeProps {
  visual: NodeVisual;
  x: number;
  y: number;
  name: string;
  sub: string;
  onClick?: () => void;
  index?: number;
}

export function PathNode({ visual, x, y, name, sub, onClick, index = 0 }: PathNodeProps) {
  const size = NODE_SIZE[visual];
  const clickable = Boolean(onClick);

  const face =
    visual === "done"
      ? "bg-periwinkle border-periwinkle-deep text-prussian lip-periwinkle"
      : visual === "current"
        ? "bg-wisteria border-wisteria-deep text-parchment lip-wisteria"
        : "bg-parchment border-alice-deep text-periwinkle-deep lip-alice";

  return (
    <div className="absolute" style={{ left: x, top: y, width: 0, height: 0 }} data-visual={visual}>
      {visual === "current" && (
        <motion.div
          data-part="halo"
          aria-hidden
          className="absolute rounded-pill bg-periwinkle"
          style={{ width: HALO, height: HALO, left: -HALO / 2, top: -HALO / 2 }}
          animate={pulseHalo}
        />
      )}

      {visual === "current" && (
        <motion.span
          data-part="start"
          variants={popIn}
          initial="hidden"
          animate="show"
          transition={{ ...springBouncy, delay: 0.5 + index * 0.08 }}
          className="absolute left-1/2 -translate-x-1/2 rounded-pill border-2 border-alice-deep bg-parchment px-[14px] py-[7px] text-[13px] font-bold tracking-[1px] text-wisteria-deep lip-2 lip-alice"
          style={{ top: -size / 2 - 44 }}
        >
          START
        </motion.span>
      )}

      <motion.button
        type="button"
        data-part="node"
        variants={popIn}
        initial="hidden"
        animate="show"
        transition={{ ...springBouncy, delay: 0.25 + index * 0.08 }}
        whileHover={clickable ? { scale: 1.06 } : undefined}
        onClick={onClick}
        disabled={!clickable}
        aria-label={`${name}: ${sub}`}
        className={cn(
          "pressable absolute flex items-center justify-center rounded-pill border-[3px] lip-5 disabled:opacity-100",
          face,
          !clickable && "cursor-default",
        )}
        style={{ width: size, height: size, left: -size / 2, top: -size / 2 }}
      >
        {visual === "done" && <IconCheck size={30} />}
        {visual === "current" && <IconPlay size={44} />}
        {visual === "upcoming" && <IconPlay size={30} />}
      </motion.button>

      <motion.div
        data-part="label"
        variants={popIn}
        initial="hidden"
        animate="show"
        transition={{ ...springBouncy, delay: 0.35 + index * 0.08 }}
        className="absolute flex flex-col gap-[2px] whitespace-nowrap"
        style={{ left: size / 2 + 18, top: -22 }}
      >
        <span className={cn("text-[22px] font-bold leading-tight", visual === "upcoming" ? "text-periwinkle-deep" : "text-prussian")}>{name}</span>
        <span className={cn("text-[15px] font-medium", visual === "upcoming" ? "text-periwinkle-deep" : "text-wisteria-deep")}>{sub}</span>
      </motion.div>
    </div>
  );
}
```

- [ ] **Step 4: KnowledgePath takes derived progress**

In `src/components/path/KnowledgePath.tsx`:

Imports: add `import type { TopicProgress } from "@/lib/mastery/progress";` and `import { type NodeVisual, PathNode } from "@/components/ui/PathNode";` (replacing the old `PathNode` import).

Replace `statusLine` with:
```ts
function statusLine(p: TopicProgress) {
  if (p.total === 0) return "No questions yet";
  if (p.status === "done") return "Complete";
  if (p.status === "not-started") return `${p.total} ${p.total === 1 ? "objective" : "objectives"}`;
  return `${p.mastered} of ${p.total} objectives mastered`;
}
```

Signature and body:
```tsx
export function KnowledgePath({ course, progress, onStart }: {
  course: Course;
  progress: ReadonlyMap<string, TopicProgress>;
  onStart: (topic: Topic) => void;
}) {
  const progressOf = (t: Topic) => {
    const p = progress.get(t.id);
    if (!p) throw new Error(`No progress computed for topic ${t.id}`);
    return p;
  };
  const firstOpen = course.topics.findIndex((t) => progressOf(t).status !== "done");
  const visualOf = (t: Topic, i: number): NodeVisual =>
    progressOf(t).status === "done" ? "done" : i === firstOpen ? "current" : "upcoming";
  ...
```
and the node map:
```tsx
        {course.topics.map((t, i) => (
          <PathNode
            key={t.id}
            index={i}
            visual={visualOf(t, i)}
            x={t.pos.x}
            y={t.pos.y}
            name={t.name}
            sub={statusLine(progressOf(t))}
            onClick={() => onStart(t)}
          />
        ))}
```

- [ ] **Step 5: Course page**

In `src/app/course/[slug]/page.tsx`:
- Remove `import { courseProgress } from "@/lib/data";`. Import `useMasteryByCourse` from `@/lib/store` alongside `useCourse, useOrca`, and `import { Button } from "@/components/ui/Button";`.
- After `const course = useCourse(slug);` add `const mastery = useMasteryByCourse();`.
- Replace `const { done, total, pct } = courseProgress(course);` with:
```ts
  const m = mastery[course.id];
  if (!m) throw new Error(`No mastery computed for course ${course.id}`);
  const total = course.topics.length;
  const done = course.topics.filter((t) => m.topics.get(t.id)?.status === "done").length;
  const pct = total ? done / total : 0;
```
- Replace the `<KnowledgePath ... />` line with:
```tsx
      {course.topics.length === 0 ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-[12px] text-center">
          <p className="text-[22px] font-bold text-prussian">This island is uncharted.</p>
          <p className="text-[16px] text-wisteria-deep">Add lecture slides or homework and Orca will map its topics.</p>
          <Button size="sm" onClick={() => router.push("/add-material")}>
            Add material
          </Button>
        </div>
      ) : (
        <KnowledgePath course={course} progress={m.topics} onStart={(t) => router.push(`/quiz/${course.slug}/${t.id}`)} />
      )}
```

- [ ] **Step 6: Quiz page and sidebar drop the lock**

In the quiz page delete the whole `if (topic.status === "locked") { ... }` block.

In `src/components/layout/Sidebar.tsx`, `hrefFor` returns:
```ts
    return topic ? `/quiz/${c.slug}/${topic.id}` : `/course/${c.slug}`;
```

- [ ] **Step 7: Verify**

Run: `grep -rn "lessonsDone\|\.status === \"locked\"\|courseProgress\|TopicStatus" src`
Expected: only `TopicStatus` inside `src/lib/mastery/progress.ts`.

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: all pass.

Run `npm run dev`. On `/course/ald`, the first topic carries START and every node says "N objectives". Answer one Boolean Algebra question; back on the trail, Boolean Algebra reads "0 of 4 objectives mastered" and the first node is still START. `/home` shows only the ALD island. Create a course on `/new-course`; its page shows "This island is uncharted."

- [ ] **Step 8: Commit**

```bash
git add -A src
git commit -m "Trail reads derived progress: no stored topic status, no locks, explicit empty states"
```

---

### Task 9: Due list and streak from evidence; no fabricated seed data

**Files:**
- Create: `src/lib/mastery/due.ts`, `src/lib/mastery/streak.ts`, `tests/mastery/due.test.ts`, `tests/mastery/streak.test.ts`
- Modify: `src/lib/data.ts`, `src/lib/store.tsx`, `src/app/home/page.tsx`, `src/components/layout/Sidebar.tsx`, `src/app/quiz/[slug]/[topic]/page.tsx`, `src/app/course/[slug]/page.tsx`

**Interfaces:**
- Consumes: `CourseMastery` with `topicObjectives` (Task 5), `localDayKey` (Task 4), `useMasteryByCourse`, `useNow` (Task 6).
- Produces: `dueTopics(courseId: string, mastery: Pick<CourseMastery, "objectives" | "topicObjectives">, now: Date, dayKey?: (iso: string) => string): DueTopic[]`, `interface DueTopic { courseId: string; topicId: string; when: "today" | "tomorrow"; objectiveIds: string[] }`, `streakDays(evidence: readonly EvidenceEvent[], now: Date, dayKey?: (iso: string) => string): number`, store hooks `useDueItems(): DueItem[]` and `useStreak(): number`, `Course.sample?: boolean`.

Why: the sidebar's due cards, the calendar events, the sample homework file and the "5 day streak" are all hand-written stand-ins. After this task the due list and streak are computed from evidence, the calendar starts empty (real entries come from uploaded material with due dates), and ALD stays as a labelled sample course.

Rules:
- An objective is **due today** when it's mastered (not retired) and its due time has passed or falls on today's local date; **due tomorrow** when its due time falls on tomorrow's local date. Due items are grouped by topic. Objectives that aren't mastered yet aren't "due" in Phase 1; ranking new material into the daily queue is the scheduling phase.
- The **streak** counts consecutive local days, ending today, with at least one unaided graded answer. If today has none yet, the streak still counts from yesterday (it isn't broken until the day ends).

- [ ] **Step 1: Write the failing tests**

`tests/mastery/due.test.ts`:
```ts
import test from "node:test";
import assert from "node:assert/strict";
import { dueTopics } from "../../src/lib/mastery/due.ts";
import type { ObjectiveState, ObjectiveStatus } from "../../src/lib/mastery/types.ts";

const utcDay = (iso: string) => iso.slice(0, 10);
const s = (objectiveId: string, status: ObjectiveStatus, dueAt: string | null): ObjectiveState => ({
  objectiveId,
  status,
  credit: 3,
  creditDays: 2,
  stabilityDays: dueAt ? 3 : null,
  dueAt,
  spacedChecks: 0,
  lastEvidenceAt: null,
});
const now = new Date("2026-10-05T09:00:00Z");

test("groups objectives that are due by topic, into today and tomorrow", () => {
  const objectives = new Map([
    ["t1/a", s("t1/a", "due", "2026-10-04T12:00:00Z")],
    ["t1/b", s("t1/b", "mastered", "2026-10-05T18:00:00Z")],
    ["t1/c", s("t1/c", "mastered", "2026-10-06T08:00:00Z")],
    ["t2/d", s("t2/d", "mastered", "2026-10-09T08:00:00Z")],
    ["t2/e", s("t2/e", "learning", null)],
  ]);
  const topicObjectives = new Map([["t1", ["t1/a", "t1/b", "t1/c"]], ["t2", ["t2/d", "t2/e"]]]);
  assert.deepEqual(dueTopics("c", { objectives, topicObjectives }, now, utcDay), [
    { courseId: "c", topicId: "t1", when: "today", objectiveIds: ["t1/a", "t1/b"] },
    { courseId: "c", topicId: "t1", when: "tomorrow", objectiveIds: ["t1/c"] },
  ]);
});

test("retired objectives are never due", () => {
  const objectives = new Map([["t1/a", s("t1/a", "retired", "2026-10-01T00:00:00Z")]]);
  assert.deepEqual(dueTopics("c", { objectives, topicObjectives: new Map([["t1", ["t1/a"]]]) }, now, utcDay), []);
});

test("a missing objective state throws", () => {
  assert.throws(() => dueTopics("c", { objectives: new Map(), topicObjectives: new Map([["t1", ["t1/a"]]]) }, now, utcDay), /No state computed/);
});
```

`tests/mastery/streak.test.ts`:
```ts
import test from "node:test";
import assert from "node:assert/strict";
import { streakDays } from "../../src/lib/mastery/streak.ts";
import type { EvidenceEvent } from "../../src/lib/mastery/types.ts";

const utcDay = (iso: string) => iso.slice(0, 10);
const ev = (at: string, grader: EvidenceEvent["grader"] = "choice"): EvidenceEvent => ({
  id: at,
  at,
  courseId: "c",
  topicId: "t",
  objectiveId: "t/o",
  questionId: "q",
  tier: null,
  outcome: "incorrect",
  grader,
  source: "quiz",
});
const now = new Date("2026-10-05T20:00:00Z");

test("no answers is a zero streak", () => {
  assert.equal(streakDays([], now, utcDay), 0);
});

test("counts consecutive days ending today, right or wrong answers alike", () => {
  assert.equal(streakDays([ev("2026-10-03T10:00:00Z"), ev("2026-10-04T10:00:00Z"), ev("2026-10-05T10:00:00Z")], now, utcDay), 3);
});

test("a streak isn't broken until today ends", () => {
  assert.equal(streakDays([ev("2026-10-03T10:00:00Z"), ev("2026-10-04T10:00:00Z")], now, utcDay), 2);
});

test("a gap ends the streak", () => {
  assert.equal(streakDays([ev("2026-10-01T10:00:00Z"), ev("2026-10-04T10:00:00Z"), ev("2026-10-05T10:00:00Z")], now, utcDay), 2);
  assert.equal(streakDays([ev("2026-10-02T10:00:00Z")], now, utcDay), 0);
});

test("self-marked answers don't keep a streak alive", () => {
  assert.equal(streakDays([ev("2026-10-05T10:00:00Z", "self")], now, utcDay), 0);
});
```

- [ ] **Step 2: Run to confirm they fail**

Run: `npm test`
Expected: FAIL, missing `due.ts` and `streak.ts`.

- [ ] **Step 3: Implement**

`src/lib/mastery/due.ts`:
```ts
/** Which topics have reviews due today or tomorrow, from objective due times. */
import type { CourseMastery } from "./course-mastery.ts";
import { localDayKey } from "./objective-state.ts";

export interface DueTopic {
  courseId: string;
  topicId: string;
  when: "today" | "tomorrow";
  objectiveIds: string[];
}

const DAY_MS = 86_400_000;

export function dueTopics(
  courseId: string,
  mastery: Pick<CourseMastery, "objectives" | "topicObjectives">,
  now: Date,
  dayKey: (iso: string) => string = localDayKey,
): DueTopic[] {
  const today = dayKey(now.toISOString());
  const tomorrow = dayKey(new Date(now.getTime() + DAY_MS).toISOString());
  const out: DueTopic[] = [];
  for (const [topicId, ids] of mastery.topicObjectives) {
    const buckets = { today: [] as string[], tomorrow: [] as string[] };
    for (const id of ids) {
      const s = mastery.objectives.get(id);
      if (!s) throw new Error(`No state computed for objective ${id}`);
      if (s.dueAt === null || s.status === "retired") continue;
      const day = dayKey(s.dueAt);
      if (Date.parse(s.dueAt) <= now.getTime() || day === today) buckets.today.push(id);
      else if (day === tomorrow) buckets.tomorrow.push(id);
    }
    for (const when of ["today", "tomorrow"] as const) {
      if (buckets[when].length > 0) out.push({ courseId, topicId, when, objectiveIds: buckets[when] });
    }
  }
  return out;
}
```

`src/lib/mastery/streak.ts`:
```ts
/** Consecutive local days, ending today, with at least one unaided graded answer. */
import { localDayKey } from "./objective-state.ts";
import type { EvidenceEvent } from "./types.ts";

const DAY_MS = 86_400_000;

export function streakDays(evidence: readonly EvidenceEvent[], now: Date, dayKey: (iso: string) => string = localDayKey): number {
  const days = new Set(evidence.filter((e) => e.grader !== "self").map((e) => dayKey(e.at)));
  // Step back a day at a time from noon today, so daylight-saving shifts never skip a date.
  const noon = new Date(now);
  noon.setHours(12, 0, 0, 0);
  let cursor = noon.getTime();
  if (!days.has(dayKey(new Date(cursor).toISOString()))) cursor -= DAY_MS;
  let count = 0;
  while (days.has(dayKey(new Date(cursor).toISOString()))) {
    count += 1;
    cursor -= DAY_MS;
  }
  return count;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Remove fabricated seed data; label the sample course**

In `src/lib/data.ts`:
- Delete `SEED_DUE`, `SEED_EVENTS` and `SEED_MATERIALS`.
- `DueItem` becomes:
```ts
/** A topic with reviews due, derived from objective due times (never stored). */
export interface DueItem {
  id: string;
  courseId: string;
  topicId: string;
  title: string;
  when: DueWhen;
  /** How many of the topic's objectives are due. */
  count: number;
}
```
- In `interface Course`, add:
```ts
  /** Built-in sample content rather than material the student uploaded. */
  sample?: boolean;
```
- On the ALD entry in `SEED_COURSES`, add `sample: true,`.

In `src/lib/store.tsx`:
- `const STORAGE_KEY = "orca:v5"; // v5: due list and streak are derived; no fabricated seed data`
- Remove `due` and `streak` from `OrcaState`, `initialState` and the imports (`SEED_DUE`, `SEED_EVENTS`, `SEED_MATERIALS`, `DueItem` if unused). Set `events: [],` and `materials: [],` in `initialState`.
- In `recordQuiz`, delete the `streak:` line.
- Import `dueTopics` from `./mastery/due`, `streakDays` from `./mastery/streak`, and `type DueItem` from `./data`. Below `useMasteryByCourse`, add:
```ts
/** Topics with reviews due today or tomorrow, across every course. */
export function useDueItems(): DueItem[] {
  const { courses } = useOrca();
  const mastery = useMasteryByCourse();
  const nowMs = useNow();
  return useMemo(
    () =>
      courses.flatMap((c) => {
        const m = mastery[c.id];
        if (!m) throw new Error(`No mastery computed for course ${c.id}`);
        return dueTopics(c.id, m, new Date(nowMs)).map((d) => {
          const topic = c.topics.find((t) => t.id === d.topicId);
          if (!topic) throw new Error(`Due topic ${d.topicId} is not in course ${c.id}`);
          return { id: `${c.id}:${d.topicId}:${d.when}`, courseId: c.id, topicId: d.topicId, title: topic.name, when: d.when, count: d.objectiveIds.length };
        });
      }),
    [courses, mastery, nowMs],
  );
}

/** Days in a row with at least one unaided graded answer. */
export function useStreak(): number {
  const { evidence } = useOrca();
  const nowMs = useNow();
  return useMemo(() => streakDays(evidence, new Date(nowMs)), [evidence, nowMs]);
}
```

- [ ] **Step 6: Point the screens at the derived values**

- `src/app/home/page.tsx`: `const { courses } = useOrca(); const due = useDueItems(); const streak = useStreak();` (import both hooks from `@/lib/store`). `dueCount` stays as written.
- `src/components/layout/Sidebar.tsx`: `const { courses } = useOrca(); const due = useDueItems();`. The card title shows the count: pass `title={`${d.title} · ${d.count} to review`}` to `DueCard`.
- Quiz page: take `streak` from `useStreak()` instead of `useOrca()`.
- Course page: when `course.sample` is true, render `<motion.span variants={fadeUp} className="eyebrow">Sample course</motion.span>` directly above the `<motion.h1>`.

- [ ] **Step 7: Verify**

Run: `grep -rn "SEED_DUE\|SEED_EVENTS\|SEED_MATERIALS\|streak: 5" src`
Expected: no output.

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: all pass.

Run `npm run dev` in a fresh browser profile (or clear `localStorage`). `/home` shows "0 day streak" and the sidebar says "Nothing due. Nice." under both headings; `/calendar` has no events; `/course/ald` shows "Sample course". Answer one question; the streak reads 1.

- [ ] **Step 8: Commit**

```bash
git add src tests
git commit -m "Due list and streak derived from evidence; remove fabricated seed due items, events, materials and streak; label ALD as a sample course"
```

---

### Task 10: Islands show mastery level

**Files:**
- Modify: `src/components/brand/Island.tsx`, `src/components/map/KnowledgeMap.tsx`, `src/app/page.tsx` (onboarding `ISLANDS`), `src/app/new-course/page.tsx:78`

**Interfaces:**
- Consumes: `IslandLevel` (Task 5), `useMasteryByCourse` (Task 6).
- Produces: `Island` prop `level: IslandLevel` (replaces `active`).

- [ ] **Step 1: Four fixed looks**

In `src/components/brand/Island.tsx`:
- Update the header comment: "Each variant is a 280×230 frame. The look comes from the course's mastery level (`src/lib/mastery/progress.ts`): uncharted is pale with no trees, sprouting has one sapling, growing two trees, thriving four. The variant only says which course it is."
- In `interface Blob`, delete `trees?: boolean;` and make `treeOffset: { x: number; y: number };` required. Give every variant an offset and remove `trees: true`: `ald { x: 0, y: 0 }`, `circuit { x: 7.4, y: 2.8 }`, `signals { x: 4, y: 6 }`, `linear { x: -8, y: -6 }`, `stats { x: 0, y: 0 }`.
- Add above `ISLAND_W`:
```tsx
interface Tree {
  cx: number;
  cy: number;
  r: number;
  fill: string;
}

const TREE = {
  big: { cx: 71.98, cy: 63.98, r: 15, fill: "var(--color-wisteria)" },
  small: { cx: 131.98, cy: 87.98, r: 12, fill: "var(--color-wisteria-deep)" },
  north: { cx: 106, cy: 50, r: 11, fill: "var(--color-wisteria-deep)" },
  south: { cx: 98, cy: 104, r: 10, fill: "var(--color-wisteria)" },
  sapling: { cx: 100, cy: 78, r: 7, fill: "var(--color-wisteria)" },
} satisfies Record<string, Tree>;

const LOOK: Record<IslandLevel, { stroke: string; inner: string; trees: Tree[] }> = {
  uncharted: { stroke: "var(--color-alice-deep)", inner: "var(--color-alice)", trees: [] },
  sprouting: { stroke: "var(--color-wisteria)", inner: "var(--color-periwinkle)", trees: [TREE.sapling] },
  growing: { stroke: "var(--color-wisteria)", inner: "var(--color-periwinkle)", trees: [TREE.big, TREE.small] },
  thriving: { stroke: "var(--color-wisteria)", inner: "var(--color-periwinkle)", trees: [TREE.big, TREE.small, TREE.north, TREE.south] },
};
```
- Import `import type { IslandLevel } from "@/lib/mastery/progress";`.
- In `IslandProps` replace `active?: boolean` and its comment with:
```ts
  /** The course's mastery level; picks one of four fixed looks. */
  level: IslandLevel;
```
- In `Island`, destructure `level` instead of `active`, and replace the stroke/inner/trees logic and the trees `<g>` with:
```tsx
  const look = LOOK[level];
  const t = b.treeOffset;
  ...
        <motion.path data-part="top" d={b.top} fill="var(--color-parchment)" stroke={look.stroke} strokeWidth={5} strokeLinejoin="round" />
        <motion.path data-part="inner" d={b.inner} fill={look.inner} />
        {look.trees.length > 0 && (
          <g data-part="trees" transform={`translate(${t.x} ${t.y})`}>
            {look.trees.map((tree) => (
              <g key={`${tree.cx}-${tree.cy}`} data-part="tree">
                <motion.circle cx={tree.cx} cy={tree.cy} r={tree.r} fill={tree.fill} />
                <motion.rect
                  x={tree.cx - 2}
                  y={tree.cy + tree.r * 0.78}
                  width={tree.r >= 13 ? 5 : 4}
                  height={tree.r >= 13 ? 14 : 12}
                  rx={2}
                  fill="var(--color-prussian)"
                />
              </g>
            ))}
          </g>
        )}
```
  Add `data-level={level}` to the outer `motion.div`.

- [ ] **Step 2: The map passes each course's level**

In `src/components/map/KnowledgeMap.tsx`, import `useMasteryByCourse` from `@/lib/store`, call `const mastery = useMasteryByCourse();` at the top of the component, add
```ts
  const levelOf = (courseId: string) => {
    const m = mastery[courseId];
    if (!m) throw new Error(`No mastery computed for course ${courseId}`);
    return m.island;
  };
```
and render `<Island variant={c.variant} level={levelOf(c.id)} float seed={i} />`.

- [ ] **Step 3: Decorative islands pick a level explicitly**

`src/app/page.tsx` `ISLANDS` (this also shows all four looks for a visual check):
```ts
  { x: 20, y: 120, variant: "ald", level: "thriving", scale: 0.78 },
  { x: 330, y: 220, variant: "circuit", level: "growing", scale: 0.78 },
  { x: 10, y: 410, variant: "linear", level: "sprouting", scale: 0.72 },
  { x: 250, y: 560, variant: "signals", level: "uncharted", scale: 0.78 },
  { x: 560, y: 470, variant: "stats", level: "uncharted", scale: 0.7 },
```
Type the array so `level` is an `IslandLevel` (add `as const` or an explicit element type), and render `level={isl.level}`.

`src/app/new-course/page.tsx:78`: `<Island variant="ald" level="growing" scale={2.1} float seed={2} />`.

- [ ] **Step 4: Verify**

Run: `grep -rn "active=" src/app src/components | grep Island`
Expected: no output.

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: all pass.

Run `npm run dev`. On `/` all four looks appear (thriving ALD with four trees, growing circuit, sprouting linear with one sapling, two pale islands). Check the trees sit inside each blob for every variant; nudge that variant's `treeOffset` if one doesn't. On `/home` every island is pale (uncharted) on a fresh browser; answer one ALD question and ALD becomes sprouting. Take a screenshot of `/` and `/home` for the review.

- [ ] **Step 5: Commit**

```bash
git add src/components/brand/Island.tsx src/components/map/KnowledgeMap.tsx src/app/page.tsx src/app/new-course/page.tsx
git commit -m "Islands: four fixed looks by course mastery level"
```

---

### Task 11: Docs and final verification

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `docs/MASTERY-PLAN.md` (top note)

- [ ] **Step 1: Update CLAUDE.md's "What exists"**

The section marks every item Phase 1 changes with †. Rewrite those items to describe the new
code and remove the † marks and the sentence that explains them:
- `data.ts`: ALD-only seed, topics without status, no `quizFor` / K-Maps quiz.
- Add `src/lib/mastery/` (evidence types, objective state, topic progress, island level, course
  roll-up, catalogue helpers), `src/lib/content/ald-objectives.ts`, `useMasteryByCourse()` /
  `recordEvidence` and per-course `objectives` in the store, `src/hooks/useNow.ts`, and `npm test`.
- `Island`: four mastery looks. `PathNode`: done / current / upcoming, no locks.
- Remove `chat/ChatBubble` and `/chat` + `/api/chat`.
- In "What to build next", note that Phase 1 is done and Phase 2 (uploads create the course structure) is next.
- In "What exists", describe `src/lib/mastery/due.ts` and `streak.ts`, `useDueItems()` / `useStreak()`, the ALD sample label, and that seed data is ALD-only with no fabricated due items, events, materials or streak.

- [ ] **Step 2: Update README.md**

Delete the `/chat` row from the routes table (it currently says "Being removed in Phase 1"). Add under "Checks": `npm test        # unit tests (Node ≥ 22.6)`.

- [ ] **Step 3: Update the MASTERY-PLAN status note**

In the status note at the top of `docs/MASTERY-PLAN.md`, change "Phase 1 builds §2.2–2.5
on-device" to "§2.2–2.5 are implemented in `src/lib/mastery/` (Phase 1, on-device)".

- [ ] **Step 4: Full verification**

```bash
npx tsc --noEmit
npm run lint
npm test
npm run build
```
Expected: all four succeed. Then `npm run dev` and walk: `/` → `/home` (islands pale) → ALD island → answer a quiz on two topics → trail shows objective counts, ALD island sprouting → a newly created course shows "This island is uncharted." → no chat icon in the nav, and `/chat` returns 404.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md README.md docs/MASTERY-PLAN.md
git commit -m "Docs: Phase 1 mastery core, no in-app chat, test command"
```
