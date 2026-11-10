/**
 * Learner-evidence types. Evidence is append-only; every learner-facing state
 * (objective status, topic progress, island level) is computed from it.
 */
import type { Objective, QuestionTier } from "../data.ts";

export type Outcome = "correct" | "partial" | "incorrect";

/**
 * How an answer was judged. "self" = the student marked it without a grader; it counts as assisted.
 * "claude" = Claude graded it against the stored key through the connector; it counts as graded, not self.
 */
export type Grader = "choice" | "exact" | "rubric" | "self" | "claude";

/** How much help Claude gave before the answer: none = full credit, hint = half credit (rated Hard), shown = a miss (rated Again). */
export type Help = "none" | "hint" | "shown";

/** The kind of mistake behind a wrong or partly right answer, from a fixed list. */
export type ErrorType = "arithmetic" | "units" | "sign" | "misread" | "notation" | "concept";

/** Where the answer happened: a topic quiz, one of the scheduled sessions, or a question Claude asked through the connector (graded as self-marked). */
export type EvidenceSource = "quiz" | "quick-review" | "deep-review" | "requiz" | "connector";

/** One graded answer to one question. */
export interface AnswerEvent {
  kind: "answer";
  id: string;
  /** ISO timestamp. */
  at: string;
  courseId: string;
  topicId: string;
  objectiveId: string;
  questionId: string;
  tier: QuestionTier | null;
  outcome: Outcome;
  grader: Grader;
  source: EvidenceSource;
  /** One quiz run. A review check missed in a session can only be passed in a later session. */
  sessionId: string;
  /** The student's own words, when they came through the connector (stored for audit; never read by the fold). */
  response?: string;
  /** How much help Claude gave (connector answers); absent = none. */
  help?: Help;
  /** The student's confidence before the answer was revealed, 1 to 3 (connector answers). */
  confidence?: 1 | 2 | 3;
  /** The kind of mistake, when one was named. */
  errorType?: ErrorType;
}

/**
 * A problem Claude set and judged during a cram (no question in the bank): folds like an answer
 * with the event's own id as the question. `basis` says what the judgement rested on: an official
 * solution or a known answer count as graded; Claude alone counts as assisted (half credit).
 */
export interface WorkEvent {
  kind: "work";
  id: string;
  /** ISO timestamp. */
  at: string;
  courseId: string;
  topicId: string;
  objectiveId: string;
  /** The problem as the student saw it. */
  problem: string;
  /** The student's own words (stored for audit; never read by the fold). */
  response?: string;
  basis: "official-solution" | "known-answer" | "claude";
  outcome: Outcome;
  source: "connector";
  sessionId: string;
  help?: Help;
  confidence?: 1 | 2 | 3;
  errorType?: ErrorType;
}

/**
 * What the student did in a cram chat. lost: as a struggled flag. got-it: opens a check on an
 * objective not in rotation and not mastered. asked-answer and asked-harder: read by the plan and
 * the recap only. Signals never add credit.
 */
export interface SignalEvent {
  kind: "signal";
  id: string;
  /** ISO timestamp. */
  at: string;
  courseId: string;
  topicId: string;
  objectiveId: string;
  signal: "got-it" | "lost" | "asked-answer" | "asked-harder";
  note: string | null;
  source: "connector";
  sessionId: string;
}

/** Where a struggle flag came from (`evidence_events.flag_source`). */
export type FlagSource = "homework" | "handwritten-marker" | "connector" | "connector-struggled" | "slide" | "manual";

/** struggled: back to learning and the full mastery bar. check: one question (src/lib/mastery/flags.ts). */
export type FlagStrength = "struggled" | "check";

/**
 * A struggle flag: the student (or Claude, through the connector) says they don't have an
 * objective. A struggled flag puts the objective in rotation, back to learning; a check flag asks
 * one question. Never credit ("I don't get it" is believed, "I get it" is not).
 */
export interface ConfusionEvent {
  kind: "confusion";
  id: string;
  /** ISO timestamp. */
  at: string;
  courseId: string;
  topicId: string;
  objectiveId: string;
  /** The upload it's about; null for manual and connector flags. */
  materialId: string | null;
  /** The student's own words (a reflection, a marked passage, what they said to Claude); null for slide and manual flags. */
  note: string | null;
  flagSource: FlagSource;
  /** The page in `materialId` (a .pptx: the slide); null when the flag isn't about a page. */
  page: number | null;
}

/** The append-only learner log. Every learner-facing state is computed from it. */
export type EvidenceEvent = AnswerEvent | ConfusionEvent | WorkEvent | SignalEvent;

/** The part of an objective the mastery code reads. */
export type ObjectiveInfo = Pick<Objective, "id" | "topicId" | "name" | "review" | "mergedInto">;

/**
 * unseen / verified / check-due: not in rotation (never due, except check-due's one question).
 * The rest: in rotation (a struggled flag, a wrong or partly right answer, or mastered before
 * MASTERY_RULES.rotationSince), under the mastery bar and FSRS spacing.
 */
export type ObjectiveStatus = "unseen" | "verified" | "check-due" | "learning" | "mixed-up" | "mastered" | "fading" | "retired";

export interface ObjectiveState {
  objectiveId: string;
  status: ObjectiveStatus;
  /** Credit toward mastery: 1 per first-try unaided correct question, 0.5 for self-marked or partial. */
  credit: number;
  /** Distinct calendar days on which credit was earned. */
  creditDays: number;
  /** FSRS stability (days for predicted recall to fall to 90%); null until mastered. */
  stabilityDays: number | null;
  /** ISO time the next spaced check is due; null until mastered. */
  dueAt: string | null;
  /** Successful unaided checks made at or after their due time. */
  spacedChecks: number;
  /** FSRS's predicted chance of recalling it right now (0–1); null before any answer. */
  recall: number | null;
  lastEvidenceAt: string | null;
}
