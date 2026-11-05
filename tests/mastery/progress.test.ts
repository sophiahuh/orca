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

test("a topic's progress counts weak points: objectives in rotation mastered or retired, out of those in rotation", () => {
  assert.deepEqual(topicProgress(["a", "b", "c"], map(s("a", "mastered"), s("b", "learning"), s("c", "verified"))), { status: "in-progress", mastered: 1, inRotation: 2, objectives: 3 });
  assert.deepEqual(topicProgress(["a", "b", "c"], map(s("a", "mastered"), s("b", "retired"), s("c", "unseen"))), { status: "done", mastered: 2, inRotation: 2, objectives: 3 });
  assert.equal(topicProgress(["a", "b"], map(s("a", "mastered"), s("b", "fading"))).status, "in-progress", "a fading objective drops out until answered");
});

test("a topic with nothing in rotation is never done, and not started until it has a weak point or an open check", () => {
  assert.deepEqual(topicProgress(["a"], map(s("a", "verified"))), { status: "not-started", mastered: 0, inRotation: 0, objectives: 1 });
  assert.equal(topicProgress(["a", "b"], map(s("a", "unseen"), s("b", "unseen"))).status, "not-started");
  assert.equal(topicProgress(["a", "b"], map(s("a", "learning"), s("b", "unseen"))).status, "in-progress");
  assert.equal(topicProgress(["a"], map(s("a", "check-due"))).status, "in-progress");
  assert.equal(topicProgress(["a", "b"], map(s("a", "mastered"), s("b", "check-due"))).status, "in-progress", "an open check keeps it from done");
});

test("a topic with no objectives is not started", () => {
  assert.deepEqual(topicProgress([], map()), { status: "not-started", mastered: 0, inRotation: 0, objectives: 0 });
});

test("a missing objective state throws", () => {
  assert.throws(() => topicProgress(["a"], map()), /No state computed for objective a/);
});

test("the island follows the share of weak points held; unflagged objectives don't count", () => {
  assert.equal(islandLevel([]), "uncharted");
  assert.equal(islandLevel([s("a", "unseen"), s("b", "verified"), s("c", "check-due")]), "uncharted", "nothing in rotation");
  assert.equal(islandLevel([s("a", "learning"), s("b", "unseen"), s("c", "verified")]), "sprouting");
  assert.equal(islandLevel([s("a", "mastered"), s("b", "learning"), s("c", "learning"), s("d", "learning"), s("e", "verified")]), "sprouting", "a quarter");
  assert.equal(islandLevel([s("a", "mastered"), s("b", "learning"), s("c", "unseen")]), "growing");
  assert.equal(islandLevel([s("a", "mastered"), s("b", "learning"), s("c", "learning"), s("d", "unseen")]), "growing", "a third");
  assert.equal(islandLevel([s("a", "mastered"), s("b", "retired"), s("c", "unseen")]), "thriving");
});

test("fading objectives don't hold an island's level", () => {
  assert.equal(islandLevel([s("a", "fading"), s("b", "fading"), s("c", "mastered")]), "growing");
});
