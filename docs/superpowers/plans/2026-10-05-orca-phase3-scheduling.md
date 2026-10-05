# Orca Phase 3: Scheduling and Sessions

> **Status: built 2026-10-05** on branch `phase-3`, merged into `backend-implementation`. Differences from
> the plan below: the agenda also carries the full ranked list (deep review and re-quizzes draw
> from it) and whether deep review lands tomorrow; to-do cards are their own module
> (`src/lib/mastery/todo.ts`); "where it's taught" is `src/lib/course/study.ts`; the topic quiz
> and sessions share `components/quiz/QuizRunner.tsx`, and topic quizzes count as finished
> sessions for top-ups and the poor-quiz loop too; the session buttons sit top-right on the
> course page. A top-up sends only the pages each objective is anchored to (plus one either side;
> its topic's range without anchors; a file over 60 pages is never sent whole), not the whole
> material (decision 8 said whole). Top-ups have only run against a stubbed model.

Roadmap: `docs/BACKEND-ROADMAP.md`, Phase 3. Learner model: `docs/MASTERY-PLAN.md` §2.6 and §3.
Still on-device: everything is derived from the evidence log and the store; model calls go through
the existing pipeline routes.

**Goal.** The student opens Orca and sees what to do today, ranked by real reasons: a quick review
sized to the course's time budget, a deep review when the course's cadence says so, and a review
to-do plus next-day re-quiz after a poor quiz. Pressing start assembles the session instantly from
the question stock, and the stock is topped up after the session.

## Global constraints

- Everything in `CLAUDE.md` "Invariants". Learner state stays derived: priority, the due list,
  sessions, review to-dos and deep-review due dates are computed from evidence, completed-session
  records and the clock. Nothing stores "due" or "priority".
- Pure modules (`src/lib/mastery/`, `src/lib/pipeline/` except `client.ts`) use relative `.ts`
  imports and `import type`, so `npm test` runs them.
- Model calls stay injectable; top-up is tested with fake step callers.
- No placeholders: a session with nothing to ask says so; a top-up that can't run (no model, no
  stored material text) says why.
- Before every commit: `npx tsc --noEmit`, `npm run lint`, `npm test`, and `npm run test:e2e`
  when a screen or the store changed.

## Decisions taken in this plan

Ones marked **(review)** are judgement calls worth a second look; they're also listed in
`docs/TO-DISCUSS.md` when they land.

1. **Priority** (`src/lib/mastery/priority.ts`), §2.6 minus the parked terms (frontier, distance
   discount) and minus exam proximity (exams are Phase 5):
   ```
   priority = overdue + importance + gap + 2 × mixedUp + confusion
   overdue    = 1 for unseen; for fading: min(1, daysPastDue / max(1, stabilityDays)); else 0
   importance = the objective's weight (0.5–2; neutral 1.0)
   gap        = 1 − credit / requiredCredit for unseen, learning and mixed-up; else 0
   mixedUp    = 1 when mixed-up
   confusion  = 1 while the student's latest "I don't get this" has no unaided correct answer after it
   ```
   Each term that fires gives a reason sentence ("Due for a check 3 days ago", "Mixed up with
   another answer", "You said this tripped you up", "Not mastered yet: 1 of 3 correct",
   "Weighted up: covered heavily in the material"). Weight 0 ("skipped", the material said it
   won't be tested) and retired objectives are never due. **(review: equal 1.0 coefficients
   except mix-up, as in the plan.)**
2. **What's due today** for a course: fading, mixed-up, learning and unseen objectives that have
   at least one question and weight > 0. Mastered objectives whose check is tomorrow are
   "due tomorrow". The sidebar shows one **Quick review** card per course with something due
   (count and ~minutes), plus **Deep review**, **Review** and **Re-quiz** cards below; "Due
   tomorrow" lists checks and re-quizzes that land tomorrow.
3. **Quick review cadence.** `Daily`: the card is due until a quick review is finished today.
   `Weekly`: until one is finished in the last 7 days. `1 wk before exam`: daily within 7 days
   of an exam on the calendar. After that, the course page still offers extra practice.
   **(review)**
4. **Finished sessions are recorded**, not derived: the existing `results` list gains `mode`
   (`topic | quick | deep | requiz`) and `sessionId`. "When was the last deep review" needs a
   finished-session record; a session abandoned half way isn't a finished one. Answers still
   record evidence as they're graded.
5. **Session assembly** (`src/lib/mastery/session.ts`), quick review:
   - Budget = the course's quick-review duration. Time per question: multiple choice and
     true/false 30 s, exact short answer 45 s, one-sentence (rubric) answer 90 s. At least one
     question even if it overruns.
   - Objective order (§3): mixed-up → fading and overdue before today → learning → fading due
     today → unseen; priority breaks ties within a group.
   - Spread: one question per objective in that order; if time remains, another round for
     objectives that aren't mastered yet; never the same question twice.
   - Within an objective: unseen questions first (a mixed-up objective prefers mechanism ones),
     else the one seen longest ago, marked "seen before".
   - At least one mechanism question when any due objective has one: the last pick is swapped
     for the best unseen mechanism question.
6. **Deep review** (§3): due one cadence after the last finished deep review (`Daily` = 1 day,
   `Weekly` = 7, `1 wk before exam` = within 7 days of an exam with no deep review since that
   window opened); before any deep review, one cadence after the course's first answer. Stays due
   if missed. Budget = the deep-review duration. Candidates: every objective with at least one
   answer that isn't retired. Questions prefer application, connection, transfer and mechanism
   tiers, then the rest. The budget is split across material types in proportion to the
   Settings sliders (a question's type is its upload's type; questions from "Other" uploads use
   the mean slider), and each share is filled in priority order. **(review: "deep review counts
   as a spaced check at double weight" is a mastery-rule change and is left for later.)**
7. **Poor-quiz loop** (§3). A finished session is poor when it has at least 3 answers and under
   60% correct, or an objective in it was missed twice. Its weak objectives (any miss in a poor
   session; the twice-missed one otherwise) each get:
   - a **Review** to-do: the material and slide range the objective came from (its signals'
     places, else its topic's source range), as text, and the explanations of the questions
     missed;
   - a **Re-quiz**, due from the next day: a session of only those objectives.
   Both clear once the objective is answered in a later session on a later day. A mixed-up weak
   objective's re-quiz leads with mechanism questions. **(review: the 3-answer minimum.)**
8. **Top-up.** After any finished session, every objective in it with fewer than 3 unseen
   questions gets new ones (up to 6 unseen) through the existing generate → solve → ambiguity /
   agreement checks, in the background. The weak objectives of a poor session are included.
   This needs the material's text, so **uploads now keep their page text** in the store
   (`materialPages[materialId]`; the ALD decks are 20–60 KB of text each). Figure questions are
   dropped in a top-up (the PDF isn't kept). A course uploaded before this change, or with no
   model connected, says "Couldn't write new questions: …" instead.
9. **Storage key `orca:v8`**, no migration (local data is test data).

## Tasks

### Task 1 — Model and store
`QuizResult` gains `mode` and `sessionId`; `materialPages` in the store, saved by the upload
page; `EvidenceSource` gains `quick-review | deep-review | requiz`; `orca:v8` in the store and
`e2e/fixture.ts`. `questionSeconds(q)` in `src/lib/mastery/session.ts` and `durationSeconds`.

### Task 2 — Priority
`src/lib/mastery/priority.ts`: `objectivePriority(state, weight, confusion, now)` →
`{ score, terms, reasons }`. Tests: each term alone, the parked terms absent, skipped weight and
retired never due, confusion boost clears after a correct answer.

### Task 3 — Agenda (what's due)
`src/lib/mastery/agenda.ts`: per course, the due-today objectives ranked by priority, due-tomorrow
checks, quick-review due by cadence, deep-review due, poor sessions → review to-dos and re-quizzes.
Replaces `due.ts`'s use in the store (`useAgenda()`), keeping its DST-safe day maths. Tests for
each rule including "stays due if missed" and DST.

### Task 4 — Session assembly
`src/lib/mastery/session.ts`: `assembleQuickReview`, `assembleDeepReview`, `assembleRequiz`.
Tests: budget, order, spread, unseen first, reuse marked, mechanism guarantee, slider quotas,
nothing to ask.

### Task 5 — Top-up
Split question writing and checking out of `runUpload` into `writeQuestions` (no behaviour change;
existing tests keep passing) and add `runTopUp`. Store: `addQuestions(courseId, plan)`;
`src/lib/pipeline/topup.ts` (pure: which objectives need it, which material to write from);
a browser hook that runs it once per finished session. Tests with fake callers.

### Task 6 — Screens
Move the quiz body into `components/quiz/QuizRunner.tsx` (topic quiz unchanged), add
`/session/[slug]?kind=quick|deep|requiz`, sidebar cards from the agenda with the top reason,
"Why now" and "Seen before" lines in a session, a Review to-do page
`/course/[slug]/study?objective=…`, "Quick review" and "Deep review" on the course page, and the
top-up status on the session end card.

### Task 7 — e2e and docs
e2e: a due quick review that fits the budget, a poor session creating a review to-do and a
next-day re-quiz (clock moved with `page.clock`), deep review due by cadence, top-up with
`/api/pipeline/*` stubbed. Docs: roadmap (Phase 3 done, decisions), `CLAUDE.md`, `TO-DISCUSS.md`.

## Acceptance

- A course with answers shows a ranked quick review whose size fits its configured duration;
  starting it is instant and every question carries a reason.
- A session under 60% creates a Review to-do with the slide range and missed explanations, and
  a re-quiz that appears the next day and clears when done.
- Deep review comes due on the course's cadence and stays due until finished.
- Objectives running low on unseen questions get validated new ones after a session.
- All checks and the e2e suite pass.
