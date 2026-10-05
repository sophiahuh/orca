# To discuss

Open product questions that were deliberately left undecided. Each entry says where it came from,
what is built in the meantime, and what would change. Once an entry is decided, record the outcome
in the doc it affects (usually `docs/BACKEND-ROADMAP.md`) and move it to "Decided" at the bottom.

## Open

### Extra priority for the topic the class is on now
- **Source:** `docs/MASTERY-PLAN.md` §2.6, the `0.5 × frontier` term.
- **Concern (Amanda):** not convinced current-topic material should outrank older material just
  because it's current. A weak older objective may matter more than a new one.
- **Meanwhile:** left out. The scheduling phase builds priority without it, so adding it later
  means adding one term, not restructuring.
- **Decide:** keep it, drop it, or replace it (e.g. weight by upcoming-exam scope instead).

### The "distance discount" for material more than 3 topics behind
- **Source:** `docs/MASTERY-PLAN.md` §2.5. It goes with the frontier term, since both assume the
  current topic is the centre of gravity.
- **Meanwhile:** left out. Retirement already does most of the "don't re-quiz the intro" work.
- **Decide:** together with the frontier term.

### Island looks: art
- **What an island shows:** one summary of a whole course, computed from its objectives'
  mastery states: the share of objectives currently held (mastered or retired). The level
  names (`uncharted`, `sprouting`, `growing`, `thriving`) are only code identifiers for the four
  pictures; students never see them.
- **Provisional (Phase 1):** no answers yet → look 1; under 1/3 held → look 2; 1/3 or more →
  look 3; 2/3 or more → look 4. Fading objectives don't count, so an island loses a look after
  real neglect.
- **Cut-offs decided** (see Decided).
- **Decide:** (1) art: the final drawings for each look (Phase 1 uses placeholder trees built
  from the current island SVG; Figma art replaces them later with changes only in
  `Island.tsx`); (2) whether a neglected island (many fading objectives) gets a look of its own.

### Clearing a mix-up when an objective has no "mechanism" question
- **Source:** `docs/MASTERY-PLAN.md` §2.4: only an unaided correct answer on a *mechanism* question
  clears a mix-up.
- **Meanwhile:** if an objective has no mechanism-tier question, any unaided correct answer clears
  it, so the student can't get stuck permanently.
- **Decide:** keep that, or require generating a mechanism question first.

### Mastery bar and "I know this"
- Is "3 correct on 2 days" the right bar? (The same bar applies to every objective whatever its
  weight; see Decided.)
- Should a student be able to mark "I know this"? (Proposal: it schedules one check tomorrow,
  never mastery directly.)

### Weight formula constants
- **Decided shape** (roadmap, "Weight signals and formula"): code computes weights from signals
  Claude records; clamp 0.5–2.
- **Set provisionally (Phase 2):** coverage factor 0.75 + 0.75 × (1 − e^(−s/1.5)), builds-on
  +0.1 per dependant up to 5, "skipped" = 0 (`WEIGHT_RULES` in `src/lib/course/weights.ts`).
- **Open:** tune against the ALD decks once `npm run score:extraction` has a key and a baseline.
  The Settings sliders default to equal (25 each, decided 2026-10-05), so by default every
  material type's coverage counts the same; the student's sliders are what make one type count more.

### Before Phase 4 (Supabase + Trigger.dev)
- **Credentials a Phase 4 session needs** to run the live checks the invariants require: a
  Supabase project (URL, anon and service-role keys), a Trigger.dev project (secret key), and
  `ANTHROPIC_API_KEY`. Without them the work can only be typechecked, which isn't the same claim.

### Relation mastery details
- **Decided shape:** a relations table (from objective, to objective, type: builds on | implies |
  contrasts with | applies to, anchors, status), filled during uploads from Phase 2.
- **Open (Phase 5):** how a connection question's answer becomes evidence on a relation, what
  "weak" and "strong" mean for a relation, and how much an `implies` link counts as a review.

### Bring-your-own model
- **Now:** Settings → Your AI keeps a student's key in the browser. With the in-app chat gone, the
  key is used for extraction, question generation and short-answer grading.
- **Decide:** keep it as an option, or move everything to Orca's server key once accounts exist.
  Most students won't have a key, so the server key has to work without one either way.

### A second real course
- Whether to author another course's content, like ALD, for demos and evaluation.

### Question checks: batched or one at a time
- **Phase 2:** the blind solve, ambiguity and rubric-agreement checks each run as one call per
  batch of up to 30 questions. The platform ran one call per question.
- **Decide:** keep batching (fewer calls, faster uploads) unless the evaluation shows batched
  checks letting bad questions through.

### Phase 3 scheduling numbers (provisional)
- **Set (Phase 3):** priority coefficients are 1 for overdue, weight, gap and open confusion and
  2 for a mix-up (MASTERY-PLAN §2.6); a poor session is ≥ 3 answers under 60% correct, or two
  misses on one objective (`AGENDA_RULES`); top-up when an objective has < 3 unseen questions,
  back to 6, writing from only the pages the objective is anchored to plus one either side (its
  topic's range when it has no anchors; the whole file only up to 60 pages) (`TOP_UP_RULES`); question time 30 s choice, 45 s exact answer, 90 s one sentence.
- **Quick-review cadence** is read as: `Daily` = due until one is finished today; `Weekly` =
  due until one is finished in the last 7 days; `1 wk before exam` = daily within 7 days of an
  exam on the calendar. Extra practice is always available from the course page.
- **Decide:** whether these feel right in use. (Deep review length is now picked by the student at
  the start of each deep review; see Decided. The Settings value is only the starting suggestion,
  30 minutes by default, decided 2026-10-05.)

## Watch

### Loading all of a student's data at sign-in (revisit)
- **Decided for Phase 4 (2026-10-05):** the browser loads everything a student has (courses,
  structure, materials, finished sessions, every evidence event, snapshots) once at sign-in, so
  screens keep reading the same in-memory state.
- **Revisit when:** a student's evidence log reaches tens of thousands of events, sign-in gets
  slow, or the MCP connector (Phase 7) needs state without a browser. Then load per course and
  only the events derived reads need (the last N days for streak, poor sessions and last seen),
  with objective state from snapshots alone.

### Daily processing limit: 300 pages per student (revisit)
- **Decided for Phase 4 (2026-10-05):** the model processes at most 300 pages a day per student,
  uploads and top-ups together; past that, a file is stored and read but waits until the next
  day with "Daily limit reached, processing resumes tomorrow".
- **Revisit:** once real costs per page are measured (Task 10's live upload), and if students hit
  it in normal use (a textbook upload would). Options: a higher limit, a per-course one, or
  limits by plan.

### Mix-ups without a confidence rating
- **Decided:** two unaided misses in a row on different questions marks an objective mixed-up.
  The quiz doesn't ask how sure the student was.
- **Watch for:** beginners being flagged often. If that shows up, add a "Sure / Guessing" tap and
  count only confident misses (the platform's rule).

### Unreviewed objectives count everywhere
- **Decided:** `proposed` objectives are quizzable, due and counted for the island, with an
  "unreviewed" tag.
- **Watch for:** a bad extraction filling due lists and dragging islands down before the student
  reviews it.

## Decided (recorded in the roadmap)

- 2026-10-04: quick review defaults to 10 minutes per course (adds a "10 min" option).
- 2026-10-04: the mastery bar is the same for every objective; weights change priority (what
  gets practised first), never what counts as mastered.

- 2026-10-04: material-type sliders feed objective weights and set deep review's question mix.
- 2026-10-04: inferred objectives count toward the island; the per-course objective list (origin,
  status, weight, mastery, reject/merge) is where students reject ones the course doesn't cover.
- 2026-10-04: day boundaries use the student's local timezone, on device and server.
- 2026-10-04: a homework reflection saying "I don't understand X" resets X to learning.
- 2026-10-04: a mastered objective whose spaced check comes due is `fading` and stops counting as
  mastered (no grace period).
- 2026-10-04: spacing uses FSRS via `ts-fsrs` (from the first answer, 90% target recall,
  intervals capped at 60 days), replacing the hand-written ×2.2 / ÷3 rule.
- 2026-10-05: a missed review check is due again at once, for the course's next review session;
  a retry in the same session (each quiz visit is a session) doesn't pass it.
- 2026-10-05: mastery needs at least 2 of its 3 credit from graded answers (self-marks can't carry it).
- 2026-10-05: the trail's START goes to the first in-progress topic (else the first not-started),
  in-progress topics use full-colour labels, and each topic says how many of its objectives need
  more questions before they can be mastered.
- 2026-10-05: only a genuine pass (unaided correct at or after the due time) clears a review
  check; any miss after mastery, self-marked included, fades the objective and un-retires a
  retired one. A partial answer on a retired objective doesn't un-retire it.
- 2026-10-04: island cut-offs: no answers → look 1; under ⅓ held → 2; ⅓ or more → 3; ⅔ or more → 4.
- 2026-10-04: streak = consecutive local days with an unaided graded answer.
- 2026-10-04: all fabricated seed data is removed; uploads (Phase 2) come before Supabase so
  extraction can be tested on real files.
- 2026-10-05: question and objective ids are random UUIDs, never derived from content or position;
  nothing is deleted (archive or merge), and rejected objectives are kept so later uploads don't
  re-propose them. Duplicates are caught by a normalised prompt, separately from ids.
- 2026-10-05: deep review asks how many minutes the student wants at its start (presets 10–60 or any
  1–600; the course's Settings length is the starting suggestion) and shows what that covers:
  questions, minutes, how many objectives get a question and, when some don't fit, how long
  covers them all. Assembly covers every objective once, highest priority first, before going
  deeper on any. The end card offers "Start another deep review".
- 2026-10-05: Phase 4's server pipeline uses Orca's server key only. Students' own keys (stored
  encrypted, cloud providers only) can come later; whether to keep Settings → Your AI at all is
  still open ("Bring-your-own model").
- 2026-10-05: sign-in for Phase 4 is email + password through Supabase Auth (it hashes passwords,
  confirms emails and resets passwords; Orca stores no password itself). Google sign-in comes
  later as a second provider on the same accounts. Password emails need a custom SMTP provider
  before real students use it (Supabase's built-in sender is for testing only).
- 2026-10-05: local test data is not imported at first sign-in; accounts start fresh.
- 2026-10-05: no guest or offline mode: every page needs sign-in, and without a database
  connection the app says so instead of saving in the browser.
- 2026-10-05: deep review's suggested length is 30 minutes (was 3 hours).
- 2026-10-05: a spaced check passed in a deep review sets the next check 1.5× further out than
  FSRS's Good interval, capped at 60 days; FSRS's memory estimate stays a Good, so later
  intervals and retirement aren't inflated (`MASTERY_RULES.deepReviewStretch`). Replaces "double
  weight". For reference: Anki's SM-2 easy bonus is 1.3×; FSRS's Easy rating gives about
  1.6–1.7× Good after the first review. Because checks reach the 60-day cap by about the second
  pass, the stretch mostly lengthens the first check after mastery (about 32 → 48 days).
- 2026-10-05: the built-in ALD sample course is removed too; the app ships no courses. ALD is
  reached by uploading `docs/samples/ald/`. The e2e suite seeds its own fixture course.
