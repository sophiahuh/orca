/**
 * The cram plan (cram mode contract, section 6): derived from the exam date, the student's time
 * budget and the scope's objectives as they stand, never stored. Pure and deterministic: no clock
 * reads, `today` comes from the caller (in the student's timezone). The cram page reads it in the
 * browser and `course_state` reads the same calculation, so Claude's progress line and the page agree.
 */
import type { CramBudget } from "../data.ts";
import { addDays } from "./agenda.ts";
import type { ObjectiveStatus } from "./types.ts";

export interface CramPlanInput {
  /** YYYY-MM-DD, student's timezone */
  today: string;
  /** YYYY-MM-DD */
  examDate: string;
  budget: CramBudget;
  /** The exam's topics with their objectives: `weight` is the agenda's effective weight (course × scope); 0 = out of scope. */
  topics: Array<{ id: string; name: string; objectives: Array<{ id: string; name: string; weight: number; status: ObjectiveStatus }> }>;
  /** Minutes studied since budget.since: session_results seconds (any mode) + connector estimate (span of a day's connector events, capped at 120 min/day). */
  spentMinutes: number;
  /** The budget was assumed (`defaultBudget`), not set by the student. */
  defaulted?: boolean;
}

export interface CramPlanTopic {
  id: string;
  name: string;
  /** The sum of its in-scope objectives' weights. */
  weight: number;
  /** In-scope objectives not yet verified or mastered, as a share of its in-scope objectives. */
  unverifiedShare: number;
  /** Every in-scope objective is verified or mastered: it gets no minutes. */
  done: boolean;
  minutesToday: number;
  /** Objective ids in rotation or check-due: listed first on the page and in Claude's order. */
  weakSpots: string[];
}

export interface CramPlan {
  /** Calendar days from today to the exam, exam day excluded; 0 on the day. */
  daysLeft: number;
  /** Days from today to the day before the exam, minus daysOut. */
  studyDays: string[];
  /** max(0, budget.hours - spentMinutes / 60) */
  hoursLeft: number;
  /** hoursLeft * 60 / studyDays.length (0 when none) */
  minutesPerDay: number;
  /** max(0, expected spent by today - spentMinutes); expected = budget.hours*60 * (elapsed study days / all study days). Whole minutes. */
  behindMinutes: number;
  /** Objectives verified or mastered over objectives in scope (weight > 0). */
  verified: { done: number; total: number; share: number };
  topics: CramPlanTopic[];
  /** Topics with minutesToday > 0, largest first. */
  today: Array<{ topicId: string; minutes: number }>;
  /** "9 days to the exam. Done: A, B. Today: C, D. Verified: 60%." (day of: "Exam day. Light review only, nothing new."; behind: " 20 minutes behind: D gets shortened." appended) */
  line: string;
  /** The budget was assumed: DEFAULT_HOURS_PER_DAY a study day from today, nothing spent. Claude says so and asks. */
  defaulted: boolean;
}

/** What a cram without a time budget is assumed to get, per study day (course_state's plan then says `defaulted`). */
export const DEFAULT_HOURS_PER_DAY = 2;

/**
 * The budget assumed for a cramming exam whose scope has none: DEFAULT_HOURS_PER_DAY for every day
 * from today to the day before the exam, no days out, starting now (so nothing counts as spent).
 */
export function defaultBudget(today: string, examDate: string, now: string): CramBudget {
  return { hours: DEFAULT_HOURS_PER_DAY * studyDaysFrom(today, examDate, new Set()).length, daysOut: [], since: now };
}

const DAY_MS = 86_400_000;
const VERIFIED: ReadonlySet<ObjectiveStatus> = new Set(["verified", "mastered"]);
/** Statuses that aren't in rotation and have no check open (src/lib/mastery/types.ts): everything else is a weak spot. */
const NOT_WEAK: ReadonlySet<ObjectiveStatus> = new Set(["unseen", "verified"]);

function ymd(day: string): [number, number, number] {
  const [y, m, d] = day.split("-").map(Number);
  return [y, m - 1, d];
}

/** Whole days from one YYYY-MM-DD to another (negative when `to` is earlier). */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.UTC(...ymd(to)) - Date.UTC(...ymd(from))) / DAY_MS);
}

/** The study days from `from` to the day before the exam: every day except those out. */
function studyDaysFrom(from: string, examDate: string, daysOut: ReadonlySet<string>): string[] {
  const days: string[] = [];
  for (let d = from; d < examDate; d = addDays(d, 1)) if (!daysOut.has(d)) days.push(d);
  return days;
}

/** Round to the nearest 5 minutes; under 5 is dropped (0). */
const toFive = (minutes: number) => Math.round(minutes / 5) * 5;

export function cramPlan(input: CramPlanInput): CramPlan {
  const { today, examDate, budget } = input;
  const daysOut = new Set(budget.daysOut);
  const daysLeft = Math.max(0, daysBetween(today, examDate));
  const studyDays = daysLeft === 0 ? [] : studyDaysFrom(today, examDate, daysOut);
  const hoursLeft = Math.max(0, budget.hours - input.spentMinutes / 60);
  const minutesPerDay = studyDays.length ? (hoursLeft * 60) / studyDays.length : 0;

  // Behind: what the budget expected spent by today, pro rata over the study days from the start of the cram.
  // The start day is the ISO's date (no clock or timezone in here); a start after today counts as today.
  const sinceDay = budget.since.slice(0, 10);
  const startDay = sinceDay <= today ? sinceDay : today;
  const allStudyDays = studyDaysFrom(startDay, examDate, daysOut);
  const elapsedStudyDays = allStudyDays.filter((d) => d < today).length;
  const expected = allStudyDays.length ? budget.hours * 60 * (elapsedStudyDays / allStudyDays.length) : 0;
  const behindMinutes = Math.max(0, Math.round(expected - input.spentMinutes));

  let done = 0;
  let total = 0;
  const topics: CramPlanTopic[] = input.topics.map((t) => {
    const inScope = t.objectives.filter((o) => o.weight > 0);
    const verified = inScope.filter((o) => VERIFIED.has(o.status)).length;
    done += verified;
    total += inScope.length;
    return {
      id: t.id,
      name: t.name,
      weight: inScope.reduce((sum, o) => sum + o.weight, 0),
      unverifiedShare: inScope.length ? (inScope.length - verified) / inScope.length : 0,
      done: inScope.length > 0 && verified === inScope.length,
      minutesToday: 0,
      weakSpots: inScope.filter((o) => !NOT_WEAK.has(o.status)).map((o) => o.id),
    };
  });

  // Today's minutes split by weight × unverifiedShare across the topics still to do, rounded to 5 minutes
  // (under 5 dropped). A day out is a day off: nothing is allocated.
  const todayMinutes = studyDays.includes(today) ? minutesPerDay : 0;
  const shares = topics.map((t) => (t.weight > 0 && !t.done ? t.weight * t.unverifiedShare : 0));
  const sumShares = shares.reduce((a, b) => a + b, 0);
  if (todayMinutes > 0 && sumShares > 0) {
    topics.forEach((t, i) => {
      t.minutesToday = toFive((todayMinutes * shares[i]) / sumShares);
    });
  }
  const todayList = topics
    .filter((t) => t.minutesToday > 0)
    .sort((a, b) => b.minutesToday - a.minutesToday)
    .map((t) => ({ topicId: t.id, minutes: t.minutesToday }));

  const share = total ? done / total : 0;
  const nameOf = new Map(topics.map((t) => [t.id, t.name]));
  let line: string;
  if (daysLeft === 0) line = "Exam day. Light review only, nothing new.";
  else {
    const doneNames = topics.filter((t) => t.done).map((t) => t.name);
    const todayNames = todayList.map((t) => nameOf.get(t.topicId) ?? t.topicId);
    line = `${daysLeft} ${daysLeft === 1 ? "day" : "days"} to the exam.`;
    if (doneNames.length) line += ` Done: ${doneNames.join(", ")}.`;
    if (todayNames.length) line += ` Today: ${todayNames.join(", ")}.`;
    line += ` Verified: ${Math.round(share * 100)}%.`;
    if (behindMinutes > 0) line += todayNames.length ? ` ${behindMinutes} minutes behind: ${todayNames[todayNames.length - 1]} gets shortened.` : ` ${behindMinutes} minutes behind.`;
  }

  return { daysLeft, studyDays, hoursLeft, minutesPerDay, behindMinutes, verified: { done, total, share }, topics, today: todayList, line, defaulted: input.defaulted ?? false };
}
