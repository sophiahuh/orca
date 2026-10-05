/** Topic progress and island level, computed from objective states. */
import type { ObjectiveState } from "./types.ts";

export type TopicStatus = "not-started" | "in-progress" | "done";

export interface TopicProgress {
  status: TopicStatus;
  /** Objectives mastered or retired. */
  mastered: number;
  total: number;
}

/** Counts as mastered: mastered or retired. A fading objective (check due) doesn't. */
const held = (s: ObjectiveState) => s.status === "mastered" || s.status === "retired";

export function topicProgress(objectiveIds: readonly string[], states: ReadonlyMap<string, ObjectiveState>): TopicProgress {
  const list = objectiveIds.map((id) => {
    const s = states.get(id);
    if (!s) throw new Error(`No state computed for objective ${id}`);
    return s;
  });
  const mastered = list.filter(held).length;
  const total = list.length;
  const status: TopicStatus =
    total > 0 && mastered === total ? "done" : list.every((s) => s.status === "unseen") ? "not-started" : "in-progress";
  return { status, mastered, total };
}

/** Fixed island visuals, one per level. Names and cut-offs are provisional (docs/TO-DISCUSS.md). */
export type IslandLevel = "uncharted" | "sprouting" | "growing" | "thriving";

export const ISLAND_THRESHOLDS = { growing: 1 / 3, thriving: 2 / 3 } as const;

export function islandLevel(states: readonly ObjectiveState[]): IslandLevel {
  if (states.length === 0 || states.every((s) => s.status === "unseen")) return "uncharted";
  const share = states.filter(held).length / states.length;
  if (share >= ISLAND_THRESHOLDS.thriving) return "thriving";
  if (share >= ISLAND_THRESHOLDS.growing) return "growing";
  return "sprouting";
}
