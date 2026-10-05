import test from "node:test";
import assert from "node:assert/strict";
import { addDays, courseAgenda, withNeutralWeights } from "../../src/lib/mastery/agenda.ts";
import { courseMastery } from "../../src/lib/mastery/course-mastery.ts";
import type { AnswerEvent, EvidenceEvent } from "../../src/lib/mastery/types.ts";
import { DEFAULT_CONFIG, type QuizResult, type ReviewConfig } from "../../src/lib/data.ts";

const utcDay = (iso: string) => iso.slice(0, 10);
const catalogue = {
  a: { id: "a", topicId: "t1", name: "A", review: "confirmed" as const },
  b: { id: "b", topicId: "t1", name: "B", review: "confirmed" as const },
  c: { id: "c", topicId: "t2", name: "C", review: "confirmed" as const },
};
const bank = {
  t1: [
    { id: "a1", objectiveId: "a" },
    { id: "a2", objectiveId: "a" },
    { id: "a3", objectiveId: "a" },
    { id: "a4", objectiveId: "a" },
    { id: "b1", objectiveId: "b" },
    { id: "b2", objectiveId: "b" },
  ],
  t2: [{ id: "c1", objectiveId: "c" }],
};
const topicOf: Record<string, string> = { a: "t1", b: "t1", c: "t2" };

let n = 0;
const ans = (questionId: string, at: string, outcome: AnswerEvent["outcome"] = "correct", sessionId = "s1"): AnswerEvent => {
  const objectiveId = questionId[0];
  return { kind: "answer", id: `e${n++}`, at, courseId: "k", topicId: topicOf[objectiveId], objectiveId, questionId, tier: null, outcome, grader: "exact", source: "quick-review", sessionId };
};
const finished = (sessionId: string, finishedAt: string, mode: QuizResult["mode"] = "quick"): QuizResult => ({ courseId: "k", topicId: null, mode, sessionId, correct: 0, total: 0, seconds: 0, finishedAt });

function agenda(evidence: EvidenceEvent[], now: string, opts: { results?: QuizResult[]; config?: ReviewConfig; examDays?: string[]; weights?: Record<string, number> } = {}) {
  const mastery = courseMastery({ courseId: "k", topicIds: ["t1", "t2"], bank, catalogue, evidence, now: new Date(now), dayKey: utcDay });
  const weights = withNeutralWeights(mastery.objectives.keys(), new Map(Object.entries({ a: 1, b: 1, c: 1, ...opts.weights })), () => false);
  return courseAgenda({ courseId: "k", mastery, weights, config: opts.config ?? DEFAULT_CONFIG, results: opts.results ?? [], examDays: opts.examDays ?? [], now: new Date(now), dayKey: utcDay });
}

test("addDays is plain calendar arithmetic", () => {
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(addDays("2026-03-08", 1), "2026-03-09");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
});

test("everything unseen is due today, ranked by priority (weight breaks the tie)", () => {
  const g = agenda([], "2026-10-05T09:00:00Z", { weights: { c: 1.5 } });
  assert.deepEqual(g.dueToday.map((r) => r.objectiveId), ["c", "a", "b"]);
  assert.equal(g.quickReviewDue, true);
});

test("weight 0 (the material says it won't be tested) is never due", () => {
  const g = agenda([], "2026-10-05T09:00:00Z", { weights: { b: 0 } });
  assert.deepEqual(g.dueToday.map((r) => r.objectiveId), ["a", "c"]);
});

test("mastered objectives leave today's list; a check landing tomorrow is due tomorrow; fading comes back", () => {
  const evidence = [ans("a1", "2026-10-01T10:00:00Z"), ans("a2", "2026-10-01T10:05:00Z"), ans("a3", "2026-10-02T10:00:00Z")];
  const mastered = agenda(evidence, "2026-10-02T11:00:00Z");
  assert.ok(!mastered.dueToday.some((r) => r.objectiveId === "a"));
  const dueAt = courseMastery({ courseId: "k", topicIds: ["t1", "t2"], bank, catalogue, evidence, now: new Date("2026-10-02T11:00:00Z"), dayKey: utcDay }).objectives.get("a")!.dueAt!;
  const dayBefore = `${addDays(utcDay(dueAt), -1)}T12:00:00Z`;
  assert.deepEqual(agenda(evidence, dayBefore).dueTomorrow.map((r) => r.objectiveId), ["a"]);
  const later = agenda(evidence, `${addDays(utcDay(dueAt), 1)}T12:00:00Z`);
  assert.equal(later.dueToday.find((r) => r.objectiveId === "a")?.status, "fading");
});

test("quick review cadence: daily until one is finished today; weekly within 7 days; exam window", () => {
  const now = "2026-10-05T18:00:00Z";
  assert.equal(agenda([], now, { results: [finished("x", "2026-10-05T08:00:00Z")] }).quickReviewDue, false);
  assert.equal(agenda([], now, { results: [finished("x", "2026-10-04T08:00:00Z")] }).quickReviewDue, true);
  assert.equal(agenda([], now, { results: [finished("x", "2026-10-05T08:00:00Z", "topic")] }).quickReviewDue, true, "a topic quiz isn't the quick review");
  const weekly: ReviewConfig = { ...DEFAULT_CONFIG, quick: { duration: "10 min", cadence: "Weekly" } };
  assert.equal(agenda([], now, { config: weekly, results: [finished("x", "2026-09-30T08:00:00Z")] }).quickReviewDue, false);
  assert.equal(agenda([], now, { config: weekly, results: [finished("x", "2026-09-28T08:00:00Z")] }).quickReviewDue, true);
  const exam: ReviewConfig = { ...DEFAULT_CONFIG, quick: { duration: "10 min", cadence: "1 wk before exam" } };
  assert.equal(agenda([], now, { config: exam, examDays: ["2026-10-20"] }).quickReviewDue, false);
  assert.equal(agenda([], now, { config: exam, examDays: ["2026-10-12"] }).quickReviewDue, true);
  assert.equal(agenda([], now, { config: exam, examDays: ["2026-10-01"] }).quickReviewDue, false);
});

test("deep review: nothing to review before any answer; due a cadence after the first answer, then after the last one; stays due", () => {
  assert.deepEqual(agenda([], "2026-10-05T09:00:00Z").deepReview, { due: false, dueDay: null, tomorrow: false, candidates: 0 });
  const evidence = [ans("a1", "2026-10-01T10:00:00Z")];
  assert.deepEqual(agenda(evidence, "2026-10-07T09:00:00Z").deepReview, { due: false, dueDay: "2026-10-08", tomorrow: true, candidates: 1 });
  assert.equal(agenda(evidence, "2026-10-08T09:00:00Z").deepReview.due, true);
  assert.equal(agenda(evidence, "2026-10-20T09:00:00Z").deepReview.due, true, "missed, still due");
  const results = [finished("d", "2026-10-09T10:00:00Z", "deep")];
  assert.deepEqual(agenda(evidence, "2026-10-10T09:00:00Z", { results }).deepReview, { due: false, dueDay: "2026-10-16", tomorrow: false, candidates: 1 });
  const daily: ReviewConfig = { ...DEFAULT_CONFIG, deep: { duration: "30 min", cadence: "Daily" } };
  assert.equal(agenda(evidence, "2026-10-10T09:00:00Z", { results, config: daily }).deepReview.due, true);
});

test("deep review before an exam: due from a week before until one is done", () => {
  const evidence = [ans("a1", "2026-10-01T10:00:00Z")];
  const config: ReviewConfig = { ...DEFAULT_CONFIG, deep: { duration: "30 min", cadence: "1 wk before exam" } };
  assert.deepEqual(agenda(evidence, "2026-10-05T09:00:00Z", { config, examDays: ["2026-10-20"] }).deepReview, { due: false, dueDay: "2026-10-13", tomorrow: false, candidates: 1 });
  assert.equal(agenda(evidence, "2026-10-14T09:00:00Z", { config, examDays: ["2026-10-20"] }).deepReview.due, true);
  assert.equal(agenda(evidence, "2026-10-15T09:00:00Z", { config, examDays: ["2026-10-20"], results: [finished("d", "2026-10-14T10:00:00Z", "deep")] }).deepReview.due, false);
  assert.equal(agenda(evidence, "2026-10-14T09:00:00Z", { config }).deepReview.dueDay, null, "no exam, no deep review");
});

test("a poor session (≥3 answers, under 60%) leaves a study item per missed objective, re-quiz from the next day", () => {
  const evidence = [ans("a1", "2026-10-05T10:00:00Z", "incorrect"), ans("b1", "2026-10-05T10:01:00Z", "incorrect"), ans("c1", "2026-10-05T10:02:00Z")];
  const results = [finished("s1", "2026-10-05T10:03:00Z")];
  const same = agenda(evidence, "2026-10-05T12:00:00Z", { results });
  assert.deepEqual(
    same.study.map((s) => [s.objectiveId, s.missedQuestionIds, s.requiz, s.day]),
    [["a", ["a1"], "tomorrow", "2026-10-05"], ["b", ["b1"], "tomorrow", "2026-10-05"]],
  );
  assert.deepEqual(agenda(evidence, "2026-10-06T08:00:00Z", { results }).study.map((s) => s.requiz), ["today", "today"]);
});

test("an unfinished session, or a good one, leaves nothing; two misses on one objective do", () => {
  const evidence = [ans("a1", "2026-10-05T10:00:00Z", "incorrect"), ans("b1", "2026-10-05T10:01:00Z", "incorrect"), ans("c1", "2026-10-05T10:02:00Z")];
  assert.deepEqual(agenda(evidence, "2026-10-05T12:00:00Z").study, []);
  const good = [ans("a1", "2026-10-05T10:00:00Z", "incorrect"), ans("a2", "2026-10-05T10:01:00Z"), ans("b1", "2026-10-05T10:02:00Z"), ans("c1", "2026-10-05T10:03:00Z")];
  assert.deepEqual(agenda(good, "2026-10-05T12:00:00Z", { results: [finished("s1", "2026-10-05T10:04:00Z")] }).study, []);
  const twice = [...good.slice(1), ans("a3", "2026-10-05T10:05:00Z", "incorrect"), ans("a4", "2026-10-05T10:06:00Z", "incorrect"), ans("b2", "2026-10-05T10:07:00Z")];
  assert.deepEqual(agenda(twice, "2026-10-05T12:00:00Z", { results: [finished("s1", "2026-10-05T10:08:00Z")] }).study.map((s) => s.objectiveId), ["a"]);
});

test("too few answers isn't a poor session; retries in the same session don't dilute the score", () => {
  const two = [ans("a1", "2026-10-05T10:00:00Z", "incorrect"), ans("b1", "2026-10-05T10:01:00Z", "incorrect")];
  assert.deepEqual(agenda(two, "2026-10-05T12:00:00Z", { results: [finished("s1", "2026-10-05T10:02:00Z")] }).study, []);
  const retried = [
    ans("a1", "2026-10-05T10:00:00Z", "incorrect"),
    ans("b1", "2026-10-05T10:01:00Z", "incorrect"),
    ans("c1", "2026-10-05T10:02:00Z"),
    ans("a1", "2026-10-05T10:03:00Z"),
    ans("b1", "2026-10-05T10:04:00Z"),
  ];
  assert.equal(agenda(retried, "2026-10-05T12:00:00Z", { results: [finished("s1", "2026-10-05T10:05:00Z")] }).study.length, 2);
});

test("a study item clears when the objective is answered in a later session on a later day", () => {
  const poor = [ans("a1", "2026-10-05T10:00:00Z", "incorrect"), ans("b1", "2026-10-05T10:01:00Z", "incorrect"), ans("c1", "2026-10-05T10:02:00Z", "incorrect")];
  const results = [finished("s1", "2026-10-05T10:03:00Z")];
  const sameDay = [...poor, ans("a2", "2026-10-05T15:00:00Z", "correct", "s2")];
  assert.ok(agenda(sameDay, "2026-10-05T16:00:00Z", { results }).study.some((s) => s.objectiveId === "a"), "same-day retry doesn't count");
  const nextDay = [...poor, ans("a2", "2026-10-06T09:00:00Z", "incorrect", "s3")];
  assert.deepEqual(agenda(nextDay, "2026-10-06T10:00:00Z", { results }).study.map((s) => s.objectiveId), ["b", "c"]);
});

test("a missing weight is a bug", () => {
  assert.throws(() => withNeutralWeights(["a", "x"], new Map([["a", 1]]), () => false), /No weight computed for objective x/);
  assert.deepEqual([...withNeutralWeights(["a", "t1#unsorted"], new Map([["a", 1.2]]), (id) => id.endsWith("#unsorted"))], [["a", 1.2], ["t1#unsorted", 1]]);
});
