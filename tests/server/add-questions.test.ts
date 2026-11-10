import test from "node:test";
import assert from "node:assert/strict";
import type { AddQuestion } from "../../src/lib/connector/mcp.ts";
import { addQuestions } from "../../src/lib/server/connector/add-questions.ts";
import { fakeDb } from "../support/fake-db.ts";

const OWNER = "owner-1";
const COURSE = "c0000000-0000-4000-8000-000000000001";
const OBJ = "e0000000-0000-4000-8000-000000000001";
const MERGED = "e0000000-0000-4000-8000-000000000002";
const L1 = "d0000000-0000-4000-8000-000000000001";
const EXAM = "d0000000-0000-4000-8000-000000000002";
const GONE = "d0000000-0000-4000-8000-000000000003";

const topicRow = (id: string, extra: Record<string, unknown> = {}) => ({ id, owner_id: OWNER, course_id: COURSE, name: `Topic ${id}`, review: "confirmed", merged_into: null, material_id: null, uncertain: null, pos_x: 0, pos_y: 0, summary: null, source: null, sort_order: 0, archived_with_material: false, ...extra });
const objectiveRow = (id: string, extra: Record<string, unknown> = {}) => ({ id, owner_id: OWNER, course_id: COURSE, topic_id: "old", name: `Objective ${id}`, description: "", origin: "material", review: "confirmed", merged_into: null, material_id: L1, run_id: null, archived_with_topic: false, archived_with_material: false, uncertain: null, signals: [], ...extra });
const questionRow = (id: string, topicId: string, sortOrder: number) => ({ id, owner_id: OWNER, course_id: COURSE, topic_id: topicId, sort_order: sortOrder, objective_id: OBJ, kind: "Short answer", tier: "retrieval", topic_name: "Topic t", prompt: `Question ${id}?`, table: null, options: [], answer: -1, exact: ["1"], rubric: null, explanation: "", anchor: null, figure: null, material_id: L1, deep: false, source: "orca" });
const materialRow = (id: string, extra: Record<string, unknown> = {}) => ({ id, owner_id: OWNER, course_id: COURSE, filename: `${id}.pdf`, type: "Lecture", status: "ready", held_back: false, created_at: "2026-11-01T00:00:00Z", ...extra });

function db() {
  return fakeDb({
    courses: [{ id: COURSE, owner_id: OWNER, name: "Logic", short: "LOG", orca_notes: null, deleted_at: null }],
    profiles: [{ owner_id: OWNER, orca_notes: null, marker_notes: null }],
    // The objective's row still names the topic merged away; its current topic is t.
    topics: [topicRow("old", { merged_into: "t" }), topicRow("t")],
    objectives: [objectiveRow(OBJ), objectiveRow(MERGED, { merged_into: OBJ })],
    relations: [],
    questions: [questionRow("q1", "t", 0), questionRow("q2", "t", 1)],
    materials: [materialRow(L1), materialRow(EXAM, { type: "Past exam", held_back: true }), materialRow(GONE, { status: "removed" })],
    material_pages: [{ owner_id: OWNER, material_id: L1, n: 4, text: "Carry-save adders defer the carries." }],
  });
}

const choice: AddQuestion = { objectiveId: OBJ, kind: "Multiple choice", prompt: "Which adder has no ripple?", options: ["Ripple carry", "Carry-save", "Serial", "Carry-lookahead"], answer: 1, explanation: "Carry-save defers the carries.", anchor: { locator: "slide 4", excerpt: "defer the carries", materialId: L1 } };
const short: AddQuestion = { objectiveId: OBJ, kind: "Short answer", prompt: "Name the adder that defers carries.", exact: ["carry-save"], explanation: "Carry-save.", anchor: { locator: "problem 2", excerpt: "x", materialId: GONE } };

test("add_questions stores the sound questions through save_structure with source claude, no tier, the objective's current topic, after its last question, and the anchor's material when live", async () => {
  const d = db();
  const got = await addQuestions(d as never, OWNER, COURSE, [choice, short]);
  assert.ok(!("error" in got));
  assert.deepEqual(got.refused, []);
  assert.deepEqual(got.added.map((a) => a.objectiveId), [OBJ, OBJ]);
  assert.equal(d.rpcCalls.length, 1);
  assert.equal(d.rpcCalls[0].name, "save_structure");
  const rows = (d.rpcCalls[0].args as { course: string; rows: { questions?: Array<Record<string, unknown>>; topics?: unknown; objectives?: unknown; runs?: unknown } }).rows;
  assert.equal((d.rpcCalls[0].args as { course: string }).course, COURSE);
  assert.equal(rows.topics, undefined, "nothing but the new questions is saved");
  assert.equal(rows.objectives, undefined);
  assert.equal(rows.runs, undefined);
  assert.deepEqual(
    rows.questions!.map((q) => [q.id, q.topic_id, q.sort_order, q.source, q.tier, q.material_id, q.kind, q.answer, q.topic_name]),
    [
      [got.added[0].id, "t", 2, "claude", null, L1, "Multiple choice", 1, "Topic t"],
      [got.added[1].id, "t", 3, "claude", null, null, "Short answer", -1, "Topic t"],
    ],
    "after the topic's two questions; the removed material's id is dropped",
  );
  assert.deepEqual(rows.questions![0].anchor, { locator: "slide 4", excerpt: "defer the carries" });
  assert.deepEqual(rows.questions![1].exact, ["carry-save"]);
});

test("add_questions refuses per item with a reason and stores the rest; nothing is saved when none pass", async () => {
  const d = db();
  const got = await addQuestions(d as never, OWNER, COURSE, [
    { ...choice, objectiveId: MERGED },
    { ...choice, objectiveId: "e0000000-0000-4000-8000-000000000009" },
    { ...choice, anchor: { locator: "page 1", excerpt: "x", materialId: EXAM } },
    { ...short, exact: ["a + b"] },
    { ...choice, anchor: { locator: "slide 9", excerpt: "x", materialId: L1 } },
    { ...choice, prompt: "Which <b>adder</b>?" },
    choice,
  ]);
  assert.ok(!("error" in got));
  assert.deepEqual(got.added.map((a) => a.objectiveId), [OBJ]);
  assert.deepEqual(
    got.refused.map((r) => [r.index, r.reason]),
    [
      [0, "objectiveId isn't a live objective of this course; use an id from course_state"],
      [1, "objectiveId isn't a live objective of this course; use an id from course_state"],
      [2, "its anchor names a held-back material (kept for a practice test); write from material_for's pieces instead"],
      [3, "an algebraic or Boolean expression as an exact answer (give a rubric or make it multiple choice)"],
      [4, "its anchor names slide 9, which that material doesn't have"],
      [5, "prompt contains HTML"],
    ],
  );
  assert.equal(d.rpcCalls.length, 1);
  const none = db();
  const nothing = await addQuestions(none as never, OWNER, COURSE, [{ ...choice, prompt: "Which <b>adder</b>?" }]);
  assert.ok(!("error" in nothing));
  assert.deepEqual(nothing.added, []);
  assert.equal(none.rpcCalls.length, 0, "no save when nothing passed");
});

test("add_questions names a course that isn't the student's", async () => {
  assert.deepEqual(await addQuestions(db() as never, "someone-else", COURSE, [choice]), { error: "No such course." });
});
