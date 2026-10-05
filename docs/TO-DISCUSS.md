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

## Mastery

### Island mastery levels: names and thresholds
- **Decided:** each island shows one of four fixed visuals for its course's mastery level.
- **Provisional (Phase 1):** a level is set by the share of a course's objectives that are mastered
  or retired. `uncharted` means no scored answers yet; `sprouting` is under 1/3; `growing` is 1/3 or
  more; `thriving` is 2/3 or more. Fading objectives don't count as mastered, so an island can drop
  a level when checks go overdue.
- **Decide:** the names, the cut-offs, whether an overdue (fading) island gets its own visual, and
  the final art. Phase 1 builds the levels from the existing island SVG parts; the Figma art can
  replace them later without any code change outside `Island.tsx`.

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

### Demo content
- Phase 1 removes the generic fallback quiz (the study-habit questions shown for topics with no
  bank) and the four placeholder topics a new course used to get, because answers to them would
  count as evidence about a course they don't test. Seed courses other than ALD therefore show
  empty trails until material is added.
- **Decide:** whether the demo should ship authored content for a second course.
