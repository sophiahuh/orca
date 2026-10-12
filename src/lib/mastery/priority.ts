/**
 * What to practice first (docs/MASTERY-PLAN.md §2.6). A weighted sum of real reasons, each shown to
 * the student as a sentence. The "current topic" boost, the distance discount and exam proximity are
 * left out until they're decided (docs/TO-DISCUSS.md; exams arrive in Phase 5).
 */
import { MASTERY_RULES } from "./objective-state.ts";
import type { EvidenceEvent, ObjectiveState } from "./types.ts";

export const PRIORITY_RULES = {
  overdue: 1,
  importance: 1,
  gap: 1,
  mixedUp: 2,
  confusion: 1,
  /** A weight this far from neutral (1.0) earns a reason sentence. */
  weightNote: 0.05,
} as const;

export type PriorityTermName = "overdue" | "importance" | "gap" | "mixedUp" | "confusion";

export interface PriorityTerm {
  term: PriorityTermName;
  /** The term's contribution to the score (coefficient × value). */
  value: number;
  /** One sentence for the student; null when the term is there but not worth saying (a neutral weight). */
  reason: string | null;
}

export interface Priority {
  objectiveId: string;
  score: number;
  terms: PriorityTerm[];
}

const DAY_MS = 86_400_000;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const fmtCredit = (c: number) => (Number.isInteger(c) ? String(c) : c.toFixed(1));

/**
 * The time of the student's latest "I don't get this" on the objective, if no unaided correct answer
 * has come after it. Events must already be filed under their current objective (merges followed).
 */
export function openConfusion(objectiveId: string, events: readonly EvidenceEvent[]): string | null {
  const latest = events
    .filter((e) => e.kind === "confusion" && e.objectiveId === objectiveId)
    .reduce<string | null>((best, e) => (best === null || Date.parse(e.at) >= Date.parse(best) ? e.at : best), null);
  if (latest === null) return null;
  const since = Date.parse(latest);
  const cleared = events.some(
    (e) => e.kind === "answer" && e.objectiveId === objectiveId && e.outcome === "correct" && e.grader !== "self" && Date.parse(e.at) > since,
  );
  return cleared ? null : latest;
}

/**
 * Priority of one objective. `weight` is its computed weight (0.5–2, 0 when the material says it
 * won't be tested); `confusedSince` comes from `openConfusion`. Retired objectives score 0.
 */
export function objectivePriority(state: ObjectiveState, weight: number, confusedSince: string | null, now: Date): Priority {
  const R = PRIORITY_RULES;
  const terms: PriorityTerm[] = [];
  if (state.status === "retired") return { objectiveId: state.objectiveId, score: 0, terms };

  if (state.status === "unseen") {
    terms.push({ term: "overdue", value: R.overdue, reason: "New: not practiced yet" });
  } else if (state.status === "fading") {
    if (state.dueAt === null) throw new Error(`Objective ${state.objectiveId} is fading with no check due time`);
    const daysPast = Math.max(0, (now.getTime() - Date.parse(state.dueAt)) / DAY_MS);
    const whole = Math.floor(daysPast);
    terms.push({
      term: "overdue",
      value: R.overdue * Math.min(1, daysPast / Math.max(1, state.stabilityDays ?? 1)),
      reason: whole === 0 ? "Due for a check today" : `Due for a check ${plural(whole, "day")} ago`,
    });
  }

  const weightReason =
    weight === 0
      ? "The material says this won't be tested"
      : weight > 1 + R.weightNote
        ? "Weighted up: the material leans on it"
        : weight < 1 - R.weightNote
          ? "Weighted down: the material covers it lightly"
          : null;
  terms.push({ term: "importance", value: R.importance * weight, reason: weightReason });

  if (state.status === "unseen" || state.status === "learning" || state.status === "mixed-up") {
    const gap = Math.max(0, 1 - state.credit / MASTERY_RULES.requiredCredit);
    terms.push({
      term: "gap",
      value: R.gap * gap,
      reason: state.status === "unseen" ? null : `Not mastered yet: ${fmtCredit(state.credit)} of ${MASTERY_RULES.requiredCredit} correct`,
    });
  }

  if (state.status === "mixed-up") {
    terms.push({ term: "mixedUp", value: R.mixedUp, reason: "Mixed up: missed two different questions in a row" });
  }

  if (confusedSince !== null) {
    terms.push({ term: "confusion", value: R.confusion, reason: "You said this tripped you up" });
  }

  return { objectiveId: state.objectiveId, score: terms.reduce((sum, t) => sum + t.value, 0), terms };
}

/** The reason sentences of a priority, biggest contribution first. */
export function reasonsOf(p: Priority): string[] {
  return [...p.terms]
    .filter((t) => t.reason !== null)
    .sort((a, b) => b.value - a.value)
    .map((t) => t.reason!);
}
