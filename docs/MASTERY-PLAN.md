# Mastery, progress and spaced repetition: implementation plan

> **Status 2026-10-04.** This is the learner model. How and when it gets built is in
> `docs/BACKEND-ROADMAP.md` (§2.2–2.5 are implemented in `src/lib/mastery/` (Phase 1, on-device); self-reported confusion (§2.2) is `applyConfusion` (Phase 2); §2.6 priority and the §3 loops are built in Phase 3: `priority.ts`, `agenda.ts`, `session.ts`, `src/lib/pipeline/topup.ts`).
> Not built from §2.6/§3: exam proximity and exam review (Phase 5); the 60–80% / "quick but not deep mastery" deep-review nudges (open in
> `docs/TO-DISCUSS.md`); slide images in the Review to-do (text only until files are stored, Phase 4).
> Changes since it was written: the frontier term and distance discount are parked (§2.5–2.6,
> `docs/TO-DISCUSS.md`); mix-ups are detected without a confidence rating (§2.3); a review that
> comes due stops counting as mastered (§2.3, `fading`); self-reported confusion
> resets an objective to learning (§2.2); importance is a computed weight (§2.1); objectives are
> created at upload (§2.1); there is no in-app chat (§2.2). §6 and §7 are superseded by the
> roadmap and TO-DISCUSS.

Written after reading the ai-native-learning-platform repo's learner model (`compute-learner-state.ts`,
`evidence-weights.ts`, `next-review-date.ts`, `review-priority.ts`, `daily-session.ts`) and
the PRD it implements. This plan says what to keep, what to change, and why, then gives the
concrete rules for ALD and a build order.

## 1. What their model does, and the verdict

**Keep (it's right):**
- *Evidence is append-only; state is recomputed from the log.* Nothing ever writes "mastery = 0.8".
  Every answer is an event; mastery is a pure function of events and `now`. This makes every
  number explainable ("why is this due?") and every rule change retroactive.
- *Exposure is not mastery.* Reading, chatting, finishing homework create weak evidence at most.
  Only unaided correct answers move mastery.
- *Independence and recency matter.* Assisted answers count half; old evidence fades.
- *Priority is a weighted sum of real reasons* (overdue, importance, thin evidence, misconception,
  prerequisite centrality) and each reason is shown to the student in words.
- *Misconception = confident wrong twice in a row*, cleared by a confident correct.
- *Session = time budget ÷ minutes per question*, highest-priority due items first, never a
  fabricated placeholder question.

**Change (it's wrong for us):**
- *Score is a decay-weighted mean of evidence strength.* A correct multiple-choice retrieval
  scores 0.6 × 0.75 (difficulty 0.5) = 0.45, so a student who answers every quick-review question
  right forever sits at "weak" and never reaches "solid" (0.7). Mastery should be a **decision**
  reached by meeting criteria, not an average that a question type caps.
- *Interval = 3 + score × 27 days, from last evidence.* One linear formula with no memory of how
  many successful spaced checks have happened, so a concept checked ten times gets the same
  interval as one checked once with the same score. (Resolved by adopting FSRS, §2.5.) Spaced repetition needs **stability that
  grows with each successful spaced recall** and shrinks on a miss.
- *No notion of "retired".* Everything stays in rotation forever, which is exactly the "re-quizzed
  on intro slides in week 12" problem.
- *Unit is the concept (fine-grained extraction output).* Ours is the **objective** ("can do X"),
  which is coarser, student-legible and what the quiz already targets.

## 2. The model

**Terms.** Mastery is tracked per *objective*; nothing else holds a mastery state. "Review" is
used three ways, none of them a stored record:
- a **review session**: a quiz the student sits (quick review daily, deep review on the course's
  cadence, exam review before an exam);
- a **spaced check**: the next time a mastered objective should be re-asked, i.e. its `dueAt`. An
  objective whose check has come due is `fading` until it's answered correctly again;
- **reviewing extracted content**: the student confirming or rejecting topics after an upload.

A topic's progress and an island's look are summaries computed from its objectives' states.

### 2.1 Units
- **Course → Topic → Objective.** Topics are the trail nodes. Objectives are the unit of mastery
  (see `docs/OBJECTIVES-ALD.md`). Every question carries an `objectiveId` and a `tier`
  (retrieval, mechanism, application, connection, transfer).
- Objectives may declare `implies: [objectiveId]` edges (mastering "subtract in 2's complement"
  implies "negate in 2's complement"). Used for shielding, section 2.5.
- Objectives carry a **weight** (neutral 1.0, clamped 0.5–2) computed by code from signals the
  extraction records: coverage in the material scaled by material-type weight, how many objectives
  build on it, and explicit emphasis (`tested` ×1.5, `skipped` ×0). See the roadmap's "Weight
  signals and formula". Priority (§2.6) uses it as `importance`.
- **Objectives are course data, created once.** Built-in content ships authored objectives; from
  Phase 2, each upload's extraction proposes new topics and objectives against the course's
  existing list, reconciliation matches duplicates, and the student reviews topics. Each
  objective records its `origin` (`authored | material | inferred`), its review `status`
  (`proposed | confirmed | archived`) and the upload that created it. Proposed objectives are
  quizzable with an "unreviewed" tag; archived ones never are. Details: roadmap Phase 2.
- An answer counts toward its question's *current* objective, so merging, splitting or re-tagging
  questions re-files past answers automatically.

### 2.2 Evidence event
```
{ id, at, courseId, topicId, objectiveId, questionId, tier,
  outcome: correct | partial | incorrect,
  grader: choice | exact | rubric | self,   // "self" = student marked it without a grader → assisted
  source: quiz | deep | exam | drill }      // Phase 1 records only "quiz"
```
Skipped questions and grading failures record nothing.

**Self-reported confusion** (Phase 2): when a homework reflection says the student doesn't
understand something, the note is matched to objectives (uncertain matches are confirmed by the
student) and each match records a confusion event. A confusion event resets the objective to
`learning`: credit, credit days and attempted questions are cleared, so it needs 3 fresh credited
answers over 2 days again. On an objective that isn't mastered yet it raises priority. The
asymmetry is deliberate: "I don't get it" is believed because it's cheap and safe to act on;
"I get it" never raises mastery. Connector activity (§5) is stored as a
separate *signal*, not an evidence event: it raises priority ("you studied this on Tuesday") and
never counts toward mastery.

### 2.3 Objective state (pure function of events + now)

**Mastery states: quick reference.** Only objectives have a mastery state; topics and islands
summarise them.

| State | Meaning | Counts as mastered? | Leaves the state when |
|---|---|---|---|
| `unseen` | Never answered | No | Any graded answer |
| `learning` | Answered, mastery bar not met yet | No | The bar is met (→ mastered), or a mix-up is detected (→ mixed-up) |
| `mixed-up` | Two unaided wrong answers in a row on different questions: probably a wrong idea, not a slip (no confidence rating is captured; see TO-DISCUSS) | No | An unaided correct answer on a "why" (mechanism) question, or any unaided correct answer if the objective has none (→ learning) |
| `mastered` | Bar met (§2.4); its next spaced check isn't due yet | **Yes** | The check comes due, or any miss, including a self-marked one (→ fading) |
| `fading` | Its spaced check is due or overdue, or it was just missed; it's in the review queue (a missed check is due again at once, for the course's next review session) | No | A genuine pass: an unaided correct answer at or after the due time, and after a miss, in a later session than the miss (→ mastered, with a longer interval). Partial or self-marked answers don't clear it |
| `retired` | Stable: FSRS stability ≥ 60 days with 3+ passed checks; out of daily review | **Yes** | Any miss, including a self-marked one (→ fading), or an exam covering it brings it back |

A self-reported "I don't understand this" sends any of these back to `learning` (§2.2).

Topic status is derived: `done` when every objective is mastered or retired (none fading); `in progress` otherwise; `not started` when all unseen. Topics are **not gates**: the
course moves on whether or not the student has mastered Lecture 2, so later topics unlock when
their material exists. The trail shows which earlier topics need work rather than blocking them.

Island level is derived too: the share of the course's objectives that are mastered or retired
picks one of four fixed looks (no answers yet → look 1; under ⅓ → 2; ⅓ or more → 3; ⅔ or more → 4).
Fading objectives don't count, so an island drops a level when checks come due. The level names
(`uncharted`, `sprouting`, `growing`, `thriving`) are code identifiers only.

### 2.4 Mastery criteria (what "enough questions" means)
Spaced-repetition practice (Leitner, SuperMemo, Anki) graduates an item after 2–3 successful
recalls on different occasions. One session proves recognition; a second day proves retention.
For ALD:

| Objective kind | Quick mastery (quick-review tier) | Deep mastery |
|---|---|---|
| Procedural with exact answers (convert, negate, recode, simplify) | **3 correct on 3 different questions or drill instances, on at least 2 different days, last 2 correct** | + 1 correct application-tier problem in deep review |
| Conceptual (mechanism "why" questions, MC) | **3 correct on 3 different questions, ≥ 2 days, last 2 correct** | + 1 correct connection/application answer |
| Verilog read/write | 3 correct (read a module, write an assign, spot a mistake), ≥ 2 days | + 1 written module graded exactly (truth table) |

**Graded-credit floor** (decided 2026-10-05): of the 3 credit, at least 2 must come from graded
answers (multiple choice, exact, or rubric), so self-marked answers can top up but never carry
mastery alone.

Rules that apply to all:
- Repeating the same question never adds to the count; it only clears a miss.
- Assisted answers (hint, self-report) count half: two of them equal one unaided correct.
- Partial (rubric) counts as 0.5 toward the count and does not break the "last 2 correct" streak.
- `mixed-up` blocks mastery until one unaided correct on a *mechanism* question for that
  objective (not just another retrieval), because a mix-up is a wrong model, not a slip. If the
  objective has no mechanism question, any unaided correct answer clears it (provisional).
- Exam-ready = deep mastery and not fading on exam day.

Supply this implies: at least **6 distinct quick questions per objective** (so 3 can be answered
without repeats and 3 remain for spaced checks), plus **unlimited drill instances** for the
procedural ones. Today's bank has 4–6 per *topic*; generation must become per-objective, and
drills are the cheap way to cover the arithmetic half of ALD.

### 2.5 Spacing, expiry, and the "don't re-quiz the intro" rule
**Spacing uses FSRS** (Free Spaced Repetition Scheduler, Anki's default since 23.10) through the
official `ts-fsrs` library, instead of a hand-written rule (decided 2026-10-04). FSRS models each
objective's *stability* (days until predicted recall falls to 90%), *difficulty*, and
*retrievability* (predicted recall right now), with parameters fitted on hundreds of millions of
real reviews.
- **Fed from the first answer.** Every graded answer updates the objective's FSRS state: wrong →
  Again, partial or self-marked → Hard, unaided correct → Good. So FSRS learns how hard an
  objective is before mastery, and a hard-won objective gets shorter intervals once mastered.
  Orca's mastery bar (§2.4) still decides *when* an objective counts as mastered.
- **Settings:** 90% target recall; intervals capped at 60 days so everything mastered is checked
  within a semester (enforced after scheduling, because `ts-fsrs` can overshoot its own cap by a
  day); no fuzz; no same-day learning steps (sessions are daily).
- **Checks:** when an objective is mastered, its next check is due at FSRS's due time. It's
  `fading` from that moment, and after any miss, until a **genuine pass**: an unaided correct
  answer at or after the due time. Partial, self-marked-correct and early answers update FSRS's
  memory estimate but never clear or postpone a check.
- **Example** (mastered Tue Oct 6, every check passed on time): checks Oct 13, Nov 14, Jan 13
  (capped), then retired. A miss drops stability to about 4 days, and it climbs back
  (4 → 10 → 23 → 50 days).
- **Retire** once FSRS stability reaches 60 days with ≥ 3 successful spaced checks. Retired objectives leave
  quick review entirely. They come back only if (a) exam review's scope includes them, or
  (b) a dependent objective fails, which triggers one diagnostic question on the prerequisite.
- **Shielding through `implies`**: an unaided correct on an objective counts as a half-strength
  check on each objective it implies, extending their dueAt. A student doing Booth recoding
  correctly is demonstrating 2's complement; Orca should notice instead of asking again.
- **Distance discount** *(parked, see TO-DISCUSS)*: in priority, objectives more than 3 topics behind the current frontier get
  their weight halved unless marked `tested` or an exam is within 14 days. Mastered intro
  material fades quietly rather than crowding out current work.

Expiry is therefore soft: mastery doesn't flip to zero, it becomes `fading`, which is a request
for one check, not a restart.

### 2.6 Priority (adapted from theirs)
```
priority = 1.0 × overdue            // min(1, daysPastDue / S) ; 1 for never-seen
         + 1.0 × importance         // ×1.5 if professor said tested, 0 if skipped
         + 1.0 × gap                // 1 − (correct count / required count)
         + 2.0 × mixedUp            // 1 or 0
         + 0.5 × frontier           // PARKED (TO-DISCUSS): 1 if in the current topic
         + 0.5 × examProximity      // 1 when exam ≤ 14 days and objective in scope
         × distanceDiscount         // PARKED (TO-DISCUSS): 0.5 beyond 3 topics behind, else 1
```
Each term that fires becomes a sentence under the due card, as their `reasons[]` does.

## 3. The loops the student actually feels

**Quick review (daily).** Budget from Configurations (5 min ≈ 5 questions). Composition order:
mixed-up → fading overdue → learning objectives in the current topic → fading due today →
anything else by priority. Within an objective, pick a question the student hasn't seen, else the
one seen longest ago. Mix tiers: ≥ 1 mechanism question per session.

**After a poor quiz** (< 60% in a session, or any objective with 2 misses):
1. Generate 6 fresh questions for each weak objective (one model call, about $0.03) so tomorrow's
   re-quiz isn't a replay.
2. Add a **Review** item to the to-do list: the slide range the objective came from, shown as
   cropped slides in-app, plus the explanation texts of the missed questions.
3. Schedule the re-quiz for **tomorrow**, not now. Same-day retries measure short-term memory.
4. If the objective is `mixed-up`, add a **Deep review** item instead of a plain re-quiz.

**Deep review (weekly by default).** Application and connection questions, typed, exactly checked
or rubric-graded, 10–15 minutes. Nudged when: an objective has quick mastery but no deep
mastery; a topic's quick quizzes keep landing at 60–80% (knows the moves, not the reasons); or
an exam is ≤ 3 weeks away. Deep review success counts as a spaced check for every objective it
touches, stretched: a check passed in a deep review sets the next one 1.5× further out than
FSRS's Good interval, capped at 60 days (`MASTERY_RULES.deepReviewStretch`, decided 2026-10-05;
replaces "double weight"). The student picks the length at the start (30 minutes suggested).

**Exam review.** Scope = objectives marked `tested` (professor notes) ∪ topics in the exam's
range. Retired objectives are re-activated inside the scope. Ramps retrieval → mixed → transfer
across the days before the exam, as the PRD's exam planner describes.

**To-do list.** Derived every time the app opens, never stored: today's quick review, any Review
items, any Deep review nudges, the next exam block. Completing items writes evidence; nothing
else is persisted.

## 4. Question supply
- **Per-objective generation** replaces per-topic: the extraction prompt asks for objectives first,
  then 6 quick questions per objective (2 exact short answer, 2 mechanism short answer, 2 MC) and
  2 deep questions. Built-in ALD content is re-tagged to objectives.
- **Drill generators** (code, no model) for the procedural ALD objectives: decimal ↔ n-bit
  2's complement, negate, add/subtract with overflow decision, sign-extend, Qi.f ↔ value,
  minterm list ↔ canonical SoP, DeMorgan a random 3-variable expression, Booth recode a random
  8-bit multiplier, half/full-adder outputs, ripple delay for n bits. Each produces a fresh
  instance and its exact answer; Boolean answers are checked by truth table, so any equivalent
  form passes.
- **Top-up rule**: when an objective has fewer than 3 unseen quick questions and no drill, enqueue
  generation. Runs in the background after a session, never while the student waits.

## 5. The connector (no API cost)
Orca exposes a small MCP server at `/api/mcp` with a per-student token. Students add it once to
Claude.ai (Settings → Connectors, Pro and up) or ChatGPT (Apps & Connectors, developer mode).
Tools:
- `log_study(topicOrObjective, note, confusion: boolean)` — the model calls this when the student
  works on course material; records a connector signal (raises priority, never counts toward mastery).
- `get_due()` — what Orca has queued, so the student's own Claude or ChatGPT can say "Orca wants you to do 5 minutes on
  overflow today".
- `get_material(objectiveId)` — slide crops and anchors, so their assistant teaches from the course
  material rather than from memory.
Tool descriptions instruct the model to log once per concept discussed. What arrives is a signal
about *exposure and confusion*, which is exactly the evidence class it belongs in.

## 6. Build order (superseded by `docs/BACKEND-ROADMAP.md`)
1. Objective ids on questions; ALD content tagged; extraction asks for objectives first. (1 day)
2. `src/lib/mastery.ts`: evidence log in the store, `computeObjectiveState`, `nextDue`,
   `priority`, all pure and unit-tested with `node --test`. Sidebar "Due" becomes derived. (1 day)
3. Session composer for quick review; question picking without repeats; tier mix. (1 day)
4. Poor-quiz loop: per-objective generation, Review items with slide crops, next-day re-quiz. (1 day)
5. Deep review screen and nudges. (1–2 days)
6. Drill generators for the procedural ALD objectives. (1 day)
7. MCP connector endpoint and setup instructions in Settings. (1 day)

Supabase lands after 3: by then the evidence log and derived state are the whole data model, and
moving it server-side is a persistence swap, not a redesign.

## 7. Open questions (moved to `docs/TO-DISCUSS.md`)
- Is "3 correct on 2 days" the right bar, or should core objectives need 4 and minor ones 2?
- Should a student be able to mark an objective "I know this" to skip ahead? (Proposal: yes, but
  it schedules one check tomorrow rather than granting mastery.)
- How visible should the objective list be: a full checklist per topic, or only in the explanation
  of why something is due?
