---
name: learner-evidence
description: Use when changing evidence events, objective state, mastery rules, topic progress, island levels, or anything that records a student's answer.
---

# Learner evidence

The model is in `docs/MASTERY-PLAN.md`; the code is `src/lib/mastery/`.

## Rules

- Answers and struggle flags (`confusion` events with a `flagSource`, `src/lib/mastery/flags.ts`)
  append `EvidenceEvent`s. Nothing else changes learner state. Never add a field that stores
  mastery, status, rotation or progress; compute it from events + now.
- Course structure (topics, objectives, questions) and learner state stay separate. Never put
  per-student state on a topic, objective or question record.
- A grading failure is not evidence. If an answer couldn't be graded, record nothing.
- Self-marked answers (`grader: "self"`) count half and never clear a mix-up.
- The browser writes only `homework`, `slide` and `manual` flags (`BROWSER_FLAG_SOURCES`);
  `handwritten-marker` (the upload job) and `connector` (`flag_check`) are written on the server.
  A flag never adds credit. Every live objective holds state with or without questions
  (`src/lib/mastery/attribution.ts`).
- Connector activity, upload and reading signals may raise priority later; they never produce
  mastery. An answer through the connector is evidence with `source: "connector"`: graded by Orca
  (`check_answer`: `grader` choice, exact or rubric, full credit) or, only when Orca's grader can't
  run, by Claude (`record_answer`: `grader: "self"`, half credit). `verified` takes an unaided
  correct answer; a self-marked correct proves nothing. The student's words ride `response`
  (the row's `note` column) and are never read by the fold.
- Every rule change goes in `MASTERY_RULES` (or `FLAG_STRENGTH`, for which source asks for what)
  and gets a test in `tests/mastery/`. A change to either, or to the fold's logic, needs a
  `RULES_VERSION` bump: `tests/mastery/snapshot.test.ts` hashes both and replays two golden logs.
- Provisional numbers (island thresholds, mix-up clearing) are listed in `docs/TO-DISCUSS.md`;
  update that file when you touch them.
