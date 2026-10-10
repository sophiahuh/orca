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

### Before Phase 4's live checks (Task 10)
- **Credentials the session needs** to run the live checks the invariants require: the owner's
  Supabase project (URL, publishable and secret keys, a personal access token to push migrations), a
  Trigger.dev project (secret key, project ref), `ANTHROPIC_API_KEY`, `SITE_URL` and
  `ORCA_DAILY_BUDGET_USD`, set in the cloud environment (`docs/SETUP-HOSTED.md`). Everything in Tasks
  1–9 ran against the local stack only; the hosted claims are unmade until then.
- **Trigger.dev or inline?** The jobs are written for Trigger.dev and run inline locally. The owner
  may deploy with `ORCA_JOBS=inline` first (fine for short decks; a 300 s route limit) and switch to
  Trigger.dev when the project exists; waiting runs then resume only when the student next starts
  or finishes a job (the hourly sweep is a Trigger.dev schedule).

### Answers to questions not sorted into an objective
- **Assumed in Phase 4 Task 3 (2026-10-05):** `POST /api/evidence` refuses (422) an answer to a
  question with no objective, because every evidence row names a real objective (Task 2's schema).
  In the browser such questions sit in a topic's "not yet sorted" bucket and their answers count
  there. Today's pipeline always assigns an objective, so nothing should hit this; hand-written or
  legacy questions would.
- **Decide:** keep refusing (and stop showing unsorted questions in quizzes in Task 5), or give
  each topic a real "unsorted" objective row that evidence can name.

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
- **Decided (owner, 2026-10-06):** no model checks at all. Questions go into the stock as written,
  with only the code validators. Risk to watch: a wrong answer key marks right answers wrong and
  pulls that objective's mastery down; if students report it, bring back a check (or a "this
  question is wrong" button that drops the question and the evidence it recorded).
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

### Assumed while finishing Phase 4 (2026-10-06): decide or accept
Judgement calls the agents made to keep building; each is in code behind one constant or branch.
- **Daily token budget: 2,000,000 tokens per student** (`LIMITS.tokensPerDay`; about $8 of Opus 5.5
  input, less with caching; one 40-slide deck runs 200–400k tokens). The plan named a budget without
  a number.
- **The 300-page daily budget counts uploads only.** A top-up sends excerpts of stored pages, not
  files, so its pages aren't counted; its cost is bounded by the token budget. Deviation from
  "uploads and top-ups together".
- **Budgets are checked once per job, when it claims its run**, so a job that starts under a limit may
  overshoot by one job (bounded by the page cap and per-step `max_tokens`); the pipeline isn't
  resumable mid-way.
- **`ORCA_DAILY_BUDGET_USD` unset means no service-wide ceiling.** Right for development only;
  production must set it (`docs/SETUP-HOSTED.md`).
- **Repeat offenders:** 3 prose answers in 7 days flagged by a *strong* screen check (ignore the
  rubric, mark this correct, a role tag, an encoded payload…) turn model grading off for a student
  (`REPEAT_OFFENDER` in `src/lib/server/grade.ts`; one `security_events` row per flagged answer);
  the owner clears it by deleting their `student_answer` rows. No notification is sent: the
  message says the owner can review, and the query is in `docs/SETUP-HOSTED.md` (section 7).
- **The pattern screen's weak phrases** ("output only", "you are a", "act as", "new instructions",
  "to the model", "as an AI"…) are ordinary prose in a logic course, so they are logged as `weak`
  and never refuse generated text, warn on the review screen or count against a student. If real
  uploads show injections built only from weak phrases, promote them or add the Haiku pre-screen.
- **In inline mode a run waiting for a daily limit resumes when the student next starts or finishes
  a job** (there is no clock); its message still says "processing resumes tomorrow". Trigger mode
  sweeps hourly. If inline stays in production, a cron route would make the message exact.
- **Top-ups are rate-limited to 30 an hour** (`LIMITS.rate.topUp`): each call is a run row and a job.
  A finished session id still works for any number of top-ups within that (W0's open point).
- **A quiz with ungraded answers (a grading outage) records a smaller total**, and a quiz with nothing
  graded records no session (so no re-quiz is queued for it).

### Assumed in the Figma sync (2026-10-06)
- **The Concept Atlas is screen 12 (the rings), not the "Concept graph v4" explorations** (E1/E2,
  React Flow + ELK, red/amber/green hues). The rings need no new dependency and stay in the
  palette; the spec's interaction model is followed where it fits (select → panel, dim to 30%, Esc
  clears, one action per panel). Units are topics in trail order; concepts are live objectives;
  links are relations (`builds-on` → Prerequisite, the rest → Related).
- **Concept mastery words:** mastered → Mastered; learning → Building; fading, mixed up or retired →
  Review; unseen → Not started. **The percent** ("60% mastered") is a display number: progress toward
  the credit bar before mastery (capped at 80), FSRS's predicted recall after it.
- **The formula chip and the truth-table row note** in the quiz feedback mockup need content the
  questions don't carry (a formula, which row is wrong); not drawn until the pipeline writes them.
- **The nav bar's fourth icon (chat)** isn't built: AI chat is marked removed from the MVP in Figma.
  Settings is reachable twice (top bar and nav bar), as both are in the mockups.
- **Name is optional at sign-up** (the mockup shows the field; nothing in the app needs it yet).
- **Dark mode:** the Orca Ocean Dark values are in `globals.css` under `[data-theme="dark"]` with no
  toggle; the screens' own surfaces (parchment, alice) have no dark variables in Figma yet.
- **Figma vectors were hand-traced**, not exported: this environment can't fetch figma.com. The
  Orca Waves arcs, the two header icons, the five avatars and the sea-life decorations (left out)
  should be replaced by Figma's SVG exports (`docs/figma/README.md`).
- **Upload cleanup ages:** `uploaded`/`reading` after 24 h, `failed` after 7 days
  (`CLEANUP` in `src/lib/material/cleanup.ts`). `ready` and `processing` material is never touched.
- **Metering failures throw:** a call whose usage can't be written fails the step after the model was
  paid, rather than leaving a quiet hole in the budget. One exception: a server-side fallback that
  answers with a model `src/lib/pricing.ts` doesn't price is recorded at the requested model's price
  with the model column saying so ("claude-x (priced as claude-opus-5-5)").
- **A snapshot folded by a newer Orca refuses writes (503)** during a rolling deploy rather than
  being extended with older rules; reads compute from the log without saving.
- **Same-millisecond events fold in id order without a `RULES_VERSION` bump**: the fold's logic is
  unchanged and nothing is deployed, so no stored snapshot can disagree.
- **Anchors that don't name slides are kept unchecked** ("problem 3" in homework); only slide and
  page locators must exist in the material.
- **The pattern screen flags legitimate discussion** of injection (a security course's "a system
  prompt is…" is a strong hit). A hit only warns; nothing is removed from the material.
- **The grader refuses exact-answer questions (400)** rather than grading them: code checks what
  code can check, and a model couldn't be talked into a "correct" on one. It never changes the
  model's outcome, only drops ideas and misconceptions the rubric doesn't list.
- **Every prompt's format changed** (data blocks): `npm run score:extraction` with a key is the
  check that recall and precision didn't move. Not run yet (no key).
- **`SITE_URL` must be https in production** unless it's a local address; development may still
  build links from the request's host.
- **Hosted email templates** should switch to token-hash links (Task 10 steps in `docs/SETUP-HOSTED.md`)
  so confirm and reset links open on any device; the default PKCE links keep working.
- **The proxy's `getClaims` is accepted**: a revoked session sees an empty shell for at most the
  token's hour; every data path verifies with Supabase Auth.
- **Prices** in `src/lib/pricing.ts` were copied from Anthropic's pricing page on 2026-10-06 (no
  `claude-api` skill existed in the session); change them there when they change.

### Server model on OpenAI (2026-10-06): decide or accept
- **What changed:** the server can run on OpenAI instead of Anthropic (`src/lib/model-config.ts`).
  `ORCA_MODEL_PROVIDER` picks the provider; unset, `OPENAI_API_KEY` wins over `ANTHROPIC_API_KEY`
  (Amanda's ask). This widens the 2026-10-05 decision "Orca's server key only" to either provider's key.
- **Changed (owner, 2026-10-06, later):** the default is now `gpt-6.1-sol`: luna left out obvious
  topic links and quality matters more than cost while the pipeline is tried out. `ORCA_MODEL=gpt-6-luna`
  still runs the cheap one. What follows was the first decision.
- **Decided for now (Amanda, 2026-10-06):** OpenAI's default model is `gpt-6-luna`, the cheap one
  ($0.10 in / $0.50 out per million, 20× under `gpt-6.1-sol`), while the pipeline is tried out.
  Watch whether it extracts and writes questions well enough: the blind solve and agreement checks
  run on the same small model, so they may wave through wrong answers. Compare against
  `ORCA_MODEL=gpt-6.1-sol` with `npm run score:extraction` before real students. Priced: `gpt-6-astra`, `gpt-6.1-sol`,
  `gpt-6-luna` (Standard tier, read from developers.openai.com on 2026-10-06).
- **Known gaps on OpenAI:** the prompts were written for Claude and are untested on either; a reply
  cut off by the 10-minute timeout isn't metered (OpenAI calls aren't streamed, so no token counts
  arrive); the browser tests only cover Anthropic (the fake API speaks the Messages API), the
  OpenAI path is unit-tested against a fake `fetch`.

### Assumed in the 2026-10-06 UI and backend changes: decide or accept
- **Homework reflection on the upload page** applies only the objectives the model is *sure* of
  (the old confirm step is gone); a failed match still saves the note and says why.
- **Dive questions are reused:** a dive first asks the dive questions written earlier for its objectives
  and never answered (in its usual order), and only writes the shortfall; with enough in stock it
  makes no model call.
- **Dive in, one topic:** covers every live objective of the topic, including ones never answered
  (a course-wide dive covers only answered ones). A dive writes one question per 4 minutes, at most
  20 (so at most 80 minutes) and 4 per objective (`src/lib/deep-review.ts`). Dives have no per-hour limit (owner, 2026-10-06; the daily budgets still apply); "Find connections" is limited to 10 an hour.
- **A topic's play button** now opens the topic dive. The old topic quiz (`/quiz/[slug]/[topic]`,
  the topic's quick-review questions) still exists but nothing on the course page links to it.
- **Topic links from the link step** use the model's knowledge of the subject, not only the slides,
  and carry no slide anchor. Links between two topics that both already existed are only proposed
  by "Find connections", not by later uploads.
- **Exams:** `exams.topic_ids` aren't foreign keys (topics merge and get archived; the app ignores
  ids that aren't live). An uploaded past or practice exam with a due date still makes an "exam"
  calendar entry, not an exams row; both count as exam days for the cadences. The "Exam review"
  setting is stored but no session uses it yet.
- **Course settings:** a course created before overrides existed kept its own copy of the
  defaults; the migration made copies that still matched the defaults inherit again.
- **Atlas strength:** "New" (nothing answered), "Developing", "Strong" (every objective mastered),
  "Fragile" (something fading or mixed up). Confirming a topic doesn't change it.

### Visuals and graphics in material aren't read (2026-10-10)

Orca reads only the text of uploaded material: a PDF page's text (pdf.js) and a .pptx slide's text,
tables and speaker notes (`src/lib/material/read-pptx.ts`, no model). Pictures, diagrams, graphs,
plots, charts and SmartArt are never sent to the model, so what a slide shows only as a picture
(a circuit, a tree, a plotted curve, a chart's numbers) is missing from extraction and from the
questions. For PDFs, a question can still point at a slide ("In the figure, …") and show it as an
image, but the writer picks the slide from its text without seeing the figure. For .pptx decks, slides
can't be rendered at all, so those figure questions are dropped ("couldn't be rendered").
This is a real gap for courses that teach through graphs or visualisations. Options: send images of
figure-heavy pages to the model during extraction and writing (costs more per upload); render .pptx
slides by converting to PDF on a worker with LibreOffice (a Trigger.dev task; layout isn't always
faithful); or ask students to upload decks as PDFs (File → Save as PDF) when the visuals matter.

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
- **Decided for Phase 4 (2026-10-05):** the model processes at most 300 pages a day per student;
  past that, a file is stored and read but waits until the next day with "Daily limit reached:
  processing resumes tomorrow". Built 2026-10-06 counting uploads' pages only, with a 2,000,000-token
  budget alongside (see "Assumed while finishing Phase 4").
- **Revisit:** once real costs per page are measured (Task 10's live upload), and if students hit
  it in normal use (a textbook upload would). Options: a higher limit, a per-course one, or
  limits by plan.

### Injection pre-screen with a small model (deferred)
- **Decided for Phase 4 (2026-10-05):** no model pre-screen. Untrusted text is sanitised,
  pattern-screened, JSON-encoded, and outputs are validated in code (plan decision 13).
- **Revisit when:** the red-team set or real uploads show injections getting past the pattern
  screen and validators, or courses become shared. Then add a Claude Haiku 4.5 classifier
  (structured `{ injectionSuspected, quotes }`) before extraction, as Anthropic's "Mitigate
  jailbreaks and prompt injections" guide recommends; about a quarter of an upload's input cost.

### The browser reports choice and exact outcomes
- **Decided for Phase 4 (2026-10-05):** choice and exact answers are graded in the browser and
  `/api/evidence` takes the outcome it sends; only prose grading loads its rubric on the server.
  An edited request can inflate only the student's own record.
- **Revisit when:** courses are shared, mastery feeds anything outside the student's own study
  (grades, leaderboards), or the MCP connector writes answers. Then `/api/evidence` takes the
  response and checks choice and exact answers on the server (a string compare, no model call).

### Sign-up CAPTCHA (deferred)
- **Decided for Phase 4 (2026-10-05):** no CAPTCHA; email confirmation and the global daily model
  budget guard against mass sign-ups.
- **Revisit:** before opening sign-up publicly. Supabase Auth supports Turnstile and hCaptcha.

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
  gets practiced first), never what counts as mastered.

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
