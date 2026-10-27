/**
 * What's due for one course (docs/MASTERY-PLAN.md §3): objectives ranked by priority, whether the
 * quick and deep reviews are due on the course's cadence, and when the next quick review is. Missed
 * questions have no review of their own: their objectives drop back to learning and wait for the
 * course's next quick review, never the same day (anything practiced today waits until a later day).
 * Derived from evidence, finished sessions and the clock; nothing here is stored.
 */
import type { QuizResult, ReviewConfig } from "../data.ts";
import type { CourseMastery } from "./course-mastery.ts";
import { localDayKey } from "./objective-state.ts";
import { type Priority, objectivePriority, openConfusion } from "./priority.ts";
import type { AnswerEvent, ObjectiveStatus } from "./types.ts";

export const AGENDA_RULES = {
  /** "1 wk before exam": reviews are due from this many days before an exam. */
  examWindowDays: 7,
} as const;

/** Statuses that put an objective on today's list (when its weight isn't 0). */
const DUE_TODAY: readonly ObjectiveStatus[] = ["fading", "mixed-up", "learning", "unseen"];

export interface RankedObjective {
  objectiveId: string;
  topicId: string;
  status: ObjectiveStatus;
  priority: Priority;
}

export interface DeepReviewDue {
  due: boolean;
  /** Local day it is (or was) due; null when there's nothing to deep review yet. */
  dueDay: string | null;
  /** Not due yet, and comes due tomorrow. */
  tomorrow: boolean;
  /** Objectives with at least one answer that aren't retired. */
  candidates: number;
}

export interface CourseAgenda {
  courseId: string;
  /** Every objective with questions, highest priority first (deep review draws from it). */
  ranked: RankedObjective[];
  /** Fading, mixed-up, learning and unseen objectives with weight > 0 not practiced today, highest priority first. */
  dueToday: RankedObjective[];
  /** Objectives that would be due but were practiced today (e.g. missed in today's quiz): they wait for the next quick review. */
  heldForNext: RankedObjective[];
  /** Mastered objectives whose check comes due tomorrow. */
  dueTomorrow: RankedObjective[];
  /** Today's quick review hasn't been done yet, by the course's cadence, and something is due. */
  quickReviewDue: boolean;
  /** The next quick-review day on the course's cadence after today; null when none is coming (exam cadence, no exam ahead). */
  nextQuickDay: string | null;
  deepReview: DeepReviewDue;
}

export interface AgendaInput {
  courseId: string;
  mastery: Pick<CourseMastery, "objectives" | "topicObjectives" | "events">;
  /** objectiveId → weight for every objective in `mastery` (see `agendaWeights`). */
  weights: ReadonlyMap<string, number>;
  config: ReviewConfig;
  /** Finished sessions (any course; filtered here). */
  results: readonly QuizResult[];
  /** Local days (YYYY-MM-DD) of this course's exams on the calendar. */
  examDays: readonly string[];
  now: Date;
  dayKey?: (iso: string) => string;
}

/** Add whole days to a YYYY-MM-DD day. Pure date arithmetic, so daylight saving can't skip or repeat a day. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Weights for the agenda: the computed weight of every objective, or a throw for one without. */
export function agendaWeights(objectiveIds: Iterable<string>, computed: ReadonlyMap<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  for (const id of objectiveIds) {
    const w = computed.get(id);
    if (w === undefined) throw new Error(`No weight computed for objective ${id}`);
    out.set(id, w);
  }
  return out;
}

const CADENCE_DAYS = { Daily: 1, Weekly: 7 } as const;

export function courseAgenda(input: AgendaInput): CourseAgenda {
  const { courseId, mastery, weights, config, now } = input;
  const dayKey = input.dayKey ?? localDayKey;
  const today = dayKey(now.toISOString());
  const tomorrow = addDays(today, 1);
  const results = input.results.filter((r) => r.courseId === courseId);
  const answers = mastery.events.filter((e): e is AnswerEvent => e.kind === "answer");

  /* Objectives, ranked */
  const ranked: RankedObjective[] = [];
  for (const [topicId, ids] of mastery.topicObjectives) {
    for (const id of ids) {
      const state = mastery.objectives.get(id);
      if (!state) throw new Error(`No state computed for objective ${id}`);
      const weight = weights.get(id);
      if (weight === undefined) throw new Error(`No weight for objective ${id}`);
      ranked.push({ objectiveId: id, topicId, status: state.status, priority: objectivePriority(state, weight, openConfusion(id, mastery.events), now) });
    }
  }
  const byPriority = (a: RankedObjective, b: RankedObjective) => b.priority.score - a.priority.score || a.objectiveId.localeCompare(b.objectiveId);
  ranked.sort(byPriority);
  const practicedToday = new Set(answers.filter((e) => dayKey(e.at) === today).map((e) => e.objectiveId));
  const due = ranked.filter((r) => DUE_TODAY.includes(r.status) && weights.get(r.objectiveId)! > 0);
  const dueToday = due.filter((r) => !practicedToday.has(r.objectiveId));
  const heldForNext = due.filter((r) => practicedToday.has(r.objectiveId));
  const dueTomorrow = ranked
    .filter((r) => {
      const dueAt = mastery.objectives.get(r.objectiveId)!.dueAt;
      return r.status === "mastered" && dueAt !== null && dayKey(dueAt) === tomorrow && weights.get(r.objectiveId)! > 0;
    })
    .sort(byPriority);

  /* Quick review cadence */
  const finishedOn = (mode: QuizResult["mode"]) => results.filter((r) => r.mode === mode).map((r) => dayKey(r.finishedAt));
  const quickDays = finishedOn("quick");
  const inExamWindow = (day: string) => input.examDays.some((e) => e >= day && addDays(e, -AGENDA_RULES.examWindowDays) <= day);
  const quickCadenceDue =
    config.quick.cadence === "Daily"
      ? !quickDays.includes(today)
      : config.quick.cadence === "Weekly"
        ? !quickDays.some((d) => d > addDays(today, -CADENCE_DAYS.Weekly))
        : inExamWindow(today) && !quickDays.includes(today);
  const quickReviewDue = dueToday.length > 0 && quickCadenceDue;
  let nextQuickDay: string | null = null;
  if (config.quick.cadence === "Daily") nextQuickDay = tomorrow;
  else if (config.quick.cadence === "Weekly") {
    const last = [...quickDays].sort().at(-1);
    const afterLast = last ? addDays(last, CADENCE_DAYS.Weekly) : tomorrow;
    nextQuickDay = afterLast > tomorrow ? afterLast : tomorrow;
  } else {
    for (let d = tomorrow; d <= addDays(tomorrow, 366); d = addDays(d, 1)) {
      if (inExamWindow(d)) {
        nextQuickDay = d;
        break;
      }
      if (!input.examDays.some((e) => e >= d)) break;
    }
  }

  /* Deep review cadence: one cadence after the last finished one (or the course's first answer); stays due if missed */
  const candidates = ranked.filter((r) => r.status !== "unseen" && r.status !== "retired").length;
  const deepDays = finishedOn("deep").sort();
  const lastDeep = deepDays.at(-1) ?? null;
  let dueDay: string | null = null;
  if (candidates > 0) {
    if (config.deep.cadence === "1 wk before exam") {
      const upcoming = input.examDays.filter((e) => e >= today).sort()[0];
      if (upcoming) dueDay = addDays(upcoming, -AGENDA_RULES.examWindowDays);
      if (dueDay && lastDeep && lastDeep >= dueDay) dueDay = null;
    } else {
      const firstAnswer = answers.map((e) => dayKey(e.at)).sort()[0];
      const anchor = lastDeep ?? firstAnswer;
      if (anchor) dueDay = addDays(anchor, CADENCE_DAYS[config.deep.cadence]);
    }
  }
  const deepReview: DeepReviewDue = { due: dueDay !== null && dueDay <= today, dueDay, tomorrow: dueDay === tomorrow, candidates };

  return { courseId, ranked, dueToday, heldForNext, dueTomorrow, quickReviewDue, nextQuickDay, deepReview };
}
