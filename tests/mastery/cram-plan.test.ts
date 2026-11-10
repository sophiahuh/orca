import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_HOURS_PER_DAY, cramPlan, defaultBudget, type CramPlanInput } from "../../src/lib/mastery/cram-plan.ts";
import type { ObjectiveStatus } from "../../src/lib/mastery/types.ts";

const obj = (id: string, status: ObjectiveStatus, weight = 1) => ({ id, name: `Objective ${id}`, weight, status });

/** Two topics in scope: A (two objectives, one weak), B (one objective, unseen); C is done; D is out of scope. */
const topics: CramPlanInput["topics"] = [
  { id: "A", name: "Adders", objectives: [obj("a1", "learning"), obj("a2", "verified")] },
  { id: "B", name: "Buses", objectives: [obj("b1", "unseen")] },
  { id: "C", name: "Counters", objectives: [obj("c1", "mastered"), obj("c2", "verified")] },
  { id: "D", name: "Decoders", objectives: [obj("d1", "unseen", 0)] },
];
const budget = { hours: 6, daysOut: [] as string[], since: "2026-11-10T09:00:00.000Z" };
const base: CramPlanInput = { today: "2026-11-10", examDate: "2026-11-19", budget, topics, spentMinutes: 0 };

test("days left exclude the exam day, and study days leave out the days out", () => {
  const plan = cramPlan(base);
  assert.equal(plan.daysLeft, 9);
  assert.equal(plan.studyDays.length, 9);
  assert.deepEqual([plan.studyDays[0], plan.studyDays[8]], ["2026-11-10", "2026-11-18"]);
  const withOut = cramPlan({ ...base, budget: { ...budget, daysOut: ["2026-11-14", "2026-11-15", "2026-12-01"] } });
  assert.equal(withOut.daysLeft, 9, "days out don't change the days left");
  assert.equal(withOut.studyDays.length, 7);
  assert.ok(!withOut.studyDays.includes("2026-11-14") && !withOut.studyDays.includes("2026-11-15"));
  assert.equal(cramPlan({ ...base, today: "2026-11-18" }).daysLeft, 1);
  assert.equal(cramPlan({ ...base, today: "2026-11-19" }).daysLeft, 0);
  assert.equal(cramPlan({ ...base, today: "2026-11-25" }).daysLeft, 0, "never negative");
});

test("hours left take the minutes spent off the budget, spread over the study days", () => {
  const plan = cramPlan({ ...base, spentMinutes: 90 });
  assert.equal(plan.hoursLeft, 4.5);
  assert.equal(plan.minutesPerDay, 30);
  assert.equal(cramPlan({ ...base, spentMinutes: 600 }).hoursLeft, 0, "never negative");
  const examDay = cramPlan({ ...base, today: "2026-11-19" });
  assert.deepEqual([examDay.studyDays, examDay.minutesPerDay], [[], 0]);
});

test("behind minutes compare what was spent with the budget's pro-rata expectation", () => {
  assert.equal(cramPlan(base).behindMinutes, 0, "nothing expected on the first day");
  // Day 4 of 9 study days: 3 elapsed, 120 minutes expected.
  const later = { ...base, today: "2026-11-13" };
  assert.equal(cramPlan({ ...later, spentMinutes: 100 }).behindMinutes, 20);
  assert.equal(cramPlan({ ...later, spentMinutes: 200 }).behindMinutes, 0, "ahead is not behind");
  // A day out before today isn't an elapsed study day: 2 of 8, 90 minutes expected.
  assert.equal(cramPlan({ ...later, budget: { ...budget, daysOut: ["2026-11-11"] }, spentMinutes: 60 }).behindMinutes, 30);
});

test("today's minutes split by weight × unverified share, rounded to 5, dropping small topics; done topics get 0", () => {
  // 360 minutes over 9 days = 40 a day. Shares: A 2 × 0.5 = 1, B 1 × 1 = 1, C done, D out of scope.
  const plan = cramPlan(base);
  const byId = Object.fromEntries(plan.topics.map((t) => [t.id, t]));
  assert.deepEqual([byId.A.minutesToday, byId.B.minutesToday, byId.C.minutesToday, byId.D.minutesToday], [20, 20, 0, 0]);
  assert.deepEqual([byId.A.weight, byId.A.unverifiedShare, byId.A.done], [2, 0.5, false]);
  assert.deepEqual([byId.C.weight, byId.C.unverifiedShare, byId.C.done], [2, 0, true]);
  assert.deepEqual([byId.D.weight, byId.D.done], [0, false]);
  assert.deepEqual(plan.verified, { done: 3, total: 5, share: 0.6 });
  assert.deepEqual(plan.today, [{ topicId: "A", minutes: 20 }, { topicId: "B", minutes: 20 }]);
  // A heavier topic takes more, and a sliver under 5 minutes is dropped.
  const heavy = cramPlan({ ...base, topics: [{ id: "A", name: "Adders", objectives: [obj("a1", "learning", 9)] }, { id: "B", name: "Buses", objectives: [obj("b1", "unseen", 0.4)] }] });
  assert.deepEqual(heavy.today, [{ topicId: "A", minutes: 40 }]);
  assert.equal(heavy.topics.find((t) => t.id === "B")!.minutesToday, 0);
  // A day out today: nothing is allocated.
  const off = cramPlan({ ...base, budget: { ...budget, daysOut: ["2026-11-10"] } });
  assert.deepEqual(off.today, []);
});

test("weak spots are the in-scope objectives in rotation or waiting on a check", () => {
  const plan = cramPlan({
    ...base,
    topics: [{ id: "A", name: "Adders", objectives: [obj("l", "learning"), obj("m", "mixed-up"), obj("f", "fading"), obj("c", "check-due"), obj("v", "verified"), obj("u", "unseen"), obj("out", "learning", 0)] }],
  });
  assert.deepEqual(plan.topics[0].weakSpots, ["l", "m", "f", "c"]);
});

test("the line: its normal form names what's done and today's topics, the behind form names the shortened topic, and exam day says so", () => {
  assert.equal(cramPlan(base).line, "9 days to the exam. Done: Counters. Today: Adders, Buses. Verified: 60%.");
  assert.equal(cramPlan({ ...base, today: "2026-11-13", spentMinutes: 100 }).line, "6 days to the exam. Done: Counters. Today: Adders, Buses. Verified: 60%. 20 minutes behind: Buses gets shortened.");
  assert.equal(cramPlan({ ...base, today: "2026-11-19" }).line, "Exam day. Light review only, nothing new.");
  assert.equal(cramPlan({ ...base, today: "2026-11-18" }).line.slice(0, 18), "1 day to the exam.");
  const nothingDone = cramPlan({ ...base, topics: topics.filter((t) => t.id !== "C") });
  assert.equal(nothingDone.line, "9 days to the exam. Today: Adders, Buses. Verified: 33%.");
});

test("the plan is deterministic", () => {
  assert.deepEqual(cramPlan(base), cramPlan(base));
});

test("a plan says when its budget was assumed: 2 hours for every study day from today, nothing spent", () => {
  assert.equal(cramPlan(base).defaulted, false);
  const assumed = defaultBudget("2026-11-10", "2026-11-19", "2026-11-10T15:00:00.000Z");
  assert.deepEqual(assumed, { hours: DEFAULT_HOURS_PER_DAY * 9, daysOut: [], since: "2026-11-10T15:00:00.000Z" });
  const plan = cramPlan({ ...base, budget: assumed, defaulted: true });
  assert.equal(plan.defaulted, true);
  assert.equal(plan.hoursLeft, 18);
  assert.equal(plan.minutesPerDay, 120);
  assert.equal(plan.behindMinutes, 0);
  assert.deepEqual(defaultBudget("2026-11-19", "2026-11-19", "2026-11-19T08:00:00.000Z").hours, 0, "on the day there are no study days");
});
