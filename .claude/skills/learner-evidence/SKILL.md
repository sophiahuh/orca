---
name: learner-evidence
description: Use when changing evidence events, objective state, mastery rules, topic progress, island levels, or anything that records a student's answer.
---

# Learner evidence

The model is in `docs/MASTERY-PLAN.md`; the code is `src/lib/mastery/`.

## Rules

- Answers append `EvidenceEvent`s. Nothing else changes learner state. Never add a field that
  stores mastery, status or progress; compute it from events + now.
- Course structure (topics, objectives, questions) and learner state stay separate. Never put
  per-student state on a topic, objective or question record.
- A grading failure is not evidence. If an answer couldn't be graded, record nothing.
- Self-marked answers (`grader: "self"`) count half and never clear a mix-up.
- Connector, upload and reading signals may raise priority later; they never produce mastery.
- Every rule change goes in `MASTERY_RULES` and gets a test in `tests/mastery/`.
- Provisional numbers (island thresholds, mix-up clearing) are listed in `docs/TO-DISCUSS.md`;
  update that file when you touch them.
