---
name: assessment
description: Use when building or changing question generation, question validation, grading, or the quiz flow that records answers.
---

# Assessment

## Rules

- Every question belongs to one objective (`objectiveId`). Built-in content maps questions to
  objectives in a catalogue (`src/lib/content/ald-objectives.ts`); a question with no objective
  falls into its topic's explicit "unsorted" objective, never a guessed one.
- Prefer exact checkers (bit strings, numbers, Boolean expressions by truth table). Model grading
  needs a structured rubric (`requiredIdeas`, `acceptableAlternatives`, `knownMisconceptions`).
- Course-specific questions carry a source anchor (`anchor.locator`, `anchor.excerpt`).
- Generated questions must not copy the source verbatim, and pass an ambiguity check before a
  student sees them (Phase 2 ports the platform's check).
- The quiz records evidence only after grading finishes. A grading error records nothing.
- Never show a placeholder question. A topic with no questions shows an empty state that points
  to adding material.
