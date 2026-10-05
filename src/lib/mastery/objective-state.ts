/**
 * Objective state as a fold over evidence (docs/MASTERY-PLAN.md §2.3–2.5).
 * Spacing comes from FSRS (ts-fsrs), fed every graded answer from the first one.
 * Orca's own rules sit on top: the mastery bar, mix-ups and retirement.
 * applyAnswer is the step; stateAt reads the result against the clock.
 */
import { type Card, type Grade, Rating, type State, createEmptyCard, fsrs, generatorParameters } from "ts-fsrs";
import type { EvidenceEvent, ObjectiveState, ObjectiveStatus, Outcome } from "./types.ts";

export const MASTERY_RULES = {
  /** Credited answers needed for mastery. */
  requiredCredit: 3,
  /** Distinct days that credit must come from. */
  requiredDays: 2,
  /** FSRS schedules a check when predicted recall falls to this. */
  targetRetention: 0.9,
  /** Longest gap between checks, so everything mastered is checked within a semester. */
  maxIntervalDays: 60,
  /** Retired once FSRS stability reaches this many days... */
  retireStabilityDays: 60,
  /** ...with at least this many successful spaced checks since mastery. */
  retireAfterChecks: 3,
} as const;

/** Deterministic (no fuzz), day-based (no same-day learning steps; sessions are daily), capped at 60 days. */
const scheduler = fsrs(
  generatorParameters({
    request_retention: MASTERY_RULES.targetRetention,
    maximum_interval: MASTERY_RULES.maxIntervalDays,
    enable_fuzz: false,
    enable_short_term: false,
  }),
);

const DAY_MS = 86_400_000;

/**
 * Enforce the maximum interval ourselves. ts-fsrs applies `maximum_interval` before it forces
 * Good to be at least Hard + 1 day, so a Good answer can land one day past the cap (61 for 60).
 */
function capInterval(card: Card, t: number): Card {
  const latest = t + MASTERY_RULES.maxIntervalDays * DAY_MS;
  return card.due.getTime() > latest ? { ...card, due: new Date(latest), scheduled_days: MASTERY_RULES.maxIntervalDays } : card;
}

export interface ObjectiveStateOptions {
  /** True when the objective has a mechanism-tier question; a mix-up then needs one to clear. */
  hasMechanismQuestions: boolean;
  /** Calendar day of an ISO timestamp. Defaults to the local day. */
  dayKey?: (iso: string) => string;
}

export function localDayKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** An FSRS card as plain JSON (dates as ISO strings). */
export interface StoredCard {
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: string | null;
}

const toCard = (c: StoredCard): Card => ({
  ...c,
  due: new Date(c.due),
  state: c.state as State,
  last_review: c.last_review === null ? undefined : new Date(c.last_review),
});

const toStored = (c: Card): StoredCard => ({
  due: c.due.toISOString(),
  stability: c.stability,
  difficulty: c.difficulty,
  elapsed_days: c.elapsed_days,
  scheduled_days: c.scheduled_days,
  learning_steps: c.learning_steps,
  reps: c.reps,
  lapses: c.lapses,
  state: c.state,
  last_review: c.last_review ? c.last_review.toISOString() : null,
});

/** Everything the rules remember about one objective's history. Plain JSON, so it can be stored as a snapshot. */
export interface ObjectiveAccumulator {
  answered: number;
  /** ISO time of the last applied answer. */
  lastAt: string | null;
  /** Questions already attempted; only first attempts earn credit. */
  attempted: string[];
  credit: number;
  creditDays: string[];
  /** The last two non-partial outcomes. */
  lastTwo: Outcome[];
  mixedUp: boolean;
  lastMissQuestion: string | null;
  mastered: boolean;
  /**
   * ISO due time of the current spaced check. Set when mastered, after a passed check and after a
   * miss; only a genuine pass (unaided correct at or after it) moves it forward. FSRS's own `card.due`
   * also moves on partial, self-marked or early answers, so it can't be the check by itself.
   */
  checkDueAt: string | null;
  spacedChecks: number;
  /** A check was missed after mastery and hasn't been passed since. */
  missPending: boolean;
  retired: boolean;
  /** FSRS memory state; null before the first answer. */
  card: StoredCard | null;
}

export const EMPTY_ACCUMULATOR: ObjectiveAccumulator = Object.freeze({
  answered: 0,
  lastAt: null,
  attempted: [],
  credit: 0,
  creditDays: [],
  lastTwo: [],
  mixedUp: false,
  lastMissQuestion: null,
  mastered: false,
  checkDueAt: null,
  spacedChecks: 0,
  missPending: false,
  retired: false,
  card: null,
}) as ObjectiveAccumulator;

function timeOf(e: EvidenceEvent) {
  const t = Date.parse(e.at);
  if (Number.isNaN(t)) throw new Error(`Evidence ${e.id} has an unparseable timestamp: "${e.at}"`);
  return t;
}

/** How an answer grades for FSRS: wrong → Again; partial or self-marked → Hard; unaided correct → Good. */
function gradeOf(e: EvidenceEvent): Grade {
  if (e.outcome === "incorrect") return Rating.Again;
  if (e.outcome === "partial" || e.grader === "self") return Rating.Hard;
  return Rating.Good;
}

/** One step of the fold. Returns a new accumulator; never mutates the one it was given. */
export function applyAnswer(acc: ObjectiveAccumulator, e: EvidenceEvent, options: ObjectiveStateOptions): ObjectiveAccumulator {
  const R = MASTERY_RULES;
  const t = timeOf(e);
  if (acc.lastAt !== null && t < Date.parse(acc.lastAt)) {
    throw new Error(`Evidence ${e.id} is older than the last answer applied to objective ${e.objectiveId}; rebuild its state from the log`);
  }
  const dayKey = options.dayKey ?? localDayKey;
  const assisted = e.grader === "self";
  const checkWasDue = acc.checkDueAt !== null && t >= Date.parse(acc.checkDueAt);
  const before = acc.card === null ? createEmptyCard(new Date(t)) : toCard(acc.card);
  const card = capInterval(scheduler.next(before, new Date(t), gradeOf(e)).card, t);
  const stored = toStored(card);
  const next: ObjectiveAccumulator = { ...acc, answered: acc.answered + 1, lastAt: e.at, card: stored };

  if (!next.mastered) {
    if (e.outcome === "incorrect" && !assisted) {
      if (next.lastMissQuestion !== null && next.lastMissQuestion !== e.questionId) next.mixedUp = true;
      next.lastMissQuestion = e.questionId;
    } else if (e.outcome === "correct" && !assisted) {
      next.lastMissQuestion = null;
      if (next.mixedUp && (e.tier === "mechanism" || !options.hasMechanismQuestions)) next.mixedUp = false;
    }

    if (!next.attempted.includes(e.questionId)) {
      next.attempted = [...next.attempted, e.questionId];
      const value = e.outcome === "correct" ? (assisted ? 0.5 : 1) : e.outcome === "partial" ? 0.5 : 0;
      if (value > 0) {
        next.credit += value;
        const d = dayKey(e.at);
        if (!next.creditDays.includes(d)) next.creditDays = [...next.creditDays, d];
      }
    }

    if (e.outcome !== "partial") next.lastTwo = [...next.lastTwo, e.outcome].slice(-2);
    const lastTwoCorrect = next.lastTwo.length === 2 && next.lastTwo.every((o) => o === "correct");
    if (next.credit >= R.requiredCredit && next.creditDays.length >= R.requiredDays && lastTwoCorrect && !next.mixedUp) {
      next.mastered = true;
      next.checkDueAt = stored.due;
    }
    return next;
  }

  // After mastery only two answers change the check: any miss (the student's own "I missed it"
  // included) and a genuine pass. Partial, self-marked-correct and early answers update FSRS's
  // memory estimate but leave the check where it is.
  if (e.outcome === "incorrect") {
    next.missPending = true;
    next.retired = false;
    next.checkDueAt = stored.due;
  } else if (e.outcome === "correct" && !assisted && checkWasDue) {
    next.spacedChecks += 1;
    next.missPending = false;
    next.checkDueAt = stored.due;
    if (card.stability >= R.retireStabilityDays && next.spacedChecks >= R.retireAfterChecks) next.retired = true;
  }
  return next;
}

/** Read an accumulator against the clock. Fading is computed here, never by a timer. */
export function stateAt(objectiveId: string, acc: ObjectiveAccumulator, now: Date): ObjectiveState {
  let status: ObjectiveStatus;
  if (acc.answered === 0 || acc.card === null) status = "unseen";
  else if (!acc.mastered) status = acc.mixedUp ? "mixed-up" : "learning";
  else if (acc.retired) status = "retired";
  else if (acc.missPending || (acc.checkDueAt !== null && now.getTime() >= Date.parse(acc.checkDueAt))) status = "fading";
  else status = "mastered";

  return {
    objectiveId,
    status,
    credit: acc.credit,
    creditDays: acc.creditDays.length,
    stabilityDays: acc.mastered && acc.card ? acc.card.stability : null,
    dueAt: acc.mastered ? acc.checkDueAt : null,
    spacedChecks: acc.spacedChecks,
    recall: acc.card === null ? null : scheduler.get_retrievability(toCard(acc.card), now, false),
    lastEvidenceAt: acc.lastAt,
  };
}

/** Rebuild one objective's accumulator from the full log (in time order). */
export function replayObjective(objectiveId: string, events: readonly EvidenceEvent[], options: ObjectiveStateOptions): ObjectiveAccumulator {
  return events
    .filter((e) => e.objectiveId === objectiveId)
    .map((e) => ({ e, t: timeOf(e) }))
    .sort((a, b) => a.t - b.t)
    .reduce((acc, { e }) => applyAnswer(acc, e, options), EMPTY_ACCUMULATOR);
}

export function computeObjectiveState(
  objectiveId: string,
  events: readonly EvidenceEvent[],
  now: Date,
  options: ObjectiveStateOptions,
): ObjectiveState {
  return stateAt(objectiveId, replayObjective(objectiveId, events, options), now);
}
