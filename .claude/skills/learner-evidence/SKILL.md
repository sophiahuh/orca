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
- Connector activity, upload and reading signals may raise priority later; they never produce
  mastery. An answer Claude grades through the connector is evidence, recorded self-marked
  (`grader: "self"`, `source: "connector"`).
- Every rule change goes in `MASTERY_RULES` (or `FLAG_STRENGTH`, for which source asks for what)
  and gets a test in `tests/mastery/`. A change to either, or to the fold's logic, needs a
  `RULES_VERSION` bump: `tests/mastery/snapshot.test.ts` hashes both and replays two golden logs.
- Provisional numbers (island thresholds, mix-up clearing) are listed in `docs/TO-DISCUSS.md`;
  update that file when you touch them.
