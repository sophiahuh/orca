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
const SINCE = "2026-11-10T09:00:00.000Z";
/** Nine days to the exam, 1 hour each but the 14th (half) and the 15th (out): 7.5 hours. */
const perDay = { "2026-11-10": 1, "2026-11-11": 1, "2026-11-12": 1, "2026-11-13": 1, "2026-11-14": 0.5, "2026-11-15": 0, "2026-11-16": 1, "2026-11-17": 1, "2026-11-18": 1 };
const budget = { hours: 7.5, daysOut: ["2026-11-15"], since: SINCE, perDay };
const none = { beforeToday: 0, today: 0 };
const base: CramPlanInput = { today: "2026-11-10", examDate: "2026-11-19", budget, topics, spentMinutes: none };

test("days left exclude the exam day; study days are the days ahead with hours, and the plan carries the hours by day", () => {
  const plan = cramPlan(base);
  assert.equal(plan.daysLeft, 9);
  assert.equal(plan.studyDays.length, 8, "the day out isn't a study day");
  assert.ok(!plan.studyDays.includes("2026-11-15"));
  assert.deepEqual([plan.studyDays[0], plan.studyDays[7]], ["2026-11-10", "2026-11-18"]);
  assert.deepEqual(plan.perDay, perDay);
  const later = cramPlan({ ...base, today: "2026-11-16" });
  assert.deepEqual(later.studyDays, ["2026-11-16", "2026-11-17", "2026-11-18"], "past days aren't study days left");
  assert.equal(cramPlan({ ...base, today: "2026-11-18" }).daysLeft, 1);
  assert.equal(cramPlan({ ...base, today: "2026-11-19" }).daysLeft, 0);
  assert.equal(cramPlan({ ...base, today: "2026-11-25" }).daysLeft, 0, "never negative");
  // A budget saved before per-day budgets: its hours spread evenly, days out at 0.
  const legacy = cramPlan({ ...base, budget: { hours: 6, daysOut: ["2026-11-14", "2026-11-15", "2026-12-01"], since: SINCE } });
  assert.equal(legacy.studyDays.length, 7);
  assert.equal(legacy.perDay["2026-11-10"], 6 / 7);
  assert.equal(legacy.perDay["2026-11-14"], 0);
});

test("today's minutes are today's hours less what's spent today; hours left count today and later", () => {
  assert.deepEqual([cramPlan(base).minutesToday, cramPlan(base).minutesPerDay, cramPlan(base).hoursLeft], [60, 60, 7.5]);
  const spent = cramPlan({ ...base, spentMinutes: { beforeToday: 0, today: 20 } });
  assert.deepEqual([spent.minutesToday, spent.minutesPerDay, spent.hoursLeft], [40, 40, 7.5 - 20 / 60]);
  assert.equal(cramPlan({ ...base, spentMinutes: { beforeToday: 0, today: 90 } }).minutesToday, 0, "never negative");
  assert.equal(cramPlan({ ...base, spentMinutes: { beforeToday: 0, today: 600 } }).hoursLeft, 0, "never negative");
  // Later in the cram: only the days ahead count, and a day out has no minutes.
  const half = cramPlan({ ...base, today: "2026-11-14", spentMinutes: { beforeToday: 240, today: 0 } });
  assert.deepEqual([half.minutesToday, half.hoursLeft], [30, 3.5]);
  const out = cramPlan({ ...base, today: "2026-11-15" });
  assert.deepEqual([out.minutesToday, out.hoursLeft, out.today], [0, 3, []]);
  const examDay = cramPlan({ ...base, today: "2026-11-19" });
  assert.deepEqual([examDay.studyDays, examDay.minutesToday, examDay.hoursLeft], [[], 0, 0]);
  // A day the budget doesn't name (the exam moved later) has no hours.
  assert.equal(cramPlan({ ...base, examDate: "2026-11-21", today: "2026-11-19" }).minutesToday, 0);
});

test("behind minutes compare what was spent before today with the hours the budget asked for on those days", () => {
  assert.equal(cramPlan(base).behindMinutes, 0, "nothing expected on the first day");
  // Day 4: three hours asked for on the 10th to the 12th.
  const later = { ...base, today: "2026-11-13" };
  assert.equal(cramPlan({ ...later, spentMinutes: { beforeToday: 160, today: 0 } }).behindMinutes, 20);
  assert.equal(cramPlan({ ...later, spentMinutes: { beforeToday: 160, today: 60 } }).behindMinutes, 20, "today's study doesn't catch up yesterday");
  assert.equal(cramPlan({ ...later, spentMinutes: { beforeToday: 200, today: 0 } }).behindMinutes, 0, "ahead is not behind");
  // A day out before today asked for nothing: 4.5 hours by the 16th.
  assert.equal(cramPlan({ ...base, today: "2026-11-16", spentMinutes: { beforeToday: 180, today: 0 } }).behindMinutes, 90);
});

test("today's minutes split by weight × unverified share, rounded to 5, dropping small topics; done topics get 0", () => {
  // 60 minutes today. Shares: A 2 × 0.5 = 1, B 1 × 1 = 1, C done, D out of scope.
  const plan = cramPlan(base);
  const byId = Object.fromEntries(plan.topics.map((t) => [t.id, t]));
  assert.deepEqual([byId.A.minutesToday, byId.B.minutesToday, byId.C.minutesToday, byId.D.minutesToday], [30, 30, 0, 0]);
  assert.deepEqual([byId.A.weight, byId.A.unverifiedShare, byId.A.done], [2, 0.5, false]);
  assert.deepEqual([byId.C.weight, byId.C.unverifiedShare, byId.C.done], [2, 0, true]);
  assert.deepEqual([byId.D.weight, byId.D.done], [0, false]);
  assert.deepEqual(plan.verified, { done: 3, total: 5, share: 0.6 });
  assert.deepEqual(plan.today, [{ topicId: "A", minutes: 30 }, { topicId: "B", minutes: 30 }]);
  // A heavier topic takes more, and a sliver under 5 minutes is dropped.
  const heavy = cramPlan({ ...base, topics: [{ id: "A", name: "Adders", objectives: [obj("a1", "learning", 9)] }, { id: "B", name: "Buses", objectives: [obj("b1", "unseen", 0.3)] }] });
  assert.deepEqual(heavy.today, [{ topicId: "A", minutes: 60 }]);
  assert.equal(heavy.topics.find((t) => t.id === "B")!.minutesToday, 0);
  // A day out today: nothing is allocated.
  const off = cramPlan({ ...base, budget: { ...budget, perDay: { ...perDay, "2026-11-10": 0 } } });
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
  assert.equal(cramPlan({ ...base, today: "2026-11-13", spentMinutes: { beforeToday: 160, today: 0 } }).line, "6 days to the exam. Done: Counters. Today: Adders, Buses. Verified: 60%. 20 minutes behind: Buses gets shortened.");
  assert.equal(cramPlan({ ...base, today: "2026-11-15", spentMinutes: { beforeToday: 100, today: 0 } }).line, "4 days to the exam. Done: Counters. Verified: 60%. 170 minutes behind.");
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
  assert.equal(assumed.hours, DEFAULT_HOURS_PER_DAY * 9);
  assert.deepEqual(assumed.daysOut, []);
  assert.equal(Object.keys(assumed.perDay!).length, 9);
  const plan = cramPlan({ ...base, budget: assumed, defaulted: true });
  assert.equal(plan.defaulted, true);
  assert.equal(plan.hoursLeft, 18);
  assert.equal(plan.minutesToday, 120);
  assert.equal(plan.behindMinutes, 0);
});
