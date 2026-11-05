import test from "node:test";
import assert from "node:assert/strict";
import { attribution, eventsCountingFor } from "../../src/lib/mastery/attribution.ts";
import type { AnswerEvent, ConfusionEvent, ObjectiveInfo } from "../../src/lib/mastery/types.ts";

const catalogue: Record<string, ObjectiveInfo> = {
  a: { id: "a", topicId: "t1", name: "A", review: "confirmed" },
  b: { id: "b", topicId: "t1", name: "B", review: "archived", mergedInto: "c" },
  c: { id: "c", topicId: "t1", name: "C", review: "confirmed" },
  gone: { id: "gone", topicId: "t1", name: "Gone", review: "archived" },
  d: { id: "d", topicId: "t2", name: "D", review: "confirmed" },
};
const bank = {
  t1: [
    { id: "q1", objectiveId: "a" },
    { id: "q2", objectiveId: "b", tier: "mechanism" as const },
    { id: "q3", objectiveId: "c" },
    { id: "q4", objectiveId: "gone" },
  ],
  t2: [{ id: "q6", objectiveId: "d" }],
};
const answer = (questionId: string, objectiveId: string, over: Partial<AnswerEvent> = {}): AnswerEvent => ({
  kind: "answer",
  id: `${questionId}-${objectiveId}`,
  at: "2026-10-05T12:00:00Z",
  courseId: "course",
  topicId: "t1",
  objectiveId,
  questionId,
  tier: null,
  outcome: "correct",
  grader: "choice",
  source: "quiz",
  sessionId: "s",
  ...over,
});
const confusion = (objectiveId: string): ConfusionEvent => ({
  kind: "confusion",
  id: `c-${objectiveId}`,
  at: "2026-10-05T12:00:00Z",
  courseId: "course",
  topicId: "t1",
  objectiveId,
  materialId: "m",
  note: "?",
  flagSource: "homework",
  page: null,
});

const att = attribution({ topicIds: ["t1"], bank, catalogue });

test("lists the objectives that can hold state now, with whether they have mechanism questions", () => {
  assert.deepEqual([...att.objectives.keys()].sort(), ["a", "c"]);
  assert.equal(att.objectives.get("c")!.hasMechanismQuestions, true, "q2 came with the merge");
  assert.equal(att.objectives.get("a")!.hasMechanismQuestions, false);
});

test("an answer counts for its question's current objective, whatever was recorded", () => {
  assert.equal(att.countsFor(answer("q1", "c")), "a");
  assert.equal(att.countsFor(answer("q2", "b")), "c");
});

test("otherwise an event counts for its recorded objective, following merges", () => {
  assert.equal(att.countsFor(answer("q-deleted", "b")), "c");
  assert.equal(att.countsFor(confusion("b")), "c");
  assert.equal(att.countsFor(confusion("a")), "a");
});

test("events on archived objectives or topics left off the trail count for nothing", () => {
  assert.equal(att.countsFor(answer("q4", "gone")), null);
  assert.equal(att.countsFor(confusion("gone")), null);
  assert.equal(att.countsFor(answer("q6", "d", { topicId: "t2" })), null, "t2 isn't on the trail");
  assert.equal(att.refile(answer("q4", "gone")), "gone", "refile still names where it went");
});

test("eventsCountingFor picks an objective's events, filed under it", () => {
  const log = [answer("q1", "a"), answer("q2", "b"), confusion("b"), answer("q4", "gone")];
  const forC = eventsCountingFor("c", log, att);
  assert.deepEqual(forC.map((e) => e.id), ["q2-b", "c-b"]);
  assert.ok(forC.every((e) => e.objectiveId === "c"));
  assert.deepEqual(eventsCountingFor("gone", log, att), []);
});

test("an objective with no questions holds state too; merged, archived and off-trail ones don't", () => {
  const withBare: Record<string, ObjectiveInfo> = { ...catalogue, bare: { id: "bare", topicId: "t1", name: "Bare", review: "proposed" }, old: { id: "old", topicId: "t1", name: "Old", review: "archived", mergedInto: "bare" } };
  const a = attribution({ topicIds: ["t1"], bank, catalogue: withBare });
  assert.deepEqual(a.perTopic[0].list.map((o) => o.id), ["a", "c", "bare"], "question-bearing objectives first, then the rest");
  assert.deepEqual(a.objectives.get("bare")!.questionIds, []);
  assert.equal(a.objectives.get("bare")!.hasMechanismQuestions, false);
  assert.equal(a.countsFor(confusion("bare")), "bare");
  assert.equal(a.countsFor(confusion("old")), "bare", "a flag on a merged-away objective follows the merge");
  assert.equal(a.countsFor(confusion("d")), null, "t2 isn't on the trail");
  assert.equal(a.objectives.has("gone"), false);
});
