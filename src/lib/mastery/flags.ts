/** Struggle flags (docs/superpowers/specs/2026-11-04-weak-points-first-design.md). Pure. */
import type { ConfusionEvent, FlagSource, FlagStrength } from "./types.ts";

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
