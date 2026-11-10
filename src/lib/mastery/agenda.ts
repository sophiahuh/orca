/**
 * What's due for one course (docs/MASTERY-PLAN.md §3): objectives ranked by priority, whether the
 * quick and deep reviews are due on the course's cadence, and when the next quick review is. Missed
 * questions have no review of their own: their objectives drop back to learning and wait for the
 * course's next quick review, never the same day (anything practiced today waits until a later day).
 * Derived from evidence, finished sessions and the clock; nothing here is stored.
 */
import type { CourseSchedule, QuizResult, ReviewConfig, Weekday } from "../data.ts";
import type { CourseMastery } from "./course-mastery.ts";
import { localDayKey } from "./objective-state.ts";
import { isInRotation } from "./flags.ts";
import { type Priority, objectivePriority, openConfusion } from "./priority.ts";
import { reviewWeekdays, weekdayOf } from "./review-days.ts";
import type { AnswerEvent, ObjectiveStatus } from "./types.ts";

export const AGENDA_RULES = {
  /** "1 wk before exam": reviews are due from this many days before an exam. */
  examWindowDays: 7,
} as const;

/** Statuses that put an objective on today's list (when its weight isn't 0): weak points and open checks. */
const DUE_TODAY: readonly ObjectiveStatus[] = ["mixed-up", "learning", "fading", "check-due"];

export interface RankedObjective {
  objectiveId: string;
  topicId: string;
  status: ObjectiveStatus;
  priority: Priority;
  /** Its computed weight (0: the material or the student's notes say it won't be tested). */
  weight: number;
}

export interface DeepReviewDue {
  due: boolean;
  /** Local day it is (or was) due; null when there's nothing to deep review yet. */
  dueDay: string | null;
  /** Not due yet, and comes due tomorrow. */
  tomorrow: boolean;
  /** Objectives in rotation that aren't retired (the dive cadence only marks a dive due when there are some). */
  candidates: number;
}

export interface CourseAgenda {
  courseId: string;
  /** Every objective with questions, highest priority first (deep review draws from it). */
  ranked: RankedObjective[];
  /** Weak points (mixed-up, learning, fading) and open checks with weight > 0, not practiced today, highest priority first. */
  dueToday: RankedObjective[];
  /** Objectives that would be due but were practiced today (e.g. missed in today's quiz): they wait for the next quick review. */
  heldForNext: RankedObjective[];
  /** Mastered objectives whose check comes due tomorrow. */
  dueTomorrow: RankedObjective[];
  /** Today's quick review hasn't been done yet, by the course's cadence, and something is due. */
  quickReviewDue: boolean;
  /** The next quick-review day on the course's cadence after today; null when none is coming (exam cadence, no exam ahead). */
  nextQuickDay: string | null;
  /**
   * What the next quick review will cover: the weak points held for it, then (when today has no
   * quick review) today's due ones, highest priority first. A student may start it early.
   */
  upNext: RankedObjective[];
  /** The next quick review is tomorrow and has something to cover (the sidebar's "Due tomorrow"). */
  quickTomorrow: boolean;
  deepReview: DeepReviewDue;
}

export interface AgendaInput {
  courseId: string;
  mastery: Pick<CourseMastery, "objectives" | "topicObjectives" | "events">;
  /** objectiveId → weight for every objective in `mastery` (see `agendaWeights`). */
  weights: ReadonlyMap<string, number>;
  config: ReviewConfig;
  /** When the class meets and the student's review days: "Twice a week" and "Weekly" fall on those weekdays (`reviewWeekdays`). */
  schedule: CourseSchedule;
  /** Finished sessions (any course; filtered here). */
  results: readonly QuizResult[];
  /** Local days (YYYY-MM-DD) of this course's exams on the calendar. */
  examDays: readonly string[];
  /** The topics of the exam whose "1 wk before exam" window today is in (`examInWindow`): their weak points come first. Absent or empty: none. */
  examTopics?: ReadonlySet<string>;
  now: Date;
  dayKey?: (iso: string) => string;
}

/** Add whole days to a YYYY-MM-DD day. Pure date arithmetic, so daylight saving can't skip or repeat a day. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/**
 * The course's exam in its window (the exams table): the one the student is cramming for, whatever its date
 * (cramming is the window, cram mode contract), else the next one if today is in its "1 wk before exam" window;
 * the same exam `scopingExam` (src/lib/course/weights.ts) picks. With its topics as they are now (`currentTopic`
 * follows topic merges; an exam's topic ids aren't updated by them).
 */
export function examInWindow(
  exams: readonly { courseId: string; date: string; topicIds: readonly string[]; cramming?: boolean }[],
  courseId: string,
  today: string,
  currentTopic: (topicId: string) => string = (id) => id,
): { topicIds: readonly string[] } | null {
  const next = exams
    .filter((e) => e.courseId === courseId && (e.cramming || (e.date >= today && addDays(e.date, -AGENDA_RULES.examWindowDays) <= today)))
    .sort((a, b) => Number(!!b.cramming) - Number(!!a.cramming) || a.date.localeCompare(b.date))[0];
  return next ? { topicIds: [...new Set(next.topicIds.map(currentTopic))] } : null;
}

/** A topic's survivor after merges (topics are merged, never deleted). */
export function survivingTopic(topics: ReadonlyArray<{ id: string; mergedInto?: string }>): (topicId: string) => string {
  const byId = new Map(topics.map((t) => [t.id, t]));
  return (topicId) => {
    let t = byId.get(topicId);
    for (let i = 0; t?.mergedInto && i < 50; i++) t = byId.get(t.mergedInto);
    return t?.id ?? topicId;
  };
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

/** Without review weekdays, a cadence rolls on this many days from the last review finished. */
const CADENCE_DAYS = { Daily: 1, "Twice a week": 3, Weekly: 7 } as const;

/** The latest day on or before `day` that falls on one of `weekdays`. */
function onOrBefore(day: string, weekdays: readonly Weekday[]): string {
  for (let i = 0; i < 7; i++) if (weekdays.includes(weekdayOf(addDays(day, -i)))) return addDays(day, -i);
  throw new Error("No review weekdays");
}

/** The first day after `day` that falls on one of `weekdays`. */
function nextAfter(day: string, weekdays: readonly Weekday[]): string {
  for (let i = 1; i <= 7; i++) if (weekdays.includes(weekdayOf(addDays(day, i)))) return addDays(day, i);
  throw new Error("No review weekdays");
}

export function courseAgenda(input: AgendaInput): CourseAgenda {
  const { courseId, mastery, weights, config, schedule, now } = input;
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
      ranked.push({
        objectiveId: id,
        topicId,
        status: state.status,
        priority: objectivePriority(state, weight, openConfusion(id, mastery.events), now),
        weight,
      });
    }
  }
  // Before an exam, its topics' weak points come first (the session keeps this order inside each of its groups).
  const forExam = (r: RankedObjective) => (input.examTopics?.has(r.topicId) ? 0 : 1);
  const byPriority = (a: RankedObjective, b: RankedObjective) => forExam(a) - forExam(b) || b.priority.score - a.priority.score || a.objectiveId.localeCompare(b.objectiveId);
  ranked.sort(byPriority);
  const practicedToday = new Set(answers.filter((e) => dayKey(e.at) === today).map((e) => e.objectiveId));
  const due = ranked.filter((r) => DUE_TODAY.includes(r.status) && r.weight > 0);
  const dueToday = due.filter((r) => !practicedToday.has(r.objectiveId));
  const heldForNext = due.filter((r) => practicedToday.has(r.objectiveId));
  const dueTomorrow = ranked
    .filter((r) => {
      const dueAt = mastery.objectives.get(r.objectiveId)!.dueAt;
      return r.status === "mastered" && dueAt !== null && dayKey(dueAt) === tomorrow && r.weight > 0;
    })
    .sort(byPriority);

  /* Quick review cadence */
  const finishedOn = (mode: QuizResult["mode"]) => results.filter((r) => r.mode === mode).map((r) => dayKey(r.finishedAt));
  const quickDays = finishedOn("quick");
  const inExamWindow = (day: string) => input.examDays.some((e) => e >= day && addDays(e, -AGENDA_RULES.examWindowDays) <= day);
  const quickOn = reviewWeekdays(config.quick.cadence, schedule.quickDays, schedule.meetings);
  const quick = config.quick.cadence;
  let quickCadenceDue: boolean;
  let nextQuickDay: string | null = null;
  if (quick === "1 wk before exam") {
    quickCadenceDue = inExamWindow(today) && !quickDays.includes(today);
    for (let d = tomorrow; d <= addDays(tomorrow, 366); d = addDays(d, 1)) {
      if (inExamWindow(d)) {
        nextQuickDay = d;
        break;
      }
      if (!input.examDays.some((e) => e >= d)) break;
    }
  } else if (quickOn) {
    // Due from the latest review day until one is finished; stays due if missed.
    const since = onOrBefore(today, quickOn);
    quickCadenceDue = !quickDays.some((d) => d >= since);
    nextQuickDay = nextAfter(today, quickOn);
  } else {
    const every = CADENCE_DAYS[quick];
    quickCadenceDue = !quickDays.some((d) => d > addDays(today, -every));
    const last = [...quickDays].sort().at(-1);
    const afterLast = last ? addDays(last, every) : tomorrow;
    nextQuickDay = afterLast > tomorrow ? afterLast : tomorrow;
  }
  const quickReviewDue = dueToday.length > 0 && quickCadenceDue;
  const upNext = [...heldForNext, ...(quickReviewDue ? [] : dueToday)].sort(byPriority);
  const quickTomorrow = upNext.length > 0 && nextQuickDay === tomorrow;

  /* Deep review cadence: one cadence after the last finished one (or the course's first answer); stays due if missed */
  const candidates = ranked.filter((r) => isInRotation(r.status) && r.status !== "retired").length;
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
      const deepOn = reviewWeekdays(config.deep.cadence, schedule.deepDays, schedule.meetings);
      if (deepOn && firstAnswer) {
        // The latest review day after the first answer, until a dive is finished on or after it; else the next one.
        const latest = onOrBefore(today, deepOn);
        dueDay = latest > firstAnswer && !(lastDeep && lastDeep >= latest) ? latest : nextAfter(today, deepOn);
      } else {
        const anchor = lastDeep ?? firstAnswer;
        if (anchor) dueDay = addDays(anchor, CADENCE_DAYS[config.deep.cadence]);
      }
    }
  }
  const deepReview: DeepReviewDue = { due: dueDay !== null && dueDay <= today, dueDay, tomorrow: dueDay === tomorrow, candidates };

  return { courseId, ranked, dueToday, heldForNext, dueTomorrow, quickReviewDue, nextQuickDay, upNext, quickTomorrow, deepReview };
}
