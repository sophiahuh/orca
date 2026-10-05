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
  recall: null,
  lastEvidenceAt: null,
});
const now = new Date("2026-10-05T09:00:00Z");

test("groups objectives that are due by topic, into today and tomorrow", () => {
  const objectives = new Map([
    ["t1/a", s("t1/a", "fading", "2026-10-04T12:00:00Z")],
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
