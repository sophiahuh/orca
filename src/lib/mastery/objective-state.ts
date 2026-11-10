/**
 * Objective state as a fold over evidence (docs/MASTERY-PLAN.md §2.3–2.5).
 * Spacing comes from FSRS (ts-fsrs), fed every graded answer from the first one.
 * Orca's own rules sit on top: the mastery bar, mix-ups and retirement.
 * applyAnswer is the step; stateAt reads the result against the clock.
 */
import { type Card, type Grade, Rating, type State, createEmptyCard, fsrs, generatorParameters } from "ts-fsrs";
import { flagStrength } from "./flags.ts";
import type { AnswerEvent, ConfusionEvent, EvidenceEvent, Help, ObjectiveState, ObjectiveStatus, Outcome, SignalEvent, WorkEvent } from "./types.ts";

export const MASTERY_RULES = {
  /** Credited answers needed for mastery. */
  requiredCredit: 3,
  /** Distinct days that credit must come from. */
  requiredDays: 2,
  /** Of the credit, at least this much must come from graded answers (not self-marked). */
  requiredGradedCredit: 2,
  /** Credit for a question missed before and answered right on a later day (its answer was shown; owner, 2026-11-08). */
  retryCredit: 0.5,
  /** FSRS schedules a check when predicted recall falls to this. */
  targetRetention: 0.9,
  /** Longest gap between checks, so everything mastered is checked within a semester. */
  maxIntervalDays: 60,
  /** Retired once FSRS stability reaches this many days... */
  retireStabilityDays: 60,
  /** ...with at least this many successful spaced checks since mastery. */
  retireAfterChecks: 3,
  /**
   * A spaced check passed in a deep review sets the next check this many times further out than
   * FSRS's Good interval (still capped at maxIntervalDays). Deep review asks harder questions, and a
   * harder successful retrieval is stronger evidence. Between Anki's SM-2 easy bonus (1.3) and what
   * FSRS's own Easy rating gives after the first review (about 1.6–1.7× Good). FSRS's memory
   * estimate stays a Good, so later intervals and retirement aren't inflated.
   */
  deepReviewStretch: 1.5,
  /**
   * Weak points first: an objective that reached mastery on an answer before this time stays in
   * rotation, so nothing a student had already mastered drops off their island. The day the rules
   * shipped (move it, and record the new hash, if they ship later).
   */
  rotationSince: "2026-11-05T00:00:00.000Z",
} as const;

/**
 * The version of the rules stored snapshots were folded under (`objective_state.rules_version`).
 * A snapshot with an older version counts as stale and is rebuilt from the evidence log. Bump it
 * whenever the result of the fold could change: a constant in MASTERY_RULES, the FSRS parameters
 * (including a ts-fsrs upgrade that moves its default weights), or the logic of applyAnswer,
 * applyWork, applySignal, applyConfusion or a day key, or FLAG_STRENGTH (src/lib/mastery/flags.ts).
 * tests/mastery/snapshot.test.ts fails when the constants, the FSRS parameters or the flag strengths
 * change without a bump (it hashes them) and when the logic does (golden replays recorded per
 * version); record the new hash and golden accumulators there with the bump.
 * Version 4 (2026-11-10, cram mode): help (hint = assisted, shown = a miss), grader claude, work
 * and signal events, and the connector-struggled flag source.
 */
export const RULES_VERSION = 4;

/** Deterministic (no fuzz), day-based (no same-day learning steps; sessions are daily), capped at 60 days. */
export const FSRS_PARAMETERS = Object.freeze(
  generatorParameters({
    request_retention: MASTERY_RULES.targetRetention,
    maximum_interval: MASTERY_RULES.maxIntervalDays,
    enable_fuzz: false,
    enable_short_term: false,
  }),
);
const scheduler = fsrs(FSRS_PARAMETERS);

const DAY_MS = 86_400_000;

/**
 * Enforce the maximum interval ourselves. ts-fsrs applies `maximum_interval` before it forces
 * Good to be at least Hard + 1 day, so a Good answer can land one day past the cap (61 for 60).
 */
function capInterval(card: Card, t: number): Card {
  const latest = t + MASTERY_RULES.maxIntervalDays * DAY_MS;
  return card.due.getTime() > latest ? { ...card, due: new Date(latest), scheduled_days: MASTERY_RULES.maxIntervalDays } : card;
}

/** The next check `stretch` times further out than the card's interval, in whole days, capped. */
function stretchedDue(card: Card, t: number, stretch: number): string {
  const days = Math.min(MASTERY_RULES.maxIntervalDays, Math.round(card.scheduled_days * stretch));
  return new Date(t + days * DAY_MS).toISOString();
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

/**
 * Day keys (YYYY-MM-DD) in an IANA timezone, for code that doesn't run in the student's own
 * clock: the server always folds with the student's profile timezone. Throws a RangeError for an
 * unknown timezone and an Error for an unparseable time, rather than guessing a day.
 */
export function dayKeyIn(timeZone: string): (iso: string) => string {
  let format = dayFormatters.get(timeZone);
  if (!format) {
    // Throws RangeError for an unknown zone, before anything is cached.
    format = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    dayFormatters.set(timeZone, format);
  }
  const f = format;
  return (iso: string) => {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) throw new Error(`Can't take the day of an unparseable time: "${iso}"`);
    let year = "";
    let month = "";
    let day = "";
    for (const p of f.formatToParts(t)) {
      if (p.type === "year") year = p.value;
      else if (p.type === "month") month = p.value;
      else if (p.type === "day") day = p.value;
    }
    return `${year}-${month}-${day}`;
  };
}

/** Building an Intl formatter is the slow part (tens of microseconds); one per timezone, kept for the process. */
const dayFormatters = new Map<string, Intl.DateTimeFormat>();

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
  /** Questions already attempted. */
  attempted: string[];
  /** Questions that have earned credit (once each). */
  credited: string[];
  /** The day each attempted question was last attempted: a missed question earns half credit when answered right on a later day. */
  attemptDays: Record<string, string>;
  credit: number;
  /** The part of `credit` earned from graded (not self-marked) answers. */
  gradedCredit: number;
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
  /** The session the last miss happened in; the retry must come from a later session. */
  missSessionId: string | null;
  retired: boolean;
  /** FSRS memory state; null before the first answer. */
  card: StoredCard | null;
  /** In rotation: a struggled flag, a wrong or partly right answer, or mastered before rotationSince. Never cleared. */
  inRotation: boolean;
  /** A check flag on an objective not in rotation, open until its next answer. */
  checkOpen: boolean;
  /** Answered fully right by Orca's own grader at least once: what "verified" means (a self-marked correct proves nothing). */
  verifiedUnaided: boolean;
}

export const EMPTY_ACCUMULATOR: ObjectiveAccumulator = Object.freeze({
  answered: 0,
  lastAt: null,
  attempted: [],
  credited: [],
  attemptDays: {},
  credit: 0,
  gradedCredit: 0,
  creditDays: [],
  lastTwo: [],
  mixedUp: false,
  lastMissQuestion: null,
  mastered: false,
  checkDueAt: null,
  spacedChecks: 0,
  missPending: false,
  missSessionId: null,
  retired: false,
  card: null,
  inRotation: false,
  checkOpen: false,
  verifiedUnaided: false,
}) as ObjectiveAccumulator;

function timeOf(e: Pick<EvidenceEvent, "id" | "at">) {
  const t = Date.parse(e.at);
  if (Number.isNaN(t)) throw new Error(`Evidence ${e.id} has an unparseable timestamp: "${e.at}"`);
  return t;
}

/**
 * A graded attempt as the fold sees it, whether it came from a question in the bank (an answer) or
 * a problem Claude set (work, with the event's own id as the question). `assisted`: the grade came
 * from the student or Claude alone, or a hint was given (half credit, never verifies). `help`
 * "shown" (the answer was revealed first) counts as a miss whatever the outcome says.
 */
interface GradedAttempt {
  id: string;
  at: string;
  objectiveId: string;
  questionId: string;
  tier: AnswerEvent["tier"];
  outcome: Outcome;
  assisted: boolean;
  source: AnswerEvent["source"];
  sessionId: string;
}

/** How an attempt grades for FSRS: wrong (or shown) → Again; partial, self-marked or hinted → Hard; unaided correct → Good. */
function gradeOf(a: Pick<GradedAttempt, "outcome" | "assisted">): Grade {
  if (a.outcome === "incorrect") return Rating.Again;
  if (a.outcome === "partial" || a.assisted) return Rating.Hard;
  return Rating.Good;
}

/** The outcome an attempt counts as: a miss when the answer was shown before it, else what the grader said. */
const effectiveOutcome = (outcome: Outcome, help: Help | undefined): Outcome => (help === "shown" ? "incorrect" : outcome);

/**
 * A graded attempt the student made alone, as the fold sees it: graded (not self-marked, and work
 * judged against a solution or a known answer, not by Claude alone) with no hint and no answer
 * shown first. What the agenda reads as clearing an open confusion, and what keeps the streak alive.
 */
export function unaidedAttempt(e: AnswerEvent | WorkEvent): boolean {
  const graded = e.kind === "answer" ? e.grader !== "self" : e.basis !== "claude";
  return graded && e.help !== "hint" && e.help !== "shown";
}

/** One step of the fold for an answer. Returns a new accumulator; never mutates the one it was given. */
export function applyAnswer(acc: ObjectiveAccumulator, e: AnswerEvent, options: ObjectiveStateOptions): ObjectiveAccumulator {
  // Self-marked or hinted: assisted. Claude grading against the stored key (grader claude) with no
  // help, like Orca's own graders, is not.
  return applyAttempt(
    acc,
    { id: e.id, at: e.at, objectiveId: e.objectiveId, questionId: e.questionId, tier: e.tier, outcome: effectiveOutcome(e.outcome, e.help), assisted: e.grader === "self" || e.help === "hint", source: e.source, sessionId: e.sessionId },
    options,
  );
}

/**
 * One step of the fold for a piece of work (a problem Claude set during a cram): folds like an
 * answer to a question with the event's own id. Judged against an official solution or a known
 * answer it is graded; judged by Claude alone it is assisted (half credit, never verifies).
 */
export function applyWork(acc: ObjectiveAccumulator, e: WorkEvent, options: ObjectiveStateOptions): ObjectiveAccumulator {
  return applyAttempt(
    acc,
    { id: e.id, at: e.at, objectiveId: e.objectiveId, questionId: e.id, tier: null, outcome: effectiveOutcome(e.outcome, e.help), assisted: e.basis === "claude" || e.help === "hint", source: e.source, sessionId: e.sessionId },
    options,
  );
}

function applyAttempt(acc: ObjectiveAccumulator, e: GradedAttempt, options: ObjectiveStateOptions): ObjectiveAccumulator {
  const R = MASTERY_RULES;
  const t = timeOf(e);
  if (acc.lastAt !== null && t < Date.parse(acc.lastAt)) {
    throw new Error(`Evidence ${e.id} is older than the last answer applied to objective ${e.objectiveId}; rebuild its state from the log`);
  }
  const dayKey = options.dayKey ?? localDayKey;
  const assisted = e.assisted;
  const checkWasDue = acc.checkDueAt !== null && t >= Date.parse(acc.checkDueAt);
  const before = acc.card === null ? createEmptyCard(new Date(t)) : toCard(acc.card);
  const card = capInterval(scheduler.next(before, new Date(t), gradeOf(e)).card, t);
  const stored = toStored(card);
  const next: ObjectiveAccumulator = { ...acc, answered: acc.answered + 1, lastAt: e.at, card: stored, checkOpen: false };
  if (e.outcome === "correct" && !assisted) next.verifiedUnaided = true;
  // Anything short of fully right is a weak point, wherever it was answered.
  if (e.outcome !== "correct") {
    next.inRotation = true;
    // It met the bar unflagged (practice, dives) and now slipped: its check is due now, as a miss's
    // would be (a miss after mastery is handled below; a partial there doesn't move the check).
    if (!acc.inRotation && acc.mastered && e.outcome === "partial") next.checkDueAt = e.at;
  }

  if (!next.mastered) {
    if (e.outcome === "incorrect" && !assisted) {
      if (next.lastMissQuestion !== null && next.lastMissQuestion !== e.questionId) next.mixedUp = true;
      next.lastMissQuestion = e.questionId;
    } else if (e.outcome !== "incorrect" && !assisted) {
      // Any graded answer that isn't a miss ends the "in a row" (owner, 2026-11-08); clearing a
      // mix-up still takes a fully right answer (a mechanism one where the objective has those).
      next.lastMissQuestion = null;
      if (e.outcome === "correct" && next.mixedUp && (e.tier === "mechanism" || !options.hasMechanismQuestions)) next.mixedUp = false;
    }

    // Credit once per question: in full on a first attempt; half when a question missed before is
    // answered right on a later day (its answer was shown, so it proves less; owner, 2026-11-08).
    // Credited and attempted stay apart so a retry on the same day earns nothing.
    const day = dayKey(e.at);
    const firstAttempt = !next.attempted.includes(e.questionId);
    const laterDay = !firstAttempt && next.attemptDays[e.questionId] !== undefined && next.attemptDays[e.questionId] !== day;
    if (!next.credited.includes(e.questionId) && (firstAttempt || laterDay)) {
      const value = firstAttempt ? (e.outcome === "correct" ? (assisted ? 0.5 : 1) : e.outcome === "partial" ? 0.5 : 0) : e.outcome === "correct" ? R.retryCredit : 0;
      if (value > 0) {
        next.credited = [...next.credited, e.questionId];
        next.credit += value;
        if (!assisted) next.gradedCredit += value;
        if (!next.creditDays.includes(day)) next.creditDays = [...next.creditDays, day];
      }
    }
    if (firstAttempt) next.attempted = [...next.attempted, e.questionId];
    next.attemptDays = { ...next.attemptDays, [e.questionId]: day };

    if (e.outcome !== "partial") next.lastTwo = [...next.lastTwo, e.outcome].slice(-2);
    const lastTwoCorrect = next.lastTwo.length === 2 && next.lastTwo.every((o) => o === "correct");
    const enoughCredit = next.credit >= R.requiredCredit && next.gradedCredit >= R.requiredGradedCredit;
    if (enoughCredit && next.creditDays.length >= R.requiredDays && lastTwoCorrect && !next.mixedUp) {
      next.mastered = true;
      next.checkDueAt = stored.due;
      if (t < Date.parse(R.rotationSince)) next.inRotation = true;
      // A partly right answer completed the bar and made it a weak point in the same step: check it now.
      else if (!acc.inRotation && e.outcome !== "correct") next.checkDueAt = e.at;
    }
    return next;
  }

  // After mastery only two answers change the check: any miss (the student's own "I missed it"
  // included) and a genuine pass. Partial, self-marked-correct and early answers update FSRS's
  // memory estimate but leave the check where it is. A missed check is due again at once, for the
  // course's next review session; a retry in the same session doesn't pass it.
  const sameSessionAsMiss = next.missSessionId !== null && e.sessionId === next.missSessionId;
  if (e.outcome === "incorrect") {
    next.missPending = true;
    next.missSessionId = e.sessionId;
    next.retired = false;
    next.checkDueAt = e.at;
  } else if (e.outcome === "correct" && !assisted && checkWasDue && !sameSessionAsMiss) {
    next.spacedChecks += 1;
    next.missPending = false;
    next.missSessionId = null;
    next.checkDueAt = e.source === "deep-review" ? stretchedDue(card, t, R.deepReviewStretch) : stored.due;
    if (card.stability >= R.retireStabilityDays && next.spacedChecks >= R.retireAfterChecks) next.retired = true;
  }
  return next;
}

/**
 * A struggle flag. Struggled: back to learning and into rotation (credit, credit days, attempted
 * questions and the mastery check cleared), also on an objective never answered; FSRS's memory
 * estimate is rated Again (as a miss is; owner, 2026-11-08), so an objective re-learned after "I
 * don't get this" isn't checked on its old long interval. Check: one question for an objective not
 * in rotation; on a mastered one its spaced check is due now; on one still being learned, nothing.
 */
export function applyConfusion(acc: ObjectiveAccumulator, e: ConfusionEvent): ObjectiveAccumulator {
  const t = timeOf(e);
  if (acc.lastAt !== null && t < Date.parse(acc.lastAt)) {
    throw new Error(`Evidence ${e.id} is older than the last event applied to objective ${e.objectiveId}; rebuild its state from the log`);
  }
  if (flagStrength(e) === "check") {
    if (!acc.inRotation) return { ...acc, lastAt: e.at, checkOpen: true };
    // The check is due now, or stays as overdue as it already was.
    if (acc.mastered) return { ...acc, lastAt: e.at, checkDueAt: acc.checkDueAt !== null && Date.parse(acc.checkDueAt) < t ? acc.checkDueAt : e.at, retired: false };
    return { ...acc, lastAt: e.at };
  }
  return struggled(acc, e.at, t);
}

/**
 * What the student did in a cram chat. lost: exactly what a struggled flag does (in rotation, back
 * to learning, FSRS rated Again). got-it: opens a check on an objective not in rotation and not
 * mastered ("I get it" is checked, not believed), else nothing. asked-answer and asked-harder: no
 * state change (the plan and the recap read them). Signals never add credit.
 */
export function applySignal(acc: ObjectiveAccumulator, e: SignalEvent): ObjectiveAccumulator {
  const t = timeOf(e);
  if (acc.lastAt !== null && t < Date.parse(acc.lastAt)) {
    throw new Error(`Evidence ${e.id} is older than the last event applied to objective ${e.objectiveId}; rebuild its state from the log`);
  }
  if (e.signal === "lost") return struggled(acc, e.at, t);
  if (e.signal === "got-it" && !acc.inRotation && !acc.mastered) return { ...acc, lastAt: e.at, checkOpen: true };
  return acc;
}

/** Back to learning and into rotation, the bar cleared and FSRS rated Again (a struggled flag, or "lost"). */
function struggled(acc: ObjectiveAccumulator, at: string, t: number): ObjectiveAccumulator {
  const card = acc.card === null ? null : toStored(capInterval(scheduler.next(toCard(acc.card), new Date(t), Rating.Again).card, t));
  return {
    ...acc,
    lastAt: at,
    card,
    inRotation: true,
    checkOpen: false,
    attempted: [],
    credited: [],
    attemptDays: {},
    credit: 0,
    gradedCredit: 0,
    creditDays: [],
    lastTwo: [],
    lastMissQuestion: null,
    mastered: false,
    checkDueAt: null,
    spacedChecks: 0,
    missPending: false,
    missSessionId: null,
    retired: false,
  };
}

/** One step of the fold for any event. */
export function applyEvidence(acc: ObjectiveAccumulator, e: EvidenceEvent, options: ObjectiveStateOptions): ObjectiveAccumulator {
  switch (e.kind) {
    case "answer":
      return applyAnswer(acc, e, options);
    case "confusion":
      return applyConfusion(acc, e);
    case "work":
      return applyWork(acc, e, options);
    case "signal":
      return applySignal(acc, e);
  }
}

/** Read an accumulator against the clock. Fading is computed here, never by a timer. */
export function stateAt(objectiveId: string, acc: ObjectiveAccumulator, now: Date): ObjectiveState {
  let status: ObjectiveStatus;
  if (!acc.inRotation) status = acc.checkOpen ? "check-due" : acc.verifiedUnaided ? "verified" : "unseen";
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
    // Time order; two events in the same millisecond by id, so every replay folds them the same way.
    .sort((a, b) => a.t - b.t || (a.e.id < b.e.id ? -1 : a.e.id > b.e.id ? 1 : 0))
    .reduce((acc, { e }) => applyEvidence(acc, e, options), EMPTY_ACCUMULATOR);
}

export function computeObjectiveState(
  objectiveId: string,
  events: readonly EvidenceEvent[],
  now: Date,
  options: ObjectiveStateOptions,
): ObjectiveState {
  return stateAt(objectiveId, replayObjective(objectiveId, events, options), now);
}
