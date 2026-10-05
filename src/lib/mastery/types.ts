/**
 * Learner-evidence types. Evidence is append-only; every learner-facing state
 * (objective status, topic progress, island level) is computed from it.
 */
import type { Objective, QuestionTier } from "../data.ts";

export type Outcome = "correct" | "partial" | "incorrect";

/** How an answer was judged. "self" = the student marked it without a grader; it counts as assisted. */
export type Grader = "choice" | "exact" | "rubric" | "self";

/** Where the answer happened. Later phases add deep review, exam review, drills and the connector. */
export type EvidenceSource = "quiz";

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
}

/**
 * The student said they don't understand an objective (a homework reflection matched to it). It
 * resets the objective to learning; it never adds credit ("I don't get it" is believed, "I get it"
 * is not).
 */
export interface ConfusionEvent {
  kind: "confusion";
  id: string;
  /** ISO timestamp. */
  at: string;
  courseId: string;
  topicId: string;
  objectiveId: string;
  /** The upload the reflection was about. */
  materialId: string;
  /** The student's own words. */
  note: string;
}

/** The append-only learner log. Every learner-facing state is computed from it. */
export type EvidenceEvent = AnswerEvent | ConfusionEvent;

/** The part of an objective the mastery code reads. */
export type ObjectiveInfo = Pick<Objective, "id" | "topicId" | "name" | "review" | "mergedInto">;

export type ObjectiveStatus = "unseen" | "learning" | "mixed-up" | "mastered" | "fading" | "retired";

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
