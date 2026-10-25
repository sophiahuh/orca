/** Deep review's sizes, shared by the setup screen and the server that writes its questions. Pure. */

export const DEEP_RULES = {
  /** Seconds a deep-review question takes (they're written for 3–6 minutes). */
  questionSeconds: 240,
} as const;

export const DEEP_MINUTE_PRESETS = [10, 20, 30, 45, 60] as const;

/**
 * How many questions a deep review of `minutes` gets: the length the student picked over a
 * question's time, at least one. No upper limit (2026-10-25): its questions are spread evenly over
 * its objectives, however many that makes each.
 */
export function deepQuestionCount(minutes: number): number {
  return Math.max(1, Math.round((minutes * 60) / DEEP_RULES.questionSeconds));
}
