/**
 * What a dive covers (weak points first, docs/superpowers/specs/2026-11-04-weak-points-first-design.md).
 * - A topic dive: every objective in the topic (the student picked it), retired ones aside.
 * - A course-wide dive: weak points (in rotation, or an open check) in priority order, then
 *   unflagged objectives (not flagged or verified) by weight.
 * - Practice other topics / Practice exam topics: unflagged objectives only, by weight; the exam's
 *   topics only when it lists some.
 * Course-wide dives and practice leave out material the class hasn't reached, and practice leaves out
 * objectives weighted 0 ("won't be tested"). Pure.
 */
import type { RankedObjective } from "./agenda.ts";
import { isInRotation } from "./flags.ts";

export type DiveScope = "course" | "practice" | "exam";

const unflagged = (r: RankedObjective) => r.status === "unseen" || r.status === "verified";
const byWeight = (a: RankedObjective, b: RankedObjective) => b.weight - a.weight || a.objectiveId.localeCompare(b.objectiveId);

export function diveObjectives(ranked: readonly RankedObjective[], scope: DiveScope, opts: { topicId?: string; examTopicIds?: readonly string[] } = {}): string[] {
  const live = ranked.filter((r) => r.status !== "retired");
  if (scope === "course" && opts.topicId !== undefined) return live.filter((r) => r.topicId === opts.topicId).map((r) => r.objectiveId);
  const reached = live.filter((r) => r.reached);
  const others = reached.filter((r) => unflagged(r) && r.weight > 0);
  if (scope === "course") {
    // `ranked` is already highest priority first.
    const weak = reached.filter((r) => isInRotation(r.status) || r.status === "check-due");
    return [...weak, ...others.sort(byWeight)].map((r) => r.objectiveId);
  }
  const topics = scope === "exam" && opts.examTopicIds?.length ? new Set(opts.examTopicIds) : null;
  return others.filter((r) => !topics || topics.has(r.topicId)).sort(byWeight).map((r) => r.objectiveId);
}
