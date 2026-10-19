/** Deep review's sizes, shared by the setup screen and the server that writes its questions. Pure. */

export const DEEP_RULES = {
  /** Seconds a deep-review question takes (they're written for 3–6 minutes). */
  questionSeconds: 240,
  /** Questions one deep review writes at most, whatever its length. */
  maxQuestions: 20,
  /** At most this many per objective, so a long review spreads over the course. */
  maxPerObjective: 4,
} as const;

/** The longest deep review that can be filled: every question it may write. */
export const DEEP_MAX_MINUTES = (DEEP_RULES.maxQuestions * DEEP_RULES.questionSeconds) / 60;

export const DEEP_MINUTE_PRESETS = [10, 20, 30, 45, 60] as const;

/** How many questions a deep review of `minutes` gets: its length over a question's time, at least one. */
export function deepQuestionCount(minutes: number): number {
  return Math.max(1, Math.min(DEEP_RULES.maxQuestions, Math.round((minutes * 60) / DEEP_RULES.questionSeconds)));
}
