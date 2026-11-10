/**
 * An exam's scope (docs/superpowers/specs/2026-11-10-cram-mode-contracts.md, section 2): how much
 * each kind of evidence about what an exam covers is worth. Pure.
 */
import type { ScopeEvidence, ScopeSignal } from "../data.ts";

/** Strength is fixed per signal: a practice exam says the most, a guess the least. */
export const SCOPE_STRENGTH: Readonly<Record<ScopeSignal, ScopeEvidence["strength"]>> = {
  "practice-exam": "strongest",
  professor: "strong",
  "study-guide": "strong",
  homework: "medium",
  "lecture-emphasis": "medium",
  guess: "light",
};
