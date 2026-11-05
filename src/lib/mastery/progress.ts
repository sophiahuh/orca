/**
 * Topic progress and island level, computed from objective states: the share of weak points
 * (objectives in rotation, src/lib/mastery/flags.ts) mastered. Unflagged objectives don't count.
 */
import { isInRotation } from "./flags.ts";
import type { ObjectiveState } from "./types.ts";

export type TopicStatus = "not-started" | "in-progress" | "done";

export interface TopicProgress {
  status: TopicStatus;
  /** Objectives in rotation that are mastered or retired. A fading one doesn't count. */
  mastered: number;
  /** Objectives in rotation (the topic's weak points). */
  inRotation: number;
  /** Every live objective in the topic. */
  objectives: number;
}

/** Counts as mastered: mastered or retired. A fading objective (check due) doesn't. */
const held = (s: ObjectiveState) => s.status === "mastered" || s.status === "retired";

/** done: every weak point mastered (at least one). in-progress: a weak point to work on, or an open check. not-started: neither (nothing flagged or missed). */
export function topicProgress(objectiveIds: readonly string[], states: ReadonlyMap<string, ObjectiveState>): TopicProgress {
  const list = objectiveIds.map((id) => {
    const s = states.get(id);
    if (!s) throw new Error(`No state computed for objective ${id}`);
    return s;
  });
  const rotating = list.filter((s) => isInRotation(s.status));
  const mastered = rotating.filter(held).length;
  const status: TopicStatus =
    rotating.length > 0 && mastered === rotating.length ? "done" : rotating.length > mastered || list.some((s) => s.status === "check-due") ? "in-progress" : "not-started";
  return { status, mastered, inRotation: rotating.length, objectives: list.length };
}

/** Fixed island visuals, one per level. Names and cut-offs are provisional (docs/TO-DISCUSS.md). */
export type IslandLevel = "uncharted" | "sprouting" | "growing" | "thriving";

export const ISLAND_THRESHOLDS = { growing: 1 / 3, thriving: 2 / 3 } as const;

/** Nothing in rotation is uncharted ("No weak spots flagged yet"); otherwise the share of weak points held. */
export function islandLevel(states: readonly ObjectiveState[]): IslandLevel {
  const rotating = states.filter((s) => isInRotation(s.status));
  if (rotating.length === 0) return "uncharted";
  const share = rotating.filter(held).length / rotating.length;
  if (share >= ISLAND_THRESHOLDS.thriving) return "thriving";
  if (share >= ISLAND_THRESHOLDS.growing) return "growing";
  return "sprouting";
}
