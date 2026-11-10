/**
 * The cram plan (cram mode contract, section 6 and its per-day addendum): derived from the exam
 * date, the student's time budget by day and the scope's objectives as they stand, never stored.
 * Pure and deterministic: no clock reads, `today` comes from the caller (in the student's
 * timezone). The cram page reads it in the browser and `course_state` reads the same calculation,
 * so Claude's progress line and the page agree.
 */
import type { CramBudget } from "../data.ts";
import { perDayOf } from "./cram-budget.ts";
import type { ObjectiveStatus } from "./types.ts";

export { DEFAULT_HOURS_PER_DAY, defaultBudget } from "./cram-budget.ts";

/** Minutes studied since budget.since, split at the start of today (the student's day). */
export interface SpentMinutes {
  /** On the days before today. */
  beforeToday: number;
  /** Today so far. */
  today: number;
}

export interface CramPlanInput {
  /** YYYY-MM-DD, student's timezone */
  today: string;
  /** YYYY-MM-DD */
  examDate: string;
  budget: CramBudget;
  /** The exam's topics with their objectives: `weight` is the agenda's effective weight (course × scope); 0 = out of scope. */
  topics: Array<{ id: string; name: string; objectives: Array<{ id: string; name: string; weight: number; status: ObjectiveStatus }> }>;
  /**
   * Minutes studied since budget.since: session_results seconds (any mode) + connector estimate
   * (span of a day's connector events, capped at 120 min/day), split at the start of today.
   */
  spentMinutes: SpentMinutes;
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
  /** Days from today to the day before the exam with hours in the budget (a day at 0 is a day out). */
  studyDays: string[];
  /** The budget's hours by day, from the day cramming started to the day before the exam (`perDayOf`). */
  perDay: Record<string, number>;
  /** max(0, the budget's hours for today and later − today's spent minutes / 60) */
  hoursLeft: number;
  /** max(0, today's hours × 60 − minutes spent today): what's left to do today; 0 on a day out or the exam day. */
  minutesToday: number;
  /** The same as `minutesToday`, kept for readers of the first plan (it was the average over the study days left). */
  minutesPerDay: number;
  /** max(0, the budget's hours for the days before today × 60 − minutes spent on them). Whole minutes. */
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

/** Round to the nearest 5 minutes; under 5 is dropped (0). */
const toFive = (minutes: number) => Math.round(minutes / 5) * 5;

export function cramPlan(input: CramPlanInput): CramPlan {
  const { today, examDate, budget, spentMinutes } = input;
  const perDay = perDayOf(budget, examDate);
  const days = Object.keys(perDay).sort();
  const daysLeft = Math.max(0, daysBetween(today, examDate));
  // Each day's own hours: a day the budget doesn't name (the exam moved later) has none.
  const studyDays = days.filter((d) => d >= today && d < examDate && perDay[d] > 0);
  const hoursAhead = days.filter((d) => d >= today && d < examDate).reduce((sum, d) => sum + perDay[d], 0);
  const hoursLeft = Math.max(0, hoursAhead - spentMinutes.today / 60);
  const minutesToday = daysLeft === 0 ? 0 : Math.max(0, (perDay[today] ?? 0) * 60 - spentMinutes.today);
  // Behind: what the budget asked for on the days before today, less what was spent on them.
  const hoursBefore = days.filter((d) => d < today).reduce((sum, d) => sum + perDay[d], 0);
  const behindMinutes = Math.max(0, Math.round(hoursBefore * 60 - spentMinutes.beforeToday));

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
  const shares = topics.map((t) => (t.weight > 0 && !t.done ? t.weight * t.unverifiedShare : 0));
  const sumShares = shares.reduce((a, b) => a + b, 0);
  if (minutesToday > 0 && sumShares > 0) {
    topics.forEach((t, i) => {
      t.minutesToday = toFive((minutesToday * shares[i]) / sumShares);
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
    // At most three named, so the line stays one sentence; the page and the plan list them all.
    if (todayNames.length) line += ` Today: ${todayNames.slice(0, 3).join(", ")}${todayNames.length > 3 ? ` and ${todayNames.length - 3} more` : ""}.`;
    line += ` Verified: ${Math.round(share * 100)}%.`;
    if (behindMinutes > 0) line += todayNames.length ? ` ${behindMinutes} minutes behind: ${todayNames[todayNames.length - 1]} gets shortened.` : ` ${behindMinutes} minutes behind.`;
  }

  return { daysLeft, studyDays, perDay, hoursLeft, minutesToday, minutesPerDay: minutesToday, behindMinutes, verified: { done, total, share }, topics, today: todayList, line, defaulted: input.defaulted ?? false };
}
