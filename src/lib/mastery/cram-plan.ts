/**
 * The cram plan (cram mode contract, section 6): derived from the exam's time budget, the scope's
 * objective statuses and the minutes studied so far; never stored. Pure and deterministic: `today`
 * comes from the caller, no clock reads here. The page, the exam card and `course_state` read it.
 */
import type { CramBudget } from "../data.ts";
import { addDays } from "./agenda.ts";
import { isInRotation } from "./flags.ts";
import type { ObjectiveStatus } from "./types.ts";

export interface CramPlanInput {
  /** YYYY-MM-DD, student's timezone */
  today: string;
  /** YYYY-MM-DD */
  examDate: string;
  budget: CramBudget;
  topics: Array<{ id: string; name: string; objectives: Array<{ id: string; name: string; weight: number; status: ObjectiveStatus }> }>;
  /** Minutes studied since budget.since: session_results seconds (any mode) + connector estimate (span of a day's connector events, capped at 120 min/day). */
  spentMinutes: number;
}

export interface CramPlanTopic {
  id: string;
  name: string;
  weight: number;
  unverifiedShare: number;
  done: boolean;
  minutesToday: number;
  /** Objective ids in rotation or check-due. */
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
  /** max(0, expected spent by today - spentMinutes); expected = budget.hours*60 * (elapsed study days / all study days) */
  behindMinutes: number;
  /** Objectives verified or mastered over objectives in scope (weight > 0). */
  verified: { done: number; total: number; share: number };
  topics: CramPlanTopic[];
  /** Topics with minutesToday > 0, largest first. */
  today: Array<{ topicId: string; minutes: number }>;
  /** "9 days to the exam. Done: A, B. Today: C, D. Verified: 60%." (day of: "Exam day. Light review only, nothing new."; behind: " 20 minutes behind: D gets shortened." appended) */
  line: string;
}

const utcDay = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

/** Whole days from `from` to `to` (negative once `to` is past). */
const daysBetween = (from: string, to: string) => Math.round((utcDay(to) - utcDay(from)) / 86_400_000);

/** The days from `from` to the day before `exam`, skipping `out`. */
function studyDaysFrom(from: string, exam: string, out: ReadonlySet<string>): string[] {
  const days: string[] = [];
  for (let d = from; d < exam; d = addDays(d, 1)) if (!out.has(d)) days.push(d);
  return days;
}

const verifiedStatus = (s: ObjectiveStatus) => s === "verified" || s === "mastered";
const weakStatus = (s: ObjectiveStatus) => isInRotation(s) || s === "check-due";
const roundTo5 = (minutes: number) => Math.round(minutes / 5) * 5;
const names = (list: ReadonlyArray<{ name: string }>) => list.map((t) => t.name).join(", ");

export function cramPlan(input: CramPlanInput): CramPlan {
  const { today, examDate, budget, spentMinutes } = input;
  const daysLeft = Math.max(0, daysBetween(today, examDate));
  const out = new Set(budget.daysOut);
  const studyDays = studyDaysFrom(today, examDate, out);
  const hoursLeft = Math.max(0, budget.hours - spentMinutes / 60);
  const minutesPerDay = studyDays.length ? (hoursLeft * 60) / studyDays.length : 0;

  // Behind: what a steady pace would have spent by today, over every study day since cramming started.
  const sinceDay = budget.since.slice(0, 10);
  const allStudyDays = studyDaysFrom(sinceDay < today ? sinceDay : today, examDate, out);
  const elapsed = Math.max(0, allStudyDays.length - studyDays.length);
  const expected = allStudyDays.length ? budget.hours * 60 * (elapsed / allStudyDays.length) : 0;
  const behindMinutes = Math.max(0, Math.round(expected - spentMinutes));

  // The scope: objectives with weight > 0, by topic; a topic with none in scope isn't in the plan.
  const scoped = input.topics.map((t) => ({ ...t, objectives: t.objectives.filter((o) => o.weight > 0) })).filter((t) => t.objectives.length > 0);
  const total = scoped.reduce((n, t) => n + t.objectives.length, 0);
  const done = scoped.reduce((n, t) => n + t.objectives.filter((o) => verifiedStatus(o.status)).length, 0);
  const verified = { done, total, share: total ? done / total : 0 };

  const measured = scoped.map((t) => {
    const weight = t.objectives.reduce((w, o) => w + o.weight, 0);
    const unverified = t.objectives.filter((o) => !verifiedStatus(o.status)).length;
    const unverifiedShare = unverified / t.objectives.length;
    return { id: t.id, name: t.name, weight, unverifiedShare, done: unverified === 0, weakSpots: t.objectives.filter((o) => weakStatus(o.status)).map((o) => o.id), need: weight * unverifiedShare };
  });
  const needTotal = measured.reduce((n, t) => n + t.need, 0);
  const topics: CramPlanTopic[] = measured.map(({ need, ...t }) => {
    const minutes = needTotal > 0 ? roundTo5((minutesPerDay * need) / needTotal) : 0;
    return { ...t, minutesToday: minutes >= 5 ? minutes : 0 };
  });
  const todayList = topics
    .filter((t) => t.minutesToday > 0)
    .sort((a, b) => b.minutesToday - a.minutesToday)
    .map((t) => ({ topicId: t.id, minutes: t.minutesToday }));

  const pct = Math.round(verified.share * 100);
  let line: string;
  if (daysLeft === 0) line = "Exam day. Light review only, nothing new.";
  else {
    const finished = topics.filter((t) => t.done);
    const byId = new Map(topics.map((t) => [t.id, t]));
    const todays = todayList.map((t) => byId.get(t.topicId)!);
    line = `${daysLeft} day${daysLeft === 1 ? "" : "s"} to the exam.`;
    if (finished.length) line += ` Done: ${names(finished)}.`;
    if (todays.length) line += ` Today: ${names(todays)}.`;
    line += ` Verified: ${pct}%.`;
    if (behindMinutes > 0) line += todays.length ? ` ${behindMinutes} minutes behind: ${todays[todays.length - 1].name} gets shortened.` : ` ${behindMinutes} minutes behind.`;
  }

  return { daysLeft, studyDays, hoursLeft, minutesPerDay, behindMinutes, verified, topics, today: todayList, line };
}
