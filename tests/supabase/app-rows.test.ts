import test from "node:test";
import assert from "node:assert/strict";
import type { Objective, QuizQuestion, Topic } from "../../src/lib/data.ts";
import { DEFAULT_CONFIG } from "../../src/lib/data.ts";
import {
  type MyData,
  type StructureState,
  loadedState,
  objectiveFromRow,
  objectiveToRow,
  questionFromRow,
  questionToRow,
  structureRows,
  topicFromRow,
  topicToRow,
} from "../../src/lib/supabase/app-rows.ts";

const topic: Topic = { id: "t1", name: "Boolean algebra", aliases: [], review: "proposed", pos: { x: 330, y: 240 }, uncertain: { candidateId: "t0", reasoning: "same" } };
const objective: Objective = { id: "o1", topicId: "t1", name: "Simplify", description: "", aliases: [], origin: "material", review: "proposed", materialId: "m", runId: "r", signals: [] };
const question: QuizQuestion = { id: "q1", kind: "Short answer", topic: "Boolean algebra", prompt: "x + xy?", options: [], answer: -1, exact: ["x"], explanation: "", anchor: { locator: "slide 2", excerpt: "x" }, objectiveId: "o1" };
const owned = { owner_id: "u", course_id: "c", created_at: "2026-10-05T12:00:00+00:00" };

test("structure rows round-trip, and absent optional fields come back absent", () => {
  assert.deepEqual(topicFromRow({ ...topicToRow(topic, 0), ...owned }), topic);
  assert.deepEqual(objectiveFromRow({ ...objectiveToRow(objective), ...owned }), objective);
  assert.deepEqual(questionFromRow({ ...questionToRow(question, "t1", 0), ...owned }), question);
});

test("a save sends only changed rows, names cleared fields as null, and carries positions", () => {
  const before: StructureState = { topics: [topic], objectives: { o1: objective }, bank: { t1: [question] }, relations: [] };
  const settled = { ...topic, review: "confirmed" as const };
  delete (settled as Partial<Topic>).uncertain;
  const after: StructureState = { ...before, topics: [settled], bank: { t2: [question] } };
  const rows = structureRows(before, after);
  assert.deepEqual(Object.keys(rows).sort(), ["questions", "topics"]);
  assert.equal(rows.topics![0].uncertain, null, "the cleared duplicate flag is written as null");
  assert.equal(rows.questions![0].topic_id, "t2", "a question moved to another topic saves its new topic");
  assert.deepEqual(structureRows(before, before), {}, "no change, nothing to save");
});

test("an existing row is saved with only the columns that changed; a new row whole", () => {
  const before: StructureState = { topics: [topic], objectives: { o1: objective }, bank: {}, relations: [] };
  const added: Topic = { ...topic, id: "t2", name: "K-maps" };
  const after: StructureState = { ...before, topics: [{ ...topic, aliases: ["Switching algebra"] }, added] };
  const rows = structureRows(before, after);
  assert.deepEqual(rows.topics![0], { id: "t1", aliases: ["Switching algebra"] });
  assert.deepEqual(rows.topics![1], topicToRow(added, 1));
});

test("a row that disappears is refused: nothing is ever deleted", () => {
  const before: StructureState = { topics: [topic], objectives: { o1: objective }, bank: {}, relations: [] };
  assert.throws(() => structureRows(before, { ...before, objectives: {} }), /disappeared/);
});

test("loading groups rows by course and puts questions in stock order", () => {
  const data: MyData = {
    profile: { owner_id: "u", timezone: "America/New_York", onboarded: true, avatar: "orca", name: null, default_review_config: null, default_weights: { lectures: 40 }, created_at: owned.created_at },
    courses: [{ id: "c", owner_id: "u", slug: "logic", name: "Logic", short: "LOG", variant: "circuit", pos_x: 70, pos_y: 110, trail: null, review_config: { quick: { duration: "10 min", cadence: "Daily" }, deep: { duration: "30 min", cadence: "Weekly" }, exam: { duration: "10 hours", cadence: "1 wk before exam" } }, weights: { lectures: 25 }, created_at: owned.created_at }],
    materials: [],
    runs: [],
    topics: [{ ...topicToRow(topic, 0), ...owned }],
    objectives: [{ ...objectiveToRow(objective), ...owned }],
    relations: [],
    questions: [{ ...questionToRow({ ...question, id: "q2" }, "t1", 1), ...owned }, { ...questionToRow(question, "t1", 0), ...owned }],
    sessions: [],
    calendar: [],
    exams: [],
    evidence: [],
    snapshots: [],
  };
  const s = loadedState(data);
  assert.equal(s.timezone, "America/New_York");
  assert.equal(s.defaultConfig, null);
  assert.deepEqual(s.defaultWeights, { lectures: 40 });
  assert.deepEqual(s.courses[0].topics, [topic]);
  assert.deepEqual(s.questionBank.c.t1.map((q) => q.id), ["q1", "q2"]);
  assert.deepEqual(s.relations.c, []);
  assert.throws(() => loadedState({ ...data, courses: [{ ...data.courses[0], review_config: { quick: "daily" } }] }), "a malformed config is refused, not shown");

  // A course's settings: its own override first, else the account default, else Orca's built-in one.
  const inherit = loadedState({ ...data, courses: [{ ...data.courses[0], review_config: null, weights: null }] });
  assert.deepEqual(inherit.weights.c, { lectures: 40 }, "no override: the account default");
  assert.deepEqual(inherit.configs.c, DEFAULT_CONFIG, "no override and no account default: Orca's");
  assert.equal(inherit.configOverrides.c, null);
  assert.deepEqual(s.weights.c, { lectures: 25 }, "an override wins over the account default");
  assert.deepEqual(s.weightOverrides.c, { lectures: 25 });

  const material = { id: "m", course_id: "c", owner_id: "u", filename: "L01.pdf", type: "Lecture", assigned: null, due: null, reflect: false, reflection: null, storage_path: "u/m/L01.pdf", content_hash: "h", size_bytes: 10, mime: "application/pdf", status: "ready", error: null, hidden_text: { items: 2, pages: [3] }, reading_since: null, created_at: owned.created_at };
  const withFiles = loadedState({ ...data, materials: [material, { ...material, id: "m2", status: "uploaded", hidden_text: null }, { ...material, id: "m3", status: "failed", error: "unreadable" }] });
  assert.deepEqual(withFiles.materials.map((m) => [m.id, m.hiddenText]), [["m", { items: 2, pages: [3] }]], "only read uploads are part of the course; the hidden-text record comes along");
});
