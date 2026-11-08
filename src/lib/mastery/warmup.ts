/**
 * The warm-up (owner, 2026-11-08): a course with nothing flagged yet has nothing due, so the first
 * upload writes one question for its heaviest objectives and the student gets "Try N questions":
 * a short quick-style session over unflagged objectives that have an askable question, heaviest
 * first. A miss makes a weak point as anywhere else. Offered only while nothing in the course is
 * in rotation or waiting on a check; after that the ordinary due list takes over. Pure.
 */
import type { RankedObjective } from "./agenda.ts";
import { isInRotation } from "./flags.ts";

export const WARM_UP_QUESTIONS = 5;
/** How many of a first upload's heaviest objectives get one question written, so a warm-up has something to ask. */
export const WARM_UP_WRITES = 10;

export function warmUpCandidates<T extends Pick<RankedObjective, "objectiveId" | "status" | "weight" | "reached">>(
  ranked: readonly T[],
  askable: ReadonlyMap<string, readonly unknown[]>,
  max = WARM_UP_QUESTIONS,
): T[] {
  if (ranked.some((r) => isInRotation(r.status) || r.status === "check-due")) return [];
  return ranked
    .filter((r) => r.status === "unseen" && r.reached && (askable.get(r.objectiveId)?.length ?? 0) > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, max);
}
