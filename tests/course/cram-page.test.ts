import test from "node:test";
import assert from "node:assert/strict";
import type { Objective, QuizResult, Topic } from "../../src/lib/data.ts";
import { hoursFromDuration, perDayHours, planTopics, remainingDays, spentMinutesInOrca, weekdayName } from "../../src/lib/course/cram-page.ts";
import { cramPlan } from "../../src/lib/mastery/cram-plan.ts";

const topic = (id: string, extra: Partial<Topic> = {}): Topic => ({ id, name: id, review: "confirmed", pos: { x: 0, y: 0 }, source: [], ...extra });
const objective = (id: string, topicId: string, extra: Partial<Objective> = {}): Objective => ({ id, topicId, name: id, description: "", origin: "material", review: "confirmed", materialId: "m", runId: "r", signals: [], ...extra });
const result = (courseId: string, finishedAt: string, seconds: number): QuizResult => ({ courseId, topicId: null, mode: "quick", sessionId: "s", correct: 1, total: 1, seconds, finishedAt });

test("the setup's hours come from the exam review duration; the days a student can mark out run to the day before the exam", () => {
  assert.equal(hoursFromDuration("10 hours"), 10);
  assert.equal(hoursFromDuration("30 min"), 0.5);
  assert.deepEqual(remainingDays("2026-11-10", "2026-11-13"), ["2026-11-10", "2026-11-11", "2026-11-12"]);
  assert.deepEqual(remainingDays("2026-11-10", "2026-11-10"), [], "none on the day");
});

test("the setup's hours a day are the total over the study days, to the nearest half hour and at least half an hour", () => {
  assert.equal(perDayHours(10, 5), 2);
  assert.equal(perDayHours(10, 4), 2.5);
  assert.equal(perDayHours(10, 3), 3.5, "3.33 rounds to the nearest half hour");
  assert.equal(perDayHours(1, 6), 0.5, "never below half an hour");
  assert.equal(perDayHours(10, 0), 10, "no study days: the total as it is");
  assert.equal(weekdayName("2026-11-13"), "Friday");
});

test("spent minutes count this course's sessions finished since cramming started, split at the start of today", () => {
  const results = [result("c", "2026-11-09T10:00:00Z", 600), result("c", "2026-11-10T10:00:00Z", 900), result("c", "2026-11-11T03:00:00Z", 300), result("d", "2026-11-11T11:00:00Z", 900)];
  const utcDay = (iso: string) => iso.slice(0, 10);
  assert.deepEqual(spentMinutesInOrca(results, "c", "2026-11-10T00:00:00Z", "2026-11-11", utcDay), { beforeToday: 15, today: 5 });
  assert.deepEqual(spentMinutesInOrca(results, "c", "2026-11-10T00:00:00Z", "2026-11-10", utcDay), { beforeToday: 0, today: 15 }, "a session after today (the clock moved) counts nowhere");
  // The day is the student's: at 22:00 in New York the 11th's UTC session is still the 10th.
  assert.deepEqual(spentMinutesInOrca(results, "c", "2026-11-10T00:00:00Z", "2026-11-10", (iso) => new Date(Date.parse(iso) - 5 * 3_600_000).toISOString().slice(0, 10)), { beforeToday: 0, today: 20 });
});

test("the plan's topics carry the covered objectives at course × scope weight, by surviving topic, with their status", () => {
  const topics = [topic("t1"), topic("t2"), topic("old", { mergedInto: "t2" }), topic("empty")];
  const objectives = { a: objective("a", "t1"), b: objective("b", "t2"), c: objective("c", "old"), x: objective("x", "t1", { review: "archived" }) };
  // A scope with objectives: only the listed ones weighing more than 0 are in scope (as the card counts them).
  const scope = { objectives: [{ objectiveId: "a", weight: 2, evidence: [] }, { objectiveId: "c", weight: 0, evidence: [] }, { objectiveId: "b", weight: 1, evidence: [] }], sources: [] };
  const plan = planTopics({ topicIds: [], scope }, topics, objectives, [], (id) => (id === "a" ? "verified" : "unseen"));
  // Course weight 0.75 (no coverage signals, WEIGHT_RULES.coverageFloor) × the scope weight.
  assert.deepEqual(plan, [
    { id: "t1", name: "t1", objectives: [{ id: "a", name: "a", weight: 1.5, status: "verified" }] },
    { id: "t2", name: "t2", objectives: [{ id: "b", name: "b", weight: 0.75, status: "unseen" }] },
  ]);
  // Without a scope: every live objective of the exam's topics (merges followed), at its course weight.
  const all = planTopics({ topicIds: ["t2"], scope: null }, topics, objectives, [], () => "unseen");
  assert.deepEqual(all.map((t) => [t.id, t.objectives.map((o) => [o.id, o.weight])]), [["t2", [["b", 0.75], ["c", 0.75]]]]);
});

test("the page's plan: an exam 5 days out, 6 hours by day with one day out, nothing verified", () => {
  const plan = cramPlan({
    today: "2026-11-10",
    examDate: "2026-11-15",
    budget: { hours: 6, daysOut: ["2026-11-12"], since: "2026-11-10T09:00:00Z", perDay: { "2026-11-10": 1.5, "2026-11-11": 2, "2026-11-12": 0, "2026-11-13": 1.5, "2026-11-14": 1 } },
    topics: [{ id: "t", name: "Two's Complement", objectives: [{ id: "a", name: "a", weight: 1, status: "learning" }, { id: "b", name: "b", weight: 1, status: "unseen" }] }],
    spentMinutes: { beforeToday: 0, today: 0 },
  });
  assert.equal(plan.daysLeft, 5);
  assert.deepEqual(plan.studyDays, ["2026-11-10", "2026-11-11", "2026-11-13", "2026-11-14"]);
  assert.equal(plan.hoursLeft, 6);
  assert.equal(plan.minutesToday, 90);
  assert.equal(plan.behindMinutes, 0);
  assert.deepEqual(plan.today, [{ topicId: "t", minutes: 90 }]);
  assert.deepEqual(plan.topics[0].weakSpots, ["a"]);
  assert.equal(plan.line, "5 days to the exam. Today: Two's Complement. Verified: 0%.");
});
