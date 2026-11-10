/**
 * What the cram page and the exam card feed the plan (cram mode contract, section 6): the scope as
 * topics with weighted objectives and their statuses, the minutes studied in Orca since cramming
 * started (split at today), the hours a day a setup starts from, and the days it asks about. Pure.
 */
import type { Duration, Exam, Objective, QuizResult, Relation, Topic } from "../data.ts";
import { addDays } from "../mastery/agenda.ts";
import type { CramPlanInput, SpentMinutes } from "../mastery/cram-plan.ts";
import { durationSeconds } from "../mastery/session.ts";
import type { ObjectiveStatus } from "../mastery/types.ts";
import { examObjectives } from "./exam-card.ts";
import { courseObjectiveWeights, survivingTopic } from "./weights.ts";

/** The hours a setup starts from: the course's exam review duration ("10 hours" → 10, "30 min" → 0.5). */
export function hoursFromDuration(d: Duration): number {
  return durationSeconds(d) / 3600;
}

/** Hours a day from a total over some study days, to the nearest half hour and at least half an hour (the setup's prefill). */
export function perDayHours(total: number, studyDays: number): number {
  return Math.max(0.5, Math.round((total / Math.max(1, studyDays)) * 2) / 2);
}

/** "Friday" for a YYYY-MM-DD day (pure date arithmetic, so the zone can't shift it). */
export function weekdayName(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
}

/** The days the setup asks about: today to the day before the exam (none on or after the day). */
export function remainingDays(today: string, examDate: string): string[] {
  const days: string[] = [];
  for (let d = today; d < examDate; d = addDays(d, 1)) days.push(d);
  return days;
}

/**
 * Minutes of finished sessions in this course since `since` ("in Orca": the connector's estimate is
 * server-side), split at the start of today: `dayOf` puts a finish time on the student's day.
 */
export function spentMinutesInOrca(results: readonly QuizResult[], courseId: string, since: string, today: string, dayOf: (iso: string) => string): SpentMinutes {
  const spent = { beforeToday: 0, today: 0 };
  for (const r of results) {
    if (r.courseId !== courseId || r.finishedAt < since) continue;
    const day = dayOf(r.finishedAt);
    if (day === today) spent.today += r.seconds / 60;
    else if (day < today) spent.beforeToday += r.seconds / 60;
  }
  return spent;
}

/**
 * The plan's topics: every live topic with objectives the exam covers, each objective at its course
 * weight × its scope weight (1 when unlisted), with its status. Topic ids follow merges, as the
 * agenda's weights do.
 */
export function planTopics(
  exam: Pick<Exam, "topicIds" | "scope">,
  topics: readonly Topic[],
  catalogue: Readonly<Record<string, Objective>>,
  relations: readonly Relation[],
  statusOf: (objectiveId: string) => ObjectiveStatus,
): CramPlanInput["topics"] {
  const covered = new Set(examObjectives(exam, topics, catalogue));
  const weights = courseObjectiveWeights(catalogue, topics, relations);
  const scoped = new Map((exam.scope?.objectives ?? []).map((o) => [o.objectiveId, Math.max(0, o.weight)]));
  const byId = new Map(topics.map((t) => [t.id, t]));
  const live = topics.filter((t) => t.review !== "archived" && !t.mergedInto);
  const grouped = new Map<string, CramPlanInput["topics"][number]["objectives"]>(live.map((t) => [t.id, []]));
  for (const id of covered) {
    const o = catalogue[id];
    const topicId = survivingTopic(o.topicId, byId)?.id ?? o.topicId;
    const list = grouped.get(topicId);
    if (!list) continue;
    const weight = weights.get(id);
    if (weight === undefined) throw new Error(`No weight computed for objective ${id}`);
    list.push({ id, name: o.name, weight: weight * (scoped.get(id) ?? 1), status: statusOf(id) });
  }
  return live.filter((t) => grouped.get(t.id)!.length > 0).map((t) => ({ id: t.id, name: t.name, objectives: grouped.get(t.id)! }));
}
