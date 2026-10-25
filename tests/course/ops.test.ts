import test from "node:test";
import assert from "node:assert/strict";
import type { Objective, QuizQuestion, Topic } from "../../src/lib/data.ts";
import {
  type CourseStructure,
  confirmTopic,
  mergeObjectives,
  mergeTopics,
  rejectObjective,
  rejectTopic,
  renameTopic,
  resolveUncertain,
  restoreObjective,
  restoreTopic,
} from "../../src/lib/course/ops.ts";

const topic = (id: string, name: string, review: Topic["review"] = "proposed"): Topic => ({ id, name, review, pos: { x: 0, y: 0 } });
const objective = (id: string, topicId: string, extra: Partial<Objective> = {}): Objective => ({
  id,
  topicId,
  name: `Do ${id}`,
  description: "",
 
  origin: "material",
  review: "proposed",
  materialId: "m1",
  runId: "r1",
  signals: [],
  ...extra,
});
const question = (id: string, objectiveId: string) => ({ id, objectiveId }) as QuizQuestion;

const base = (): CourseStructure => ({
  topics: [topic("t1", "Karnaugh Maps"), topic("t2", "K-Maps"), topic("t3", "Boolean Algebra", "confirmed")],
  objectives: {
    a: objective("a", "t1"),
    b: objective("b", "t1", { uncertain: { candidateId: "c", reasoning: "Looks like grouping" } }),
    c: objective("c", "t3", { review: "confirmed" }),
    d: objective("d", "t2"),
  },
  bank: { t1: [question("q1", "a"), question("q2", "b")], t2: [question("q3", "d")], t3: [question("q4", "c")] },
});

test("confirming a topic confirms its proposed objectives except uncertain ones", () => {
  const s = confirmTopic(base(), "t1");
  assert.equal(s.topics[0].review, "confirmed");
  assert.equal(s.objectives.a.review, "confirmed");
  assert.equal(s.objectives.b.review, "proposed", "the student still has to answer the duplicate question");
});

test("rejecting a topic archives it and its objectives; restoring brings back only those", () => {
  let s = rejectObjective(base(), "a");
  s = rejectTopic(s, "t1");
  assert.equal(s.topics[0].review, "archived");
  assert.equal(s.objectives.b.review, "archived");
  s = restoreTopic(s, "t1");
  assert.equal(s.topics[0].review, "proposed");
  assert.equal(s.objectives.b.review, "proposed");
  assert.equal(s.objectives.a.review, "archived", "rejected on its own before the topic was");
});

test("renaming changes the name", () => {
  const s = renameTopic(base(), "t2", "Karnaugh Maps (K-Maps)");
  assert.equal(s.topics[1].name, "Karnaugh Maps (K-Maps)");
});

test("merging topics moves objectives and questions and archives the loser with a pointer", () => {
  const s = mergeTopics(base(), "t2", "t1");
  const [, loser] = s.topics;
  assert.equal(loser.review, "archived");
  assert.equal(loser.mergedInto, "t1");
  assert.equal(s.objectives.d.topicId, "t1");
  assert.deepEqual(s.bank.t1.map((q) => q.id), ["q1", "q2", "q3"]);
  assert.deepEqual(s.bank.t2, []);
  assert.throws(() => restoreTopic(s, "t2"), /can't be undone/);
});

test("merging objectives points the loser at the survivor and moves questions across topics", () => {
  const s = mergeObjectives(base(), "b", "c");
  assert.equal(s.objectives.b.mergedInto, "c");
  assert.equal(s.objectives.b.review, "archived");
  assert.equal(s.objectives.b.uncertain, undefined);
  assert.deepEqual(s.bank.t1.map((q) => q.id), ["q1"]);
  assert.deepEqual(s.bank.t3.map((q) => q.id), ["q4", "q2"]);
});

test("undoing a merge restores the objective and its questions", () => {
  const s = restoreObjective(mergeObjectives(base(), "b", "c"), "b");
  assert.equal(s.objectives.b.mergedInto, undefined);
  assert.equal(s.objectives.b.review, "confirmed");
  assert.deepEqual(s.bank.t1.map((q) => q.id), ["q1", "q2"]);
  assert.deepEqual(s.bank.t3.map((q) => q.id), ["q4"]);
});

test("merges can't make a cycle or target an archived objective", () => {
  const s = mergeObjectives(base(), "a", "b");
  assert.throws(() => mergeObjectives(s, "b", "a"), /archived|cycle/);
  assert.throws(() => mergeObjectives(rejectObjective(base(), "c"), "a", "c"), /archived/);
  assert.throws(() => mergeObjectives(base(), "a", "a"), /itself/);
});

test("an uncertain duplicate resolves to a merge or a separate objective", () => {
  assert.equal(resolveUncertain(base(), "b", "same").objectives.b.mergedInto, "c");
  const separate = resolveUncertain(confirmTopic(base(), "t1"), "b", "separate");
  assert.equal(separate.objectives.b.uncertain, undefined);
  assert.equal(separate.objectives.b.review, "confirmed", "its topic is confirmed");
  assert.throws(() => resolveUncertain(base(), "a", "same"), /no open duplicate/);
});

test("an objective under an archived topic can't be restored on its own", () => {
  assert.throws(() => restoreObjective(rejectTopic(base(), "t1"), "a"), /Restore topic/);
});

test("pending review lists proposed topics and open duplicate questions, not archived ones", async () => {
  const { pendingReview } = await import("../../src/lib/course/review.ts");
  const s = base();
  const p = pendingReview(s.topics, s.objectives);
  assert.deepEqual(p.topics.map((t) => t.id), ["t1", "t2"]);
  assert.deepEqual(p.uncertainObjectives.map((o) => o.id), ["b"]);
  assert.equal(p.count, 3);
  const after = rejectTopic(s, "t1");
  assert.equal(pendingReview(after.topics, after.objectives).count, 1);
});
