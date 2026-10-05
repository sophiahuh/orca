/**
 * What's due for one course (docs/MASTERY-PLAN.md §3): objectives ranked by priority, whether the
 * quick and deep reviews are due on the course's cadence, and the review to-dos and next-day
 * re-quizzes a poor session leaves behind. Derived from evidence, finished sessions and the clock;
 * nothing here is stored.
 */
import type { QuizResult, ReviewConfig } from "../data.ts";
import type { CourseMastery } from "./course-mastery.ts";
import { localDayKey } from "./objective-state.ts";
import { type Priority, objectivePriority, openConfusion } from "./priority.ts";
import type { AnswerEvent, ObjectiveStatus } from "./types.ts";

export const AGENDA_RULES = {
  /** A finished session with at least this many answered questions... */
  poorMinAnswers: 3,
  /** ...and a correct share under this is poor. */
  poorShare: 0.6,
  /** Missing one objective this many times in a session makes it weak, whatever the score. */
  weakMisses: 2,
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

/** After a poor session: re-read where the objective is taught, then a re-quiz from the next day. */
export interface StudyItem {
  objectiveId: string;
  topicId: string;
  /** The poor session. */
  sessionId: string;
  /** Local day of the poor session. */
  day: string;
  /** Questions on this objective missed in that session. */
  missedQuestionIds: string[];
  /** When its re-quiz can be taken: the day after the session. */
  requiz: "today" | "tomorrow";
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
  /** Every objective with questions, highest priority first (deep review and re-quizzes draw from it). */
  ranked: RankedObjective[];
  /** Fading, mixed-up, learning and unseen objectives with weight > 0, highest priority first. */
  dueToday: RankedObjective[];
  /** Mastered objectives whose check comes due tomorrow. */
  dueTomorrow: RankedObjective[];
  /** Today's quick review hasn't been done yet, by the course's cadence, and something is due. */
  quickReviewDue: boolean;
  deepReview: DeepReviewDue;
  study: StudyItem[];
}

export interface AgendaInput {
  courseId: string;
  mastery: Pick<CourseMastery, "objectives" | "topicObjectives" | "events">;
  /** objectiveId → weight for every objective in `mastery` (see `withNeutralWeights`). */
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

/** Weights for the agenda: computed weights, with the neutral 1.0 for the explicit "unsorted" buckets (they have no signals). */
export function withNeutralWeights(objectiveIds: Iterable<string>, computed: ReadonlyMap<string, number>, isUnsorted: (id: string) => boolean): Map<string, number> {
  const out = new Map<string, number>();
  for (const id of objectiveIds) {
    const w = computed.get(id);
    if (w !== undefined) out.set(id, w);
    else if (isUnsorted(id)) out.set(id, 1);
    else throw new Error(`No weight computed for objective ${id}`);
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
  const dueToday = ranked.filter((r) => DUE_TODAY.includes(r.status) && weights.get(r.objectiveId)! > 0).sort(byPriority);
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

  return { courseId, ranked, dueToday, dueTomorrow, quickReviewDue, deepReview, study: studyItems(answers, results, mastery, today, dayKey) };
}

/** Poor finished sessions → one study item per weak objective, until it's answered in a later session on a later day. */
function studyItems(
  answers: readonly AnswerEvent[],
  results: readonly QuizResult[],
  mastery: AgendaInput["mastery"],
  today: string,
  dayKey: (iso: string) => string,
): StudyItem[] {
  const R = AGENDA_RULES;
  const bySession = new Map<string, AnswerEvent[]>();
  for (const e of answers) (bySession.get(e.sessionId) ?? bySession.set(e.sessionId, []).get(e.sessionId)!).push(e);
  const finished = new Map<string, string>();
  for (const r of results) if (!finished.has(r.sessionId) || r.finishedAt > finished.get(r.sessionId)!) finished.set(r.sessionId, r.finishedAt);

  // The latest poor session per objective wins.
  const latest = new Map<string, StudyItem>();
  for (const [sessionId, finishedAt] of [...finished].sort((a, b) => a[1].localeCompare(b[1]))) {
    const events = bySession.get(sessionId) ?? [];
    // Score on first attempts: "review what I missed" retries in the same session don't dilute it.
    const firstOf = new Map<string, AnswerEvent>();
    for (const e of events) if (!firstOf.has(e.questionId)) firstOf.set(e.questionId, e);
    const first = [...firstOf.values()];
    const misses = new Map<string, AnswerEvent[]>();
    for (const e of events) if (e.outcome === "incorrect") (misses.get(e.objectiveId) ?? misses.set(e.objectiveId, []).get(e.objectiveId)!).push(e);
    const poorScore = first.length >= R.poorMinAnswers && first.filter((e) => e.outcome === "correct").length / first.length < R.poorShare;
    const day = dayKey(finishedAt);
    for (const [objectiveId, missed] of misses) {
      if (!poorScore && missed.length < R.weakMisses) continue;
      const topicId = [...mastery.topicObjectives].find(([, ids]) => ids.includes(objectiveId))?.[0];
      if (!topicId) continue; // archived since
      latest.set(objectiveId, {
        objectiveId,
        topicId,
        sessionId,
        day,
        missedQuestionIds: [...new Set(missed.map((e) => e.questionId))],
        requiz: today > day ? "today" : "tomorrow",
      });
    }
  }

  return [...latest.values()].filter(
    (item) => !answers.some((e) => e.objectiveId === item.objectiveId && e.sessionId !== item.sessionId && dayKey(e.at) > item.day),
  );
}
