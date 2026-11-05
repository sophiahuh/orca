import test from "node:test";
import assert from "node:assert/strict";
import { diveObjectives } from "../../src/lib/mastery/practice.ts";
import type { RankedObjective } from "../../src/lib/mastery/agenda.ts";
import type { ObjectiveStatus } from "../../src/lib/mastery/types.ts";

const r = (objectiveId: string, status: ObjectiveStatus, weight = 1, topicId = "t1", reached = true): RankedObjective => ({
  objectiveId,
  topicId,
  status,
  priority: { objectiveId, score: weight, terms: [] },
  weight,
  reached,
});

test("practice covers unflagged objectives (not flagged or verified), highest weight first", () => {
  const ranked = [r("a", "learning", 2), r("b", "unseen", 1), r("c", "verified", 1.5), r("d", "retired", 2), r("e", "check-due", 2)];
  assert.deepEqual(diveObjectives(ranked, "practice"), ["c", "b"]);
});

test("practice leaves out material the class hasn't reached and objectives that won't be tested", () => {
  const ranked = [r("a", "unseen", 1, "t1", false), r("b", "unseen", 0), r("c", "unseen", 1)];
  assert.deepEqual(diveObjectives(ranked, "practice"), ["c"]);
});

test("a course-wide dive covers weak points first (in priority order), then unflagged objectives by weight", () => {
  const ranked = [r("b", "unseen", 2), r("a", "learning", 1), r("e", "check-due", 1), r("c", "verified", 1), r("d", "retired", 2), r("x", "fading", 1, "t1", false), r("z", "learning", 0)];
  assert.deepEqual(diveObjectives(ranked, "course"), ["a", "e", "b", "c"]);
});

test("a topic dive covers every objective in the topic but retired ones, reached or not", () => {
  const ranked = [r("a", "unseen", 1, "t1", false), r("b", "learning", 1, "t2"), r("c", "retired", 1, "t1")];
  assert.deepEqual(diveObjectives(ranked, "course", { topicId: "t1" }), ["a"]);
});

test("exam practice covers unflagged objectives in the exam's topics, or the whole course when it lists none", () => {
  const ranked = [r("a", "unseen", 1, "t1"), r("b", "unseen", 1, "t2"), r("c", "learning", 1, "t1")];
  assert.deepEqual(diveObjectives(ranked, "exam", { examTopicIds: ["t1"] }), ["a"]);
  assert.deepEqual(diveObjectives(ranked, "exam", { examTopicIds: [] }), ["a", "b"]);
});
