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
  /** Objectives in rotation. */
  inRotation: number;
  /**
   * The topic's weak spots as the student sees them (owner, 2026-11-10): objectives in rotation plus
   * open checks (a *check me* from the connector is a weak spot until it's passed). The trail, the
   * course header and the island count the same thing.
   */
  weak: number;
  /** Every live objective in the topic. */
  objectives: number;
}

/** Counts as mastered: mastered or retired. A fading objective (check due) doesn't. */
const held = (s: ObjectiveState) => s.status === "mastered" || s.status === "retired";

/** done: every weak point mastered (at least one) and no open check. in-progress: a weak point to work on, or an open check. not-started: neither (nothing flagged or missed). */
export function topicProgress(objectiveIds: readonly string[], states: ReadonlyMap<string, ObjectiveState>): TopicProgress {
  const list = objectiveIds.map((id) => {
    const s = states.get(id);
    if (!s) throw new Error(`No state computed for objective ${id}`);
    return s;
  });
  const rotating = list.filter((s) => isInRotation(s.status));
  const mastered = rotating.filter(held).length;
  const checks = list.filter((s) => s.status === "check-due").length;
  const openCheck = checks > 0;
  const status: TopicStatus =
    rotating.length > 0 && mastered === rotating.length && !openCheck ? "done" : rotating.length > mastered || openCheck ? "in-progress" : "not-started";
  return { status, mastered, inRotation: rotating.length, weak: rotating.length + checks, objectives: list.length };
}

/** Fixed island visuals, one per level. Names and cut-offs are provisional (docs/TO-DISCUSS.md). */
export type IslandLevel = "uncharted" | "sprouting" | "growing" | "thriving";

export const ISLAND_THRESHOLDS = { growing: 1 / 3, thriving: 2 / 3 } as const;

/** No weak spots (nothing in rotation, no open check) is uncharted ("No weak spots flagged yet"); otherwise the share of weak spots held. */
export function islandLevel(states: readonly ObjectiveState[]): IslandLevel {
  const weak = states.filter((s) => isInRotation(s.status) || s.status === "check-due");
  if (weak.length === 0) return "uncharted";
  const share = weak.filter(held).length / weak.length;
  if (share >= ISLAND_THRESHOLDS.thriving) return "thriving";
  if (share >= ISLAND_THRESHOLDS.growing) return "growing";
  return "sprouting";
}
