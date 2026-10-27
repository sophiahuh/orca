import test from "node:test";
import assert from "node:assert/strict";
import { addDays, agendaWeights, courseAgenda } from "../../src/lib/mastery/agenda.ts";
import { courseMastery } from "../../src/lib/mastery/course-mastery.ts";
import type { AnswerEvent, EvidenceEvent } from "../../src/lib/mastery/types.ts";
import { reviewWeekdays } from "../../src/lib/mastery/review-days.ts";
import { DEFAULT_CONFIG, NO_SCHEDULE, type CourseSchedule, type QuizResult, type ReviewConfig } from "../../src/lib/data.ts";

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

function agenda(evidence: EvidenceEvent[], now: string, opts: { results?: QuizResult[]; config?: ReviewConfig; examDays?: string[]; weights?: Record<string, number>; schedule?: CourseSchedule } = {}) {
  const mastery = courseMastery({ courseId: "k", topicIds: ["t1", "t2"], bank, catalogue, evidence, now: new Date(now), dayKey: utcDay });
  const weights = agendaWeights(mastery.objectives.keys(), new Map(Object.entries({ a: 1, b: 1, c: 1, ...opts.weights })));
  return courseAgenda({ courseId: "k", mastery, weights, config: opts.config ?? DEFAULT_CONFIG, schedule: opts.schedule ?? NO_SCHEDULE, results: opts.results ?? [], examDays: opts.examDays ?? [], now: new Date(now), dayKey: utcDay });
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

test("missed (or practiced) today waits for the next quick review, never the same day", () => {
  const evidence = [ans("a1", "2026-10-05T10:00:00Z", "incorrect"), ans("b1", "2026-10-05T10:01:00Z", "incorrect"), ans("c1", "2026-10-05T10:02:00Z")];
  const today = agenda(evidence, "2026-10-05T12:00:00Z");
  assert.deepEqual(today.dueToday.map((r) => r.objectiveId), []);
  assert.deepEqual(today.heldForNext.map((r) => r.objectiveId).sort(), ["a", "b", "c"]);
  assert.equal(today.quickReviewDue, false);
  assert.equal(today.nextQuickDay, "2026-10-06");
  const tomorrow = agenda(evidence, "2026-10-06T08:00:00Z");
  assert.deepEqual(tomorrow.dueToday.map((r) => r.objectiveId).sort(), ["a", "b", "c"]);
  assert.equal(tomorrow.quickReviewDue, true);
});

test("the next quick review follows the cadence: weekly after the last one, exam windows only before an exam", () => {
  const weekly: ReviewConfig = { ...DEFAULT_CONFIG, quick: { ...DEFAULT_CONFIG.quick, cadence: "Weekly" } };
  assert.equal(agenda([], "2026-10-05T12:00:00Z", { config: weekly, results: [finished("q", "2026-10-03T10:00:00Z")] }).nextQuickDay, "2026-10-10");
  assert.equal(agenda([], "2026-10-05T12:00:00Z", { config: weekly }).nextQuickDay, "2026-10-06");
  const exam: ReviewConfig = { ...DEFAULT_CONFIG, quick: { ...DEFAULT_CONFIG.quick, cadence: "1 wk before exam" } };
  assert.equal(agenda([], "2026-10-05T12:00:00Z", { config: exam, examDays: ["2026-10-20"] }).nextQuickDay, "2026-10-13");
  assert.equal(agenda([], "2026-10-05T12:00:00Z", { config: exam }).nextQuickDay, null);
});

test("a missing weight is a bug", () => {
  assert.throws(() => agendaWeights(["a", "x"], new Map([["a", 1]])), /No weight computed for objective x/);
});

/* Class meetings: 2026-10-05 is a Monday; this class meets Tuesday and Thursday. */
const tueThu: CourseSchedule = { meetings: [{ day: 4, start: "10:10", end: "11:25" }, { day: 2, start: "10:10", end: "11:25" }], quickDays: null, deepDays: null };
const quickOn = (cadence: ReviewConfig["quick"]["cadence"]): ReviewConfig => ({ ...DEFAULT_CONFIG, quick: { ...DEFAULT_CONFIG.quick, cadence } });

test("review days default to the day before the week's first classes; a pick wins; too few meetings rolls", () => {
  assert.deepEqual(reviewWeekdays("Weekly", null, tueThu.meetings), [1]);
  assert.deepEqual(reviewWeekdays("Twice a week", null, tueThu.meetings), [1, 3]);
  assert.deepEqual(reviewWeekdays("Twice a week", [0, 5], tueThu.meetings), [5, 0], "the student's pick, Monday first");
  assert.equal(reviewWeekdays("Twice a week", null, [{ day: 1, start: "09:00", end: "10:00" }]), null, "a once-a-week class has no second day before class");
  assert.equal(reviewWeekdays("Weekly", null, []), null);
  assert.equal(reviewWeekdays("Daily", [1], tueThu.meetings), null, "daily isn't on weekdays");
});

test("weekly quick review on class days: due the day before class until done, then the next week", () => {
  const config = quickOn("Weekly");
  const monday = agenda([], "2026-10-05T18:00:00Z", { config, schedule: tueThu });
  assert.equal(monday.quickReviewDue, true);
  assert.equal(monday.nextQuickDay, "2026-10-12");
  const done = [finished("q", "2026-10-05T08:00:00Z")];
  assert.equal(agenda([], "2026-10-05T18:00:00Z", { config, schedule: tueThu, results: done }).quickReviewDue, false);
  assert.equal(agenda([], "2026-10-08T18:00:00Z", { config, schedule: tueThu, results: done }).quickReviewDue, false);
  assert.equal(agenda([], "2026-10-12T18:00:00Z", { config, schedule: tueThu, results: done }).quickReviewDue, true);
  assert.equal(agenda([], "2026-10-07T18:00:00Z", { config, schedule: tueThu, results: [finished("q", "2026-10-02T08:00:00Z")] }).quickReviewDue, true, "missed Monday, still due");
});

test("twice a week falls before each of the two classes; the student's own days override", () => {
  const config = quickOn("Twice a week");
  const done = [finished("q", "2026-10-05T08:00:00Z")];
  assert.equal(agenda([], "2026-10-05T18:00:00Z", { config, schedule: tueThu, results: done }).nextQuickDay, "2026-10-07");
  assert.equal(agenda([], "2026-10-07T18:00:00Z", { config, schedule: tueThu, results: done }).quickReviewDue, true);
  const fridays: CourseSchedule = { ...tueThu, quickDays: [5] };
  const weekly = quickOn("Weekly");
  assert.equal(agenda([], "2026-10-08T18:00:00Z", { config: weekly, schedule: fridays, results: [finished("q", "2026-10-02T08:00:00Z")] }).quickReviewDue, false);
  assert.equal(agenda([], "2026-10-08T18:00:00Z", { config: weekly, schedule: fridays }).nextQuickDay, "2026-10-09");
});

test("twice a week without class days rolls every 3 days", () => {
  const config = quickOn("Twice a week");
  const done = [finished("q", "2026-10-03T08:00:00Z")];
  assert.equal(agenda([], "2026-10-05T18:00:00Z", { config, results: done }).quickReviewDue, false);
  assert.equal(agenda([], "2026-10-05T18:00:00Z", { config, results: done }).nextQuickDay, "2026-10-06");
  assert.equal(agenda([], "2026-10-06T18:00:00Z", { config, results: done }).quickReviewDue, true);
});

test("a weekly dive on class days: first due the day before class after the first answer, then weekly; stays due", () => {
  const evidence = [ans("a1", "2026-10-01T10:00:00Z")];
  assert.deepEqual(agenda(evidence, "2026-10-04T09:00:00Z", { schedule: tueThu }).deepReview, { due: false, dueDay: "2026-10-05", tomorrow: true, candidates: 1 });
  assert.deepEqual(agenda(evidence, "2026-10-06T09:00:00Z", { schedule: tueThu }).deepReview, { due: true, dueDay: "2026-10-05", tomorrow: false, candidates: 1 });
  assert.equal(agenda(evidence, "2026-10-07T09:00:00Z", { schedule: tueThu, results: [finished("d", "2026-10-06T10:00:00Z", "deep")] }).deepReview.dueDay, "2026-10-12");
  assert.equal(agenda(evidence, "2026-10-07T09:00:00Z", { schedule: { ...tueThu, deepDays: [3] } }).deepReview.dueDay, "2026-10-07", "the student's day");
});
