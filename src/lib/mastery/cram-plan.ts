/**
 * The cram plan (cram mode contract, section 6, its per-day and schedule addenda): derived from the
 * exam date, the student's time budget by day and the scope's objectives as they stand, never stored.
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
  /**
   * Minutes studied on each day since budget.since (YYYY-MM-DD in the student's timezone → minutes;
   * a day left out is 0): what the schedule marks past days met or short with. Left out when the
   * caller doesn't know it (every day's `spentMinutes` is then null).
   */
  spentByDay?: Record<string, number>;
  /** Objectives with any evidence (an answer, work, a flag or a signal) at or after budget.since: a topic with one is in progress. */
  touchedObjectiveIds: string[];
  /** The budget was assumed (`defaultBudget`), not set by the student. */
  defaulted?: boolean;
}

/** How far a topic has got in the cram: done when every in-scope objective is verified or mastered; in progress once any of them has evidence since the cram started; else untouched. */
export type CramCovered = "untouched" | "in-progress" | "done";

/** One day of the schedule, from the day cramming started to the day before the exam. */
export interface CramPlanDay {
  /** YYYY-MM-DD, the student's timezone. */
  day: string;
  /** The budget's hours for it (0: a day off). */
  hours: number;
  /** What's planned for it, in the order to do it (weak spots first, then the heaviest); empty on a day off and when nothing is left to do. */
  topics: Array<{ topicId: string; minutes: number }>;
  today: boolean;
  past: boolean;
  /** Minutes studied that day, when the caller knows them (`spentByDay`); null otherwise. */
  spentMinutes: number | null;
  /** A past day: whether what was studied reached the hours planned for it; null for today and later, and when the minutes aren't known. */
  met: boolean | null;
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
  /** done: every in-scope objective verified or mastered; in-progress: evidence on one of them since the cram started; untouched: neither. */
  covered: CramCovered;
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
  /**
   * The schedule: every day from the start of the cram to the day before the exam (the budget's
   * days). Today carries `today`'s split; the days after it walk through what's left, weak spots
   * first then the heaviest, so the scope progresses day by day (`scheduleDays`); the days before
   * today carry what the same walk puts on them from the start of the cram, recomputed from the
   * scope as it stands, with whether they were met when the minutes studied are known.
   */
  days: CramPlanDay[];
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

/** The nominal minutes an unverified objective needs, at weight 1 (the schedule's unit of need). */
export const MINUTES_PER_UNVERIFIED = 60;

/**
 * Lay the topics' remaining need out over `days`, in order: the topics are ranked once (ones with
 * weak spots first, then the largest need, then the plan's order) and each day's minutes go to them
 * in that order, each taking what it still needs up to what's left of the day, rounded to 5
 * minutes. A topic's need shrinks day by day, so the schedule works through the scope one topic
 * after another. `need` is changed in place: what each topic still needs afterwards.
 */
function scheduleDays(days: ReadonlyArray<{ day: string; minutes: number }>, topics: readonly CramPlanTopic[], need: number[]): Map<string, Array<{ topicId: string; minutes: number }>> {
  const out = new Map<string, Array<{ topicId: string; minutes: number }>>();
  const ranked = topics.map((_, i) => i).sort((a, b) => Number(topics[b].weakSpots.length > 0) - Number(topics[a].weakSpots.length > 0) || need[b] - need[a] || a - b);
  for (const { day, minutes } of days) {
    const planned: Array<{ topicId: string; minutes: number }> = [];
    let left = minutes;
    for (const i of ranked) {
      if (left < 5) break;
      const take = toFive(Math.min(need[i], left));
      if (take <= 0) continue;
      planned.push({ topicId: topics[i].id, minutes: take });
      need[i] = Math.max(0, need[i] - take);
      left -= take;
    }
    out.set(day, planned);
  }
  return out;
}

/** The topics' nominal need, in minutes: MINUTES_PER_UNVERIFIED for each unverified objective at its weight (weight × unverified share), scaled so the needs sum to `minutes`. */
function needsFor(topics: readonly CramPlanTopic[], minutes: number): number[] {
  const nominal = topics.map((t) => (t.weight > 0 && !t.done ? t.weight * t.unverifiedShare * MINUTES_PER_UNVERIFIED : 0));
  const sum = nominal.reduce((a, b) => a + b, 0);
  return nominal.map((n) => (sum > 0 && minutes > 0 ? (n * minutes) / sum : 0));
}

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

  const touched = new Set(input.touchedObjectiveIds);
  let done = 0;
  let total = 0;
  const topics: CramPlanTopic[] = input.topics.map((t) => {
    const inScope = t.objectives.filter((o) => o.weight > 0);
    const verified = inScope.filter((o) => VERIFIED.has(o.status)).length;
    done += verified;
    total += inScope.length;
    const isDone = inScope.length > 0 && verified === inScope.length;
    return {
      id: t.id,
      name: t.name,
      weight: inScope.reduce((sum, o) => sum + o.weight, 0),
      unverifiedShare: inScope.length ? (inScope.length - verified) / inScope.length : 0,
      done: isDone,
      minutesToday: 0,
      weakSpots: inScope.filter((o) => !NOT_WEAK.has(o.status)).map((o) => o.id),
      covered: isDone ? "done" : inScope.some((o) => touched.has(o.id)) ? "in-progress" : "untouched",
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

  // The schedule. Today holds today's split; the days after it walk through the need left once today's
  // split is taken out, with the needs scaled to the minutes ahead (today's left and the later days' hours),
  // so the days fill the budget and cover the scope. The days before today get the same walk from the
  // start of the cram, scaled to the whole budget: what was planned for them, as derivable now.
  const dayList = days.filter((d) => d < examDate);
  const later = dayList.filter((d) => d > today).map((d) => ({ day: d, minutes: perDay[d] * 60 }));
  const ahead = needsFor(topics, minutesToday + later.reduce((sum, d) => sum + d.minutes, 0));
  topics.forEach((t, i) => {
    ahead[i] = Math.max(0, ahead[i] - t.minutesToday);
  });
  const laterPlanned = scheduleDays(later, topics, ahead);
  const before = dayList.filter((d) => d < today).map((d) => ({ day: d, minutes: perDay[d] * 60 }));
  const beforePlanned = scheduleDays(before, topics, needsFor(topics, dayList.reduce((sum, d) => sum + perDay[d] * 60, 0)));
  const spentByDay = input.spentByDay;
  const schedule: CramPlanDay[] = dayList.map((day) => {
    const past = day < today;
    const spent = spentByDay ? (spentByDay[day] ?? 0) : null;
    return {
      day,
      hours: perDay[day],
      topics: day === today ? todayList : past ? (beforePlanned.get(day) ?? []) : (laterPlanned.get(day) ?? []),
      today: day === today,
      past,
      spentMinutes: spent,
      met: past && spent !== null ? spent >= perDay[day] * 60 : null,
    };
  });

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

  return { daysLeft, studyDays, perDay, hoursLeft, minutesToday, minutesPerDay: minutesToday, behindMinutes, verified: { done, total, share }, topics, today: todayList, days: schedule, line, defaulted: input.defaulted ?? false };
}
