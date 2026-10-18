# Question feedback: thumbs up / down (2026-10-18)

**Owner's ask.** A thumbs up/down on each question, used in the student's course and kept
platform-wide for Orca's own tracking.

**Decisions (agent's proposal, owner asked for judgement).**
- One rating per student per question (`question_feedback`, unique on owner + question; a later
  tap replaces it), with an optional reason for a thumbs down: `wrong-answer`, `unclear`,
  `too-easy`, `too-hard`, `not-my-course`.
- In the course: a thumbs-down question is never asked again in that student's sessions, and it
  counts as used for the top-up (so it gets replaced). Ratings never touch evidence or mastery.
- Platform-wide: owner-only under RLS like every table; Orca reads across students with the secret
  key (SQL in docs/SETUP-HOSTED.md §7), joining the question's type, tier, deep flag and material.

**Tasks** (each a commit):
1. Migration: the table, RLS, `my_data()` returns it; pgTAP.
2. Types, row mapping, store action `rateQuestion`; loaded with the student's data.
3. Sessions and the top-up skip thumbs-down questions; unit tests.
4. 👍/👎 (and reasons on 👎) on the answer's feedback card; e2e.
5. Docs: SETUP-HOSTED §7 queries, BACKEND-ROADMAP decision, CLAUDE.md.
