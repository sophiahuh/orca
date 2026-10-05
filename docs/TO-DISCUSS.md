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

### Island looks: cut-offs and art
- **What an island shows:** one summary of a whole course, computed from its objectives'
  mastery states: the share of objectives currently held (mastered, due or retired). The level
  names (`uncharted`, `sprouting`, `growing`, `thriving`) are only code identifiers for the four
  pictures; students never see them.
- **Provisional (Phase 1):** no answers yet → look 1; under 1/3 held → look 2; 1/3 or more →
  look 3; 2/3 or more → look 4. Fading objectives don't count, so an island loses a look after
  real neglect.
- **Decide:** (1) cut-offs: how many looks, and the share that triggers each; (2) art: the final
  drawings for each look (Phase 1 uses placeholder trees built from the current island SVG;
  Figma art replaces them later with changes only in `Island.tsx`); (3) whether a neglected
  island (many fading objectives) gets a look of its own.

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
- **Open:** the diminishing-returns curve for coverage and the size of the builds-on factor. Set
  in the Phase 2 plan with tests, then checked against the ALD decks.

### Existing local data at first sign-in
- When accounts arrive (Phase 4), a browser may already hold courses and answers in localStorage
  from testing.
- **Options:** import them into the new account once, or start fresh. Importing is cheap (evidence
  events are self-contained) but imported timestamps can't be verified.
- **Recommendation:** start fresh. The local data is test data, and an importer is code to
  maintain for a one-off.
- **Decide before:** Phase 4.

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

## Watch

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
- 2026-10-04: due vs fading split (half-interval grace before a review stops counting).
- 2026-10-04: streak = consecutive local days with an unaided graded answer.
- 2026-10-04: ALD stays as a labelled sample course; all other seed data is removed; uploads
  (Phase 2) come before Supabase so extraction can be tested on real files.
- 2026-10-04: most ALD objectives can't be mastered until question generation adds supply; write
  more ALD questions rather than weakening the rule if a demo needs it sooner.
