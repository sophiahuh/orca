import test from "node:test";
import assert from "node:assert/strict";
import { budgetFromPerDay, DEFAULT_HOURS_PER_DAY, daysUpTo, defaultBudget, isHalfHours, mergeBudget, perDayOf, totalsOf, withPerDay } from "../../src/lib/mastery/cram-budget.ts";

const SINCE = "2026-11-10T09:00:00.000Z";
const EXAM = "2026-11-15";

test("a budget saved before per-day budgets spreads its hours evenly over its study days, days out at 0", () => {
  const legacy = { hours: 6, daysOut: ["2026-11-12"], since: SINCE };
  assert.deepEqual(perDayOf(legacy, EXAM), { "2026-11-10": 1.5, "2026-11-11": 1.5, "2026-11-12": 0, "2026-11-13": 1.5, "2026-11-14": 1.5 });
  assert.deepEqual(perDayOf({ hours: 6, daysOut: [], since: "2026-11-15T09:00:00.000Z" }, EXAM), {}, "no day left: nothing");
  assert.deepEqual(perDayOf({ hours: 6, daysOut: ["2026-11-10"], since: "2026-11-14T09:00:00.000Z" }, EXAM), { "2026-11-14": 6 });
  // Normalised: the spread stored as perDay, the totals rederived.
  assert.deepEqual(withPerDay(legacy, EXAM), { hours: 6, daysOut: ["2026-11-12"], since: SINCE, perDay: perDayOf(legacy, EXAM) });
  // One with perDay is read as stored.
  const perDay = { "2026-11-11": 2, "2026-11-10": 0.5 };
  assert.deepEqual(perDayOf({ hours: 2.5, daysOut: [], since: SINCE, perDay }, EXAM), perDay);
});

test("hours and days out derive from the per-day map; a built budget sorts its days", () => {
  assert.deepEqual(totalsOf({ "2026-11-12": 0, "2026-11-10": 1, "2026-11-11": 2.5 }), { hours: 3.5, daysOut: ["2026-11-12"] });
  assert.deepEqual(budgetFromPerDay({ "2026-11-11": 2, "2026-11-10": 0 }, SINCE), { hours: 2, daysOut: ["2026-11-10"], since: SINCE, perDay: { "2026-11-10": 0, "2026-11-11": 2 } });
  assert.deepEqual(daysUpTo("2026-11-13", EXAM), ["2026-11-13", "2026-11-14"]);
  assert.deepEqual(daysUpTo(EXAM, EXAM), []);
});

test("hours come in half-hour steps from 0 to a day", () => {
  for (const ok of [0, 0.5, 1, 2.5, 24]) assert.equal(isHalfHours(ok), true, String(ok));
  for (const bad of [-0.5, 0.25, 1.1, 24.5, Number.NaN, "1", null]) assert.equal(isHalfHours(bad), false, String(bad));
});

test("the assumed budget is 2 hours for every day from today to the day before the exam", () => {
  const assumed = defaultBudget("2026-11-12", EXAM, "2026-11-12T15:00:00.000Z");
  assert.deepEqual(assumed, { hours: DEFAULT_HOURS_PER_DAY * 3, daysOut: [], since: "2026-11-12T15:00:00.000Z", perDay: { "2026-11-12": 2, "2026-11-13": 2, "2026-11-14": 2 } });
  assert.deepEqual(defaultBudget(EXAM, EXAM, "2026-11-15T08:00:00.000Z").hours, 0, "on the day there are no study days");
});

test("set_exam's budget merges over the exam's: perDay by day, today for today, hours re-spread, days out zeroed, since kept", () => {
  const ctx = { today: "2026-11-12", examDate: EXAM, now: "2026-11-12T15:00:00.000Z" };
  const base = budgetFromPerDay({ "2026-11-10": 1, "2026-11-11": 1, "2026-11-12": 2, "2026-11-13": 2, "2026-11-14": 2 }, SINCE);
  // "I have until 7": today only.
  assert.deepEqual(mergeBudget(base, { today: 1 }, ctx), { hours: 7, daysOut: [], since: SINCE, perDay: { ...base.perDay, "2026-11-12": 1 } });
  // A named day, and a day out; a day on or after the exam is dropped.
  assert.deepEqual(mergeBudget(base, { perDay: { "2026-11-13": 3.5, "2026-11-15": 2 }, daysOut: ["2026-11-14"] }, ctx).perDay, { "2026-11-10": 1, "2026-11-11": 1, "2026-11-12": 2, "2026-11-13": 3.5, "2026-11-14": 0 });
  // The old form, a total: spread over the days from the start of the cram, replacing the map.
  assert.deepEqual(mergeBudget(base, { hours: 5, daysOut: ["2026-11-11"] }, ctx), { hours: 5, daysOut: ["2026-11-11"], since: SINCE, perDay: { "2026-11-10": 1.25, "2026-11-11": 0, "2026-11-12": 1.25, "2026-11-13": 1.25, "2026-11-14": 1.25 } });
  // since: the input's, else the exam's, else now.
  assert.equal(mergeBudget(base, { today: 1, since: "2026-11-11T08:00:00.000Z" }, ctx).since, "2026-11-11T08:00:00.000Z");
  assert.equal(mergeBudget(null, { today: 1 }, ctx).since, ctx.now);
  // No budget yet: the assumed one (2 hours a day from today) is the base, as the plan told Claude.
  assert.deepEqual(mergeBudget(null, { today: 1 }, ctx), { hours: 5, daysOut: [], since: ctx.now, perDay: { "2026-11-12": 1, "2026-11-13": 2, "2026-11-14": 2 } });
  assert.deepEqual(mergeBudget(undefined, { hours: 6, daysOut: [], since: SINCE }, ctx).perDay, { "2026-11-10": 1.2, "2026-11-11": 1.2, "2026-11-12": 1.2, "2026-11-13": 1.2, "2026-11-14": 1.2 });
  // A budget saved the old way is spread before the merge.
  assert.deepEqual(mergeBudget({ hours: 4, daysOut: [], since: "2026-11-11T09:00:00.000Z" }, { today: 0 }, ctx).perDay, { "2026-11-11": 1, "2026-11-12": 0, "2026-11-13": 1, "2026-11-14": 1 });
});
