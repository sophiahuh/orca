import test from "node:test";
import assert from "node:assert/strict";
import { courseView, eventFromRow, eventToRow } from "../../src/lib/supabase/rows.ts";
import type { AnswerEvent, ConfusionEvent } from "../../src/lib/mastery/types.ts";

const answer: AnswerEvent = {
  kind: "answer",
  id: "e1",
  at: "2026-10-05T12:00:00.123Z",
  courseId: "c",
  topicId: "t",
  objectiveId: "o",
  questionId: "q",
  tier: "mechanism",
  outcome: "partial",
  grader: "rubric",
  source: "deep-review",
  sessionId: "s",
};
const confusion: ConfusionEvent = { kind: "confusion", id: "e2", at: "2026-10-05T12:00:00.000Z", courseId: "c", topicId: "t", objectiveId: "o", materialId: "m", note: "lost" };

test("events survive the trip to a row and back, with Postgres's timestamp format normalised", () => {
  for (const e of [answer, confusion]) {
    const row = { ...eventToRow(e), owner_id: "u" };
    assert.deepEqual(eventFromRow({ ...row, at: row.at.replace("Z", "+00:00") }), e);
  }
});

test("a row missing a field its kind needs throws instead of becoming a partial event", () => {
  const row = { ...eventToRow(answer), owner_id: "u", outcome: null };
  assert.throws(() => eventFromRow(row), /missing/);
});

test("courseView orders the trail, leaves archived topics off it and uses the student's timezone", () => {
  const view = courseView({
    topics: [
      { id: "t2", review: "confirmed", sort_order: 1 },
      { id: "t1", review: "confirmed", sort_order: 0 },
      { id: "t3", review: "archived", sort_order: 2 },
    ],
    objectives: [
      { id: "a", topic_id: "t1", name: "A", review: "confirmed", merged_into: null },
      { id: "b", topic_id: "t1", name: "B", review: "archived", merged_into: "a" },
      { id: "c", topic_id: "t3", name: "C", review: "confirmed", merged_into: null },
    ],
    questions: [
      { id: "q2", topic_id: "t1", objective_id: "b", tier: "mechanism", sort_order: 1 },
      { id: "q1", topic_id: "t1", objective_id: "a", tier: null, sort_order: 0 },
      { id: "q3", topic_id: "t3", objective_id: "c", tier: null, sort_order: 0 },
    ],
    timezone: "America/New_York",
  });
  assert.deepEqual(view.attribution.perTopic.map((t) => t.topicId), ["t1", "t2"]);
  assert.deepEqual([...view.attribution.objectives.keys()], ["a"]);
  assert.deepEqual(view.attribution.objectives.get("a")!.questionIds, ["q1", "q2"]);
  assert.equal(view.attribution.objectives.get("a")!.hasMechanismQuestions, true);
  assert.equal(view.dayKey("2026-10-05T03:00:00Z"), "2026-10-04");
});
