/**
 * The cram's time budget by day (cram mode contract, section 6, per-day addendum of 2026-11-10;
 * owner: "time per day should be a number you can input per day, because it's not the same every
 * day"). `perDay` maps each day from the day cramming started to the day before the exam
 * (YYYY-MM-DD in the student's timezone) to its hours, in half-hour steps, 0 for a day out;
 * `hours` and `daysOut` are derived from it so every earlier reader keeps working. A budget saved
 * before the change has no `perDay`: `perDayOf` spreads its hours evenly over its study days.
 * Pure: no clock reads.
 */
import type { CramBudget } from "../data.ts";
import { addDays } from "./agenda.ts";

/** Hours are entered in steps of this (half an hour). */
export const HOUR_STEP = 0.5;
/** The most a day can hold. */
export const HOURS_PER_DAY_MAX = 24;
/** The most days a budget can name (a year). */
export const BUDGET_DAYS_MAX = 366;

/** A whole number of half hours, from 0 to a day. */
export function isHalfHours(h: unknown): h is number {
  return typeof h === "number" && Number.isFinite(h) && h >= 0 && h <= HOURS_PER_DAY_MAX && Number.isInteger(h / HOUR_STEP);
}

export const isDay = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));

/** The days from `from` to the day before `examDate`, in order (none when `from` is on or after it). */
export function daysUpTo(from: string, examDate: string): string[] {
  const days: string[] = [];
  for (let d = from; d < examDate; d = addDays(d, 1)) days.push(d);
  return days;
}

/**
 * The budget's hours by day. A budget with `perDay` gives it as stored. One saved before per-day
 * budgets (no `perDay`) spreads `hours` evenly over the days from the start of the cram (the date
 * of `since`) to the day before the exam, minus `daysOut` (0 each); nothing when no day is left.
 * The spread isn't rounded to half hours, so the days still sum to `hours`.
 */
export function perDayOf(budget: CramBudget, examDate: string): Record<string, number> {
  if (budget.perDay) return { ...budget.perDay };
  const out = new Set(budget.daysOut);
  const days = daysUpTo(budget.since.slice(0, 10), examDate);
  const study = days.filter((d) => !out.has(d));
  const each = study.length ? budget.hours / study.length : 0;
  return Object.fromEntries(days.map((d) => [d, out.has(d) ? 0 : each]));
}

/** `hours` (the sum) and `daysOut` (the days at 0, sorted) a per-day map derives to. */
export function totalsOf(perDay: Readonly<Record<string, number>>): { hours: number; daysOut: string[] } {
  const days = Object.keys(perDay).sort();
  return { hours: days.reduce((sum, d) => sum + perDay[d], 0), daysOut: days.filter((d) => perDay[d] === 0) };
}

/** A budget built from a per-day map: its totals derived, the days sorted. */
export function budgetFromPerDay(perDay: Readonly<Record<string, number>>, since: string): CramBudget {
  const sorted = Object.fromEntries(Object.keys(perDay).sort().map((d) => [d, perDay[d]]));
  return { ...totalsOf(sorted), since, perDay: sorted };
}

/** The budget with `perDay` filled in (a budget saved before per-day budgets gets its spread), totals rederived. */
export function withPerDay(budget: CramBudget, examDate: string): CramBudget {
  return budgetFromPerDay(perDayOf(budget, examDate), budget.since);
}

/** What a cram without a time budget is assumed to get, per study day (course_state's plan then says `defaulted`). */
export const DEFAULT_HOURS_PER_DAY = 2;

/**
 * The budget assumed for a cramming exam whose scope has none: DEFAULT_HOURS_PER_DAY for every day
 * from today to the day before the exam, no days out, starting now (so nothing counts as spent).
 */
export function defaultBudget(today: string, examDate: string, now: string): CramBudget {
  return budgetFromPerDay(Object.fromEntries(daysUpTo(today, examDate).map((d) => [d, DEFAULT_HOURS_PER_DAY])), now);
}

/**
 * A budget as `set_exam` takes it (`scope.budget`): any of these, merged over the exam's budget
 * (`mergeBudget`). `perDay` entries replace the days they name; `today` is the hours for today
 * only; `hours` without `perDay` is a total spread evenly over the days not out (a budget saved
 * the old way); `daysOut` zeroes those days; `since` is kept when left out.
 */
export interface CramBudgetInput {
  perDay?: Record<string, number>;
  today?: number;
  hours?: number;
  daysOut?: string[];
  since?: string;
}

/**
 * The budget an exam ends with after `set_exam`: the input merged over the exam's budget (none yet:
 * the assumed one, DEFAULT_HOURS_PER_DAY a study day from today, as the plan told Claude). Days on
 * or after the exam are dropped. `since` is the input's, else the exam's, else `now`.
 */
export function mergeBudget(base: CramBudget | null | undefined, input: CramBudgetInput, context: { today: string; examDate: string; now: string }): CramBudget {
  const { today, examDate, now } = context;
  const since = input.since ?? base?.since ?? now;
  const start = base ? withPerDay(base, examDate) : defaultBudget(today, examDate, now);
  let perDay: Record<string, number>;
  if (input.hours !== undefined && !input.perDay) {
    // A total: spread evenly over the days from the start of the cram, minus the days out.
    perDay = perDayOf({ hours: input.hours, daysOut: input.daysOut ?? [], since }, examDate);
  } else {
    perDay = { ...start.perDay, ...(input.perDay ?? {}) };
    for (const d of input.daysOut ?? []) perDay[d] = 0;
  }
  if (input.today !== undefined) perDay[today] = input.today;
  for (const d of Object.keys(perDay)) if (d >= examDate) delete perDay[d];
  return budgetFromPerDay(perDay, since);
}
