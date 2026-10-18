/** A pipeline run's progress as a sentence for the student. Pure. */
import type { Progress } from "./run.ts";

export function progressMessage(p: { stage: string; [k: string]: unknown } | null | undefined): string {
  if (p?.stage === "waiting") {
    // Held by a daily budget (decision 10): the run's own message says which; it resumes on its own.
    return typeof p.message === "string" && p.message ? p.message : "Daily limit reached: processing resumes tomorrow.";
  }
  const x = p as Progress | null | undefined;
  switch (x?.stage) {
    case "transcribing":
      return `Reading ${x.pages} handwritten or scanned page${x.pages === 1 ? "" : "s"}…`;
    case "mapping":
      return "Mapping the material onto the course…";
    case "matching":
      return `Checking ${x.candidates} topics and objectives against what the course already has…`;
    case "writing":
      return x.objectives ? `Writing questions for ${x.objectives} objective${x.objectives === 1 ? "" : "s"}…` : "Writing questions…";
    case "figures":
      return `Cutting ${x.slides} figure${x.slides === 1 ? "" : "s"} from the slides…`;
    default:
      return "Waiting to start…";
  }
}
