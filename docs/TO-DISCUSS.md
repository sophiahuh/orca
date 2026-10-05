# To discuss

Open product questions that were deliberately left undecided. Each entry says where it came from,
what is built in the meantime, and what would change. Delete an entry once it's decided, and record
the outcome in the doc it affects.

## Scheduling

### Extra priority for the topic the class is on now
- **Source:** `docs/MASTERY-PLAN.md` §2.6, the `0.5 × frontier` term.
- **Concern (Amanda):** not convinced current-topic material should outrank older material just
  because it's current. A weak older objective may matter more than a new one.
- **Meanwhile:** the term is left out. Phase 2 builds the priority function without it, so adding it
  later means adding one term, not restructuring.
- **Decide:** keep it, drop it, or replace it (e.g. weight by upcoming-exam scope instead).

### The "distance discount" for material more than 3 topics behind
- **Source:** `docs/MASTERY-PLAN.md` §2.5. It goes with the frontier term, since both assume the
  current topic is the centre of gravity.
- **Meanwhile:** left out, same as the frontier term. Retirement already does most of the
  "don't re-quiz the intro" work.
- **Decide:** together with the frontier term.

### What the material-type weight sliders do
- **Now:** Settings has per-course sliders (homework, practice exams, practice problems,
  lectures). Nothing reads them, and the priority formula in `docs/MASTERY-PLAN.md` §2.6 has no
  term for them.
- **Options:** scale an objective's `importance` by the weight of the material types it was
  extracted from (the platform notes' suggestion); or use them only to weight question
  generation (more practice-exam-style questions); or remove them.
- **Decide before:** Phase 2 (priority).

## Mastery

### Do inferred objectives count toward the island?
- **Now (as decided):** every non-archived objective counts, including inferred ones (from
  general knowledge, not the material).
- **Risk:** an inferred objective the course never actually covers still sits in the
  denominator, so the island can't reach "thriving" and the topic can't be "done" until the
  student masters something the class didn't teach.
- **Options:** count them; count them only once confirmed by the student; or never count them.
- **Decide before:** Phase 4.

### Island mastery levels: names and thresholds
- **Decided:** each island shows one of four fixed visuals for its course's mastery level.
- **Provisional (Phase 1):** a level is set by the share of a course's objectives that are mastered
  or retired. `uncharted` means no scored answers yet; `sprouting` is under 1/3; `growing` is 1/3 or
  more; `thriving` is 2/3 or more. Fading objectives don't count as mastered, so an island can drop
  a level when checks go overdue.
- **Decide:** the names, the cut-offs, whether an overdue (fading) island gets its own visual, and
  the final art. Phase 1 builds the levels from the existing island SVG parts; the Figma art can
  replace them later without any code change outside `Island.tsx`.

### Detecting a mix-up without asking for confidence
- **Decided 2026-10-04:** two unaided misses in a row on different questions marks an objective
  mixed-up. The quiz doesn't ask how sure the student was.
- **Watch for:** beginners being flagged often, since honest misses count the same as confident
  ones. If that shows up, add a "Sure / Guessing" tap and count only confident misses (the
  platform's rule).

### Clearing a mix-up when an objective has no "mechanism" question
- **Source:** `docs/MASTERY-PLAN.md` §2.4 says only an unaided correct answer on a *mechanism*
  question clears a mix-up.
- **Meanwhile:** if an objective has no mechanism-tier question, any unaided correct answer clears it,
  so the student can't get stuck permanently.
- **Decide:** keep that rule, or require generation of a mechanism question first.

### The open questions already listed in MASTERY-PLAN §7
- Is "3 correct on 2 days" the right bar for every objective?
- Should a student be able to mark "I know this"? (The proposal there: it schedules one check
  tomorrow, never mastery directly.)
- How visible should the objective list be?

## Backend

### Existing local data at first sign-in
- When accounts arrive (Phase 3), a student may already have answers in localStorage.
- **Options:** import them into the new account once; or start fresh. Importing is cheap because
  evidence events are self-contained, but imported timestamps can't be verified.
- **Decide before:** Phase 3.

### How relationships between objectives are stored
- Phase 5 adds connection questions whose answers count toward a *pair* of objectives, plus
  `implies` links. Neither has a data shape yet (a relationship table, typed like the platform's
  concept edges, is the obvious start).
- **Decide in:** Phase 5's brainstorming.

## Product

### Streak
- **Now:** a seeded number that increases after the first quiz.
- **Proposal:** count days with at least one scored, unaided answer, so the streak rewards practice
  rather than opening the app.

### Bring-your-own model
- **Now:** Settings → Your AI keeps a student's key in the browser. With the in-app chat gone, the
  key is used only for extracting material and grading short answers.
- **Decide:** keep it as an option, or move everything to Orca's server key once the backend
  exists. Most students won't have a key, so the server key has to work without one either way.

### Question supply for the built-in ALD content
- **Decided 2026-10-04:** leave it until generation. Mastery needs 3 different questions per
  objective, and only 7 of the 40 ALD objectives have that many, so most ALD topics can't be
  finished in the demo until Phase 4 (generation) or Phase 6 (drills) adds questions.
- **Revisit:** if the demo needs a finished topic before then, write more questions for the
  thin objectives rather than weakening the rule.

### Demo content
- **Decided 2026-10-04:** only ALD ships seeded. Phase 1 deletes the four seed courses that had no
  real content (Circuits, Signals, Linear Algebra, Statistics), along with the generic fallback quiz
  and the four placeholder topics a new course used to get, since answers to those would count as
  evidence about material they don't test.
- **Open:** whether to author a second real course later.
