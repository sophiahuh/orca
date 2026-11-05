/** Struggle flags (docs/superpowers/specs/2026-11-04-weak-points-first-design.md). Pure. */
import type { ConfusionEvent, FlagSource, FlagStrength, ObjectiveStatus } from "./types.ts";

/** A flag's strength follows from its source: only Claude, through the connector, asks for a check. */
export const FLAG_STRENGTH: Readonly<Record<FlagSource, FlagStrength>> = {
  homework: "struggled",
  "handwritten-marker": "struggled",
  slide: "struggled",
  manual: "struggled",
  connector: "check",
};

export function flagStrength(e: Pick<ConfusionEvent, "flagSource">): FlagStrength {
  return FLAG_STRENGTH[e.flagSource];
}

/** The sources the browser may send through POST /api/evidence; the others are written on the server. */
export const BROWSER_FLAG_SOURCES = ["homework", "slide", "manual"] as const satisfies readonly FlagSource[];

const OUT_OF_ROTATION: ReadonlySet<ObjectiveStatus> = new Set(["unseen", "verified", "check-due"]);

/** In rotation: struggled-flagged, missed or partly right, or mastered before the weak-points rules. */
export function isInRotation(status: ObjectiveStatus): boolean {
  return !OUT_OF_ROTATION.has(status);
}

/**
 * "This is hard" applies to any objective except one already being learned (learning or mixed up):
 * flagging that again would only wipe its progress toward the bar. A mastered, fading or retired
 * weak point can be flagged again.
 */
export function canFlagHard(status: ObjectiveStatus): boolean {
  return status !== "learning" && status !== "mixed-up";
}
