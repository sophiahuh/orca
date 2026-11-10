import test from "node:test";
import assert from "node:assert/strict";
import { courseView, eventFromRow, eventToRow } from "../../src/lib/supabase/rows.ts";
import type { AnswerEvent, ConfusionEvent, SignalEvent, WorkEvent } from "../../src/lib/mastery/types.ts";

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
const confusion: ConfusionEvent = { kind: "confusion", id: "e2", at: "2026-10-05T12:00:00.000Z", courseId: "c", topicId: "t", objectiveId: "o", materialId: "m", note: "lost", flagSource: "homework", page: null };
const manual: ConfusionEvent = { kind: "confusion", id: "e3", at: "2026-11-05T12:00:00.000Z", courseId: "c", topicId: "t", objectiveId: "o", materialId: null, note: null, flagSource: "manual", page: null };
const slide: ConfusionEvent = { ...manual, id: "e4", flagSource: "slide", materialId: "m", page: 4 };
const struggledByClaude: ConfusionEvent = { ...manual, id: "e5", flagSource: "connector-struggled", note: "I'm lost on carries" };
const reported: AnswerEvent = { ...answer, id: "e6", source: "connector", grader: "claude", outcome: "correct", response: "no ripple", help: "hint", confidence: 2, errorType: "sign" };
const work: WorkEvent = { kind: "work", id: "e7", at: "2026-11-10T12:00:00.000Z", courseId: "c", topicId: "t", objectiveId: "o", problem: "Add 0110 and 0011.", response: "1001", basis: "known-answer", outcome: "correct", source: "connector", sessionId: "chat", help: "none", confidence: 3 };
const bareWork: WorkEvent = { kind: "work", id: "e8", at: "2026-11-10T12:01:00.000Z", courseId: "c", topicId: "t", objectiveId: "o", problem: "Simplify x + xy.", basis: "claude", outcome: "partial", source: "connector", sessionId: "chat" };
const signal: SignalEvent = { kind: "signal", id: "e9", at: "2026-11-10T12:02:00.000Z", courseId: "c", topicId: "t", objectiveId: "o", signal: "lost", note: "went quiet", source: "connector", sessionId: "chat" };
const bareSignal: SignalEvent = { ...signal, id: "e10", signal: "got-it", note: null };

test("events survive the trip to a row and back, with Postgres's timestamp format normalised", () => {
  for (const e of [answer, confusion, manual, slide, struggledByClaude, reported, work, bareWork, signal, bareSignal]) {
    const row = { ...eventToRow(e), owner_id: "u" };
    assert.deepEqual(eventFromRow({ ...row, at: row.at.replace("Z", "+00:00") }), e);
  }
});

test("a connector answer's words ride the note column and come back as response", () => {
  const said: AnswerEvent = { ...answer, id: "e9", source: "connector", grader: "exact", response: "x + y" };
  const row = { ...eventToRow(said), owner_id: "u" };
  assert.equal(row.note, "x + y");
  assert.deepEqual(eventFromRow(row), said);
  assert.equal(eventToRow(answer).note, null, "an answer without words stores none");
});

test("a row missing a field its kind needs throws instead of becoming a partial event", () => {
  const row = { ...eventToRow(answer), owner_id: "u", outcome: null };
  assert.throws(() => eventFromRow(row), /missing/);
  assert.throws(() => eventFromRow({ ...eventToRow(work), owner_id: "u", problem: null }), /missing/);
  assert.throws(() => eventFromRow({ ...eventToRow(signal), owner_id: "u", signal: null }), /missing/);
});

test("work and signal rows: the problem, basis and signal columns, the words on note, nothing of an answer's", () => {
  const w = eventToRow(work);
  assert.deepEqual([w.problem, w.basis, w.outcome, w.note, w.help, w.confidence, w.error_type, w.question_id, w.signal, w.flag_source], ["Add 0110 and 0011.", "known-answer", "correct", "1001", "none", 3, null, null, null, null]);
  const sg = eventToRow(signal);
  assert.deepEqual([sg.signal, sg.note, sg.source, sg.session_id, sg.problem, sg.outcome, sg.help], ["lost", "went quiet", "connector", "chat", null, null, null]);
  const a = eventToRow(reported);
  assert.deepEqual([a.grader, a.help, a.confidence, a.error_type, a.problem, a.signal], ["claude", "hint", 2, "sign", null, null]);
  assert.deepEqual([eventToRow(answer).help, eventToRow(answer).confidence, eventToRow(answer).error_type], [null, null, null], "an answer without a report stores none");
});

test("a struggle flag's row carries its source and page; an answer's carries neither", () => {
  assert.deepEqual([eventToRow(slide).flag_source, eventToRow(slide).page, eventToRow(slide).material_id], ["slide", 4, "m"]);
  assert.deepEqual([eventToRow(manual).material_id, eventToRow(manual).note], [null, null]);
  assert.deepEqual([eventToRow(answer).flag_source, eventToRow(answer).page], [null, null]);
});

test("a confusion row without a flag source is refused, not guessed", () => {
  assert.throws(() => eventFromRow({ ...eventToRow(confusion), owner_id: "u", flag_source: null }), /no flag source/);
});

test("courseView orders the trail, leaves archived topics off it and uses the student's timezone", () => {
  const view = courseView({
    topics: [
      { id: "t2", review: "confirmed", sort_order: 1, merged_into: null },
      { id: "t1", review: "confirmed", sort_order: 0, merged_into: null },
      { id: "t3", review: "archived", sort_order: 2, merged_into: null },
    ],
    objectives: [
      { id: "a", topic_id: "t1", name: "A", review: "confirmed", merged_into: null },
      { id: "b", topic_id: "t1", name: "B", review: "archived", merged_into: "a" },
      { id: "c", topic_id: "t3", name: "C", review: "confirmed", merged_into: null },
    ],
    questions: [
      { id: "q2", objective_id: "b", tier: "mechanism", sort_order: 1 },
      { id: "q1", objective_id: "a", tier: null, sort_order: 0 },
      { id: "q3", objective_id: "c", tier: null, sort_order: 0 },
    ],
    timezone: "America/New_York",
  });
  assert.deepEqual(view.attribution.perTopic.map((t) => t.topicId), ["t1", "t2"]);
  assert.deepEqual([...view.attribution.objectives.keys()], ["a"]);
  assert.deepEqual(view.attribution.objectives.get("a")!.questionIds, ["q1", "q2"]);
  assert.equal(view.attribution.objectives.get("a")!.hasMechanismQuestions, true);
  assert.equal(view.dayKey("2026-10-05T03:00:00Z"), "2026-10-04");
});

test("the server's view files a question saved under a stale topic by its objective, so a merge mid-job can't break the course", () => {
  const view = courseView({
    timezone: "UTC",
    topics: [
      { id: "T1", review: "confirmed", sort_order: 0, merged_into: null },
      { id: "T2", review: "confirmed", sort_order: 1, merged_into: null },
      { id: "T3", review: "archived", sort_order: 2, merged_into: "T2" },
    ],
    objectives: [
      { id: "X", topic_id: "T1", name: "X", review: "archived", merged_into: "Y" },
      { id: "Y", topic_id: "T2", name: "Y", review: "confirmed", merged_into: null },
      { id: "Z", topic_id: "T3", name: "Z", review: "confirmed", merged_into: null },
    ],
    questions: [
      { id: "q-y", objective_id: "Y", tier: null, sort_order: 0 },
      { id: "dive-q", objective_id: "X", tier: null, sort_order: 1 },
      { id: "q-z", objective_id: "Z", tier: null, sort_order: 2 },
    ],
  });
  assert.deepEqual(view.attribution.objectives.get("Y")?.questionIds, ["q-y", "dive-q"], "X was merged into Y while a dive wrote for X");
  assert.deepEqual(view.attribution.objectives.get("Z")?.questionIds, ["q-z"], "an objective created in a topic merged meanwhile follows the topic");
});
