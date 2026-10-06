/**
 * A display number for an objective's mastery (Figma: 04a/04b quiz feedback "60% → 52% mastered",
 * the Concept Atlas panel "60% mastered"). It is read off the derived state, never stored, and it
 * is not what the mastery rule decides on (`objective-state.ts` does that): before mastery it shows
 * progress toward the credit bar; from mastery on it shows FSRS's predicted recall. Pure.
 */
import { MASTERY_RULES } from "./objective-state.ts";
import type { ObjectiveState } from "./types.ts";

/** 0–100. */
export function masteryPercent(state: ObjectiveState | undefined): number {
  if (!state || state.status === "unseen") return 0;
  if (state.status === "mastered" || state.status === "fading" || state.status === "retired") {
    return state.recall === null ? 100 : Math.round(Math.max(0, Math.min(1, state.recall)) * 100);
  }
  // Learning (or mixed up): the share of the credit bar reached, capped under the mastery line.
  const progress = Math.max(0, Math.min(1, state.credit / MASTERY_RULES.requiredCredit));
  const cap = state.status === "mixed-up" ? 40 : 80;
  return Math.round(progress * cap);
}

/** "back in review tomorrow" / "due today" / "in 3 days", from the next spaced check; a learning objective comes back in the next quiz. */
export function reviewPhrase(state: ObjectiveState | undefined, now: Date, dayKey: (iso: string) => string): string {
  if (!state || state.status === "unseen") return "comes up in your next quiz";
  if (state.status === "mixed-up") return "comes back in your next quiz to untangle it";
  if (!state.dueAt) return "comes back in your next quiz";
  const today = dayKey(now.toISOString());
  const due = dayKey(state.dueAt);
  if (due <= today) return "due for review today";
  const days = Math.round((new Date(due).getTime() - new Date(today).getTime()) / 86_400_000);
  if (days === 1) return "back in review tomorrow";
  return `back in review in ${days} days`;
}
