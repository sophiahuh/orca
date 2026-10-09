import test from "node:test";
import assert from "node:assert/strict";
import { objectivePriority, openConfusion, reasonsOf } from "../../src/lib/mastery/priority.ts";
import type { AnswerEvent, ConfusionEvent, ObjectiveState, ObjectiveStatus } from "../../src/lib/mastery/types.ts";

const now = new Date("2026-10-05T09:00:00Z");
const s = (status: ObjectiveStatus, extra: Partial<ObjectiveState> = {}): ObjectiveState => ({
  objectiveId: "o",
  status,
  credit: 0,
  creditDays: 0,
  stabilityDays: null,
  dueAt: null,
  spacedChecks: 0,
  recall: null,
  lastEvidenceAt: null,
  ...extra,
});
const termsOf = (p: ReturnType<typeof objectivePriority>) => Object.fromEntries(p.terms.map((t) => [t.term, t.value]));

test("an unseen objective: overdue 1, its weight and a full gap", () => {
  const p = objectivePriority(s("unseen"), 1, null, now);
  assert.deepEqual(termsOf(p), { overdue: 1, importance: 1, gap: 1 });
  assert.equal(p.score, 3);
  assert.deepEqual(reasonsOf(p), ["New: not practiced yet"]);
});

test("a learning objective's gap shrinks with credit; no overdue term", () => {
  const p = objectivePriority(s("learning", { credit: 1.5 }), 1, null, now);
  assert.deepEqual(termsOf(p), { importance: 1, gap: 0.5 });
  assert.deepEqual(reasonsOf(p), ["Not mastered yet: 1.5 of 3 correct"]);
});

test("a mixed-up objective adds 2", () => {
  const p = objectivePriority(s("mixed-up", { credit: 1 }), 1, null, now);
  assert.equal(termsOf(p).mixedUp, 2);
  assert.equal(reasonsOf(p)[0], "Mixed up: missed two different questions in a row");
});

test("a fading objective is overdue by days past due over its stability, capped at 1", () => {
  const fading = (dueAt: string, stabilityDays: number) => objectivePriority(s("fading", { dueAt, stabilityDays, credit: 3 }), 1, null, now);
  assert.equal(termsOf(fading("2026-10-03T09:00:00Z", 4)).overdue, 0.5);
  assert.equal(termsOf(fading("2026-09-01T09:00:00Z", 4)).overdue, 1);
  assert.deepEqual(reasonsOf(fading("2026-10-03T09:00:00Z", 4))[0], "Due for a check 2 days ago");
  assert.equal(reasonsOf(fading("2026-10-05T08:00:00Z", 4))[0], "Due for a check today");
  assert.equal(termsOf(fading("2026-10-05T08:00:00Z", 4)).gap, undefined);
});

test("a mastered objective is just its weight; retired scores 0", () => {
  assert.deepEqual(termsOf(objectivePriority(s("mastered", { credit: 3, dueAt: "2026-10-09T00:00:00Z" }), 1.4, null, now)), { importance: 1.4 });
  assert.deepEqual(objectivePriority(s("retired"), 2, "2026-10-01T00:00:00Z", now), { objectiveId: "o", score: 0, terms: [] });
});

test("the weight explains itself only when it isn't neutral", () => {
  assert.deepEqual(reasonsOf(objectivePriority(s("mastered"), 1.5, null, now)), ["Weighted up: the material leans on it"]);
  assert.deepEqual(reasonsOf(objectivePriority(s("mastered"), 0.6, null, now)), ["Weighted down: the material covers it lightly"]);
  assert.deepEqual(reasonsOf(objectivePriority(s("mastered"), 0, null, now)), ["The material says this won't be tested"]);
});

test("open confusion adds 1 with its reason", () => {
  const p = objectivePriority(s("learning"), 1, "2026-10-04T00:00:00Z", now);
  assert.equal(termsOf(p).confusion, 1);
  assert.ok(reasonsOf(p).includes("You said this tripped you up"));
});

test("a fading objective with no due time is a bug, not a guess", () => {
  assert.throws(() => objectivePriority(s("fading"), 1, null, now), /no check due time/);
});

const confusion = (at: string): ConfusionEvent => ({ kind: "confusion", id: at, at, courseId: "c", topicId: "t", objectiveId: "o", materialId: "m", note: "lost" });
const answer = (at: string, outcome: AnswerEvent["outcome"], grader: AnswerEvent["grader"] = "exact"): AnswerEvent => ({
  kind: "answer",
  id: at,
  at,
  courseId: "c",
  topicId: "t",
  objectiveId: "o",
  questionId: "q",
  tier: null,
  outcome,
  grader,
  source: "quiz",
  sessionId: "s",
});

test("confusion stays open until an unaided correct answer comes after it", () => {
  assert.equal(openConfusion("o", []), null);
  assert.equal(openConfusion("o", [confusion("2026-10-01T00:00:00Z")]), "2026-10-01T00:00:00Z");
  assert.equal(openConfusion("o", [answer("2026-09-30T00:00:00Z", "correct"), confusion("2026-10-01T00:00:00Z")]), "2026-10-01T00:00:00Z");
  assert.equal(openConfusion("o", [confusion("2026-10-01T00:00:00Z"), answer("2026-10-02T00:00:00Z", "incorrect")]), "2026-10-01T00:00:00Z");
  assert.equal(openConfusion("o", [confusion("2026-10-01T00:00:00Z"), answer("2026-10-02T00:00:00Z", "correct", "self")]), "2026-10-01T00:00:00Z");
  assert.equal(openConfusion("o", [confusion("2026-10-01T00:00:00Z"), answer("2026-10-02T00:00:00Z", "correct")]), null);
  assert.equal(openConfusion("other", [confusion("2026-10-01T00:00:00Z")]), null);
});
