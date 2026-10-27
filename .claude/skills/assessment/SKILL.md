---
name: assessment
description: Use when building or changing question generation, question validation, grading, or the quiz flow that records answers.
---

# Assessment

## Rules

- Every question belongs to one objective (`objectiveId`, required; `questions.objective_id` is
  not null), recorded in the course's objective catalogue (`objectives[courseId]` in the store).
  Its topic is that objective's current topic, following merges (`fileQuestions` in
  `src/lib/mastery/catalogue.ts`); the row's own `topic_id` is never read for filing.
- A question's id is `crypto.randomUUID()` at creation, never built from its text, position or
  filename; where it came from goes in `materialId`. Before adding, skip prompts the course
  already has (`promptKey` in `src/lib/pipeline/questions.ts`). Never delete a question or objective:
  archive or merge it, so every recorded answer still resolves.
- Prefer exact checkers (bit strings, numbers, Boolean expressions by truth table). Model grading
  needs a structured rubric (`requiredIdeas`, `acceptableAlternatives`, `knownMisconceptions`).
- Course-specific questions carry a source anchor (`anchor.locator`, `anchor.excerpt`).
- Generated questions must not copy the source verbatim, and pass the pipeline's checks before a
  student sees them (`src/lib/pipeline/run.ts`: blind solve, ambiguity for choice questions, rubric
  agreement for prose answers). A question that fails or can't be checked is dropped with a reason,
  never shown.
- The quiz records evidence only after grading finishes. A grading error records nothing.
- Never show a placeholder question. A topic with no questions shows an empty state that points
  to adding material.
