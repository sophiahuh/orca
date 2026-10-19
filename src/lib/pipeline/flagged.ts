/**
 * Thumbs-down questions as question writing reads them (owner, 2026-10-18): the student's note is
 * cleaned and screened (a note that reads like an instruction to an AI is dropped; the reason stays),
 * and each writing call gets the ones on its own objectives first, then a few from the rest of the
 * course. Pure.
 */
import type { FeedbackReason, FlaggedQuestion } from "../data.ts";
import { screen } from "../untrusted/screen.ts";
import { sanitize } from "../untrusted/sanitize.ts";

/** Per writing call: thumbs-downs on its own objectives, and from the rest of the course. */
export const FLAGGED_LIMITS = { own: 6, other: 4 } as const;

/** Clean the course's thumbs-down rows (newest first) for the prompts. */
export function flaggedForWriting(rows: ReadonlyArray<{ objectiveId: string | null; prompt: string; reason: string | null; note: string | null }>): FlaggedQuestion[] {
  return rows.map((r) => {
    const note = r.note ? sanitize(r.note, 300).text.trim() : "";
    return {
      objectiveId: r.objectiveId,
      prompt: sanitize(r.prompt, 1200).text,
      reason: (r.reason as FeedbackReason | null) ?? null,
      note: note && !screen(note).strong ? note : null,
    };
  });
}

/** The thumbs-downs one writing call sees: on its objectives first, then others from the course. */
export function flaggedFor(flagged: readonly FlaggedQuestion[] | undefined, objectiveIds: ReadonlySet<string>): FlaggedQuestion[] {
  if (!flagged?.length) return [];
  const own = flagged.filter((f) => f.objectiveId && objectiveIds.has(f.objectiveId)).slice(0, FLAGGED_LIMITS.own);
  const other = flagged.filter((f) => !(f.objectiveId && objectiveIds.has(f.objectiveId))).slice(0, FLAGGED_LIMITS.other);
  return [...own, ...other];
}
