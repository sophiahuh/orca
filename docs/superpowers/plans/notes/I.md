# I: integration (Wave 2, 2026-10-06, cloud container)

## How the merge went

One agent ran every Wave 1 workstream in turn on `phase-4` itself, in the plan's merge order
(F → E → C → D → B → A), each as one commit with its full suite green before the next began, so
there were no `p4-*` branches to merge or rebase and no `database.types.ts` conflicts: the types
were regenerated after each migration (B's `20261005220000`, A's `20261005210000`). The
teammate's finished `p4-C` (`0faedd2`) and `p4-F` (`de988de`) were never pushed from her machine
and were redone from scratch.

## Cross-wiring (what no workstream owned)

- **`/api/grade` screens the prose answer** (A's `screen`) after sanitising it and logs hits to
  `security_events` as `student_answer` with the question id (`recordSecurityEvents`); the answer
  still goes to the model as a data block (the prompt treats what it says to the grader as part of
  the answer).
- **Repeat offenders lose model grading.** `REPEAT_OFFENDER = { flags: 3, days: 7 }`
  (`src/lib/server/grade.ts`): a student with three or more flagged answers in the last seven days
  gets 403 `{ graded: "self" }` from `/api/grade`, `/api/llm/status` answers `grading: "self"`
  (new field; `useServerStatus` reads it), and the quiz offers self-marking instead of sending
  answers. The owner clears it by deleting the student's `student_answer` rows in
  `security_events` (SQL in B's notes' style, below); nothing else resets it. The threshold is for
  TO-DISCUSS.
- **`/api/grade` has B's rate limit** (`LIMITS.rate.grade`, 60 a minute; 429 with `retry-after`)
  **and budget check** (the student's day and Orca's ceiling; 429 with the budget message), and
  **is metered** in `model_usage` as kind `grade` through `meter(ctx, db)`. `/api/reflect` had both
  from B (rate limit, each-call budget guard, metering through `stepCaller`).

```sql
-- Who has model grading turned off right now, and why.
select owner_id, count(*) as flagged, max(at) as last
from public.security_events
where kind = 'student_answer' and at > now() - interval '7 days'
group by owner_id having count(*) >= 3;
-- Clear one student (after a look at their quotes).
delete from public.security_events where owner_id = '<uuid>' and kind = 'student_answer';
```

Tests: `e2e/grade.spec.ts` gains a flagged answer that is graded, logged and metered (a plain one
logs nothing); three flags turning grading off (403, status `self`, the quiz self-marks, the fake
API not called), cleared by deleting the events; the 61st grade in a minute 429 with `retry-after`.

## Full suite (final run, all green)

See the commit message for counts.
