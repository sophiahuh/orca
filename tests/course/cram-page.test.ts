import test from "node:test";
import assert from "node:assert/strict";
import type { Objective, QuizResult, Topic } from "../../src/lib/data.ts";
import { hoursFromDuration, planTopics, remainingDays, spentMinutesInOrca } from "../../src/lib/course/cram-page.ts";
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

test("spent minutes count this course's sessions finished since cramming started", () => {
  const results = [result("c", "2026-11-09T10:00:00Z", 600), result("c", "2026-11-10T10:00:00Z", 900), result("d", "2026-11-10T11:00:00Z", 900)];
  assert.equal(spentMinutesInOrca(results, "c", "2026-11-10T00:00:00Z"), 15);
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

test("the page's plan: an exam 5 days out, 6 hours with one day out, nothing verified", () => {
  const plan = cramPlan({
    today: "2026-11-10",
    examDate: "2026-11-15",
    budget: { hours: 6, daysOut: ["2026-11-12"], since: "2026-11-10T09:00:00Z" },
    topics: [{ id: "t", name: "Two's Complement", objectives: [{ id: "a", name: "a", weight: 1, status: "learning" }, { id: "b", name: "b", weight: 1, status: "unseen" }] }],
    spentMinutes: 0,
  });
  assert.equal(plan.daysLeft, 5);
  assert.deepEqual(plan.studyDays, ["2026-11-10", "2026-11-11", "2026-11-13", "2026-11-14"]);
  assert.equal(plan.hoursLeft, 6);
  assert.equal(plan.minutesPerDay, 90);
  assert.equal(plan.behindMinutes, 0);
  assert.deepEqual(plan.today, [{ topicId: "t", minutes: 90 }]);
  assert.deepEqual(plan.topics[0].weakSpots, ["a"]);
  assert.equal(plan.line, "5 days to the exam. Today: Two's Complement. Verified: 0%.");
});
