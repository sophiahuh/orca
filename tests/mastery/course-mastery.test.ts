import test from "node:test";
import assert from "node:assert/strict";
import { courseMastery } from "../../src/lib/mastery/course-mastery.ts";
import type { EvidenceEvent } from "../../src/lib/mastery/types.ts";

const catalogue = {
  "t1/a": { id: "t1/a", topicId: "t1", name: "A", review: "confirmed" as const },
  "t2/b": { id: "t2/b", topicId: "t2", name: "B", review: "confirmed" as const },
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
  sessionId: "s1",
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
  assert.equal(m.objectivesNeedingQuestions.get("t1"), 0, "t1/a has 3 questions");
  assert.equal(m.objectivesNeedingQuestions.get("t2"), 1, "t2/b has only 1 question");
  assert.equal(m.objectivesNeedingQuestions.get("t3"), 0);
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

test("answers on a merged objective count for the survivor; answers on an archived one count for nothing", () => {
  const day1 = [ev("q4", "2026-10-01T12:00:00Z")].map((e) => ({ ...e, topicId: "t2", objectiveId: "t2/b" }));
  const merged = {
    ...catalogue,
    "t2/b": { ...catalogue["t2/b"], review: "archived" as const, mergedInto: "t2/c" },
    "t2/c": { id: "t2/c", topicId: "t2", name: "C", review: "confirmed" as const },
  };
  const m = courseMastery({ ...base, catalogue: merged, evidence: day1, now: new Date("2026-10-01T13:00:00Z") });
  assert.equal(m.objectives.get("t2/c")!.status, "learning");
  assert.equal(m.objectives.has("t2/b"), false);

  const archived = { ...catalogue, "t2/b": { ...catalogue["t2/b"], review: "archived" as const } };
  const a = courseMastery({ ...base, catalogue: archived, evidence: day1, now: new Date("2026-10-01T13:00:00Z") });
  assert.equal(a.objectives.has("t2/b"), false);
  assert.deepEqual(a.topics.get("t2"), { status: "not-started", mastered: 0, total: 0 });
});
