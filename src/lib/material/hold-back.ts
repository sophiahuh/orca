/**
 * Hold-back (docs/superpowers/specs/2026-11-10-cram-mode-contracts.md, section 5): a held-back
 * material is mapped to objectives but never used to write questions, so a past or practice exam
 * stays fresh for a practice test. Pure; the server, the upload page and the Canvas import share
 * the one default.
 */
import type { MaterialType } from "../data.ts";

/** Whether a material of this type is held back unless the student says otherwise. */
export const heldBackByDefault = (type: MaterialType): boolean => type === "Past exam" || type === "Practice exam";
