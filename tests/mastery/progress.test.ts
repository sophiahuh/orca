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
  recall: null,
  lastEvidenceAt: null,
});
const map = (...states: ObjectiveState[]) => new Map(states.map((x) => [x.objectiveId, x]));

test("a topic is done only when every objective is mastered or retired", () => {
  assert.deepEqual(topicProgress(["a", "b"], map(s("a", "mastered"), s("b", "retired"))), { status: "done", mastered: 2, total: 2 });
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

test("fading objectives don't hold an island's level", () => {
  assert.equal(islandLevel([s("a", "fading"), s("b", "fading"), s("c", "mastered")]), "growing");
});
