# Weak points first — design

Status: design agreed with the owner in brainstorming, 2026-11-04; revised the same day after an
audit against the code (every open point below was decided by the owner). **Plan A built
2026-11-05** (`docs/superpowers/plans/2026-11-04-weak-points-plan-a.md`, whose status block lists
what moved out); Plans B and C, with the follow-up that lets objectives without questions hold state, **built 2026-11-06** (`docs/superpowers/plans/2026-11-05-weak-points-plans-b-c.md`; its decisions are listed there and in `docs/TO-DISCUSS.md`). Where this spec and the code differ, the plan's status
block says which wins.

## Why

Students found Orca overwhelming. Every objective of every upload came due, and studying meant
working through all of them, on top of their usual coursework. Orca now practises only what
the student struggles with. An objective nobody has flagged is left alone. Struggles are found
mostly from work the student already does: stars in their notes, questions they ask Claude while
studying, homework reflections.

Ruled out:
- **Random checks of unflagged objectives.** There are too many objectives for an occasional
  sample to cover enough to matter.
- **A placement quiz after upload.** It's extra work outside the student's normal routine.

## Decisions

1. Unflagged objectives are never due. When nothing is due, the quick review shows "You're
   caught up" and an optional **Practice other topics**.
2. Flags come in two strengths:
   - **struggled**: back to learning, the full mastery bar, then spaced checks.
   - **check me**: one question. A pass clears it; a miss puts the objective in rotation.
3. Islands and topic rings measure **weak points mastered**: objectives in rotation that are now
   mastered or retired, out of all objectives in rotation. An island with nothing in rotation
   shows its uncharted look, labelled "No weak spots flagged yet".
4. Questions are written only for flagged objectives, plus whatever Practice other topics and
   dives ask for when they start.
5. In optional practice, a miss puts the objective in rotation. A pass is recorded but never
   adds future work.
6. Learner state stays derived from the evidence log (CLAUDE.md invariant). Flags are
   evidence events, not a stored status.

## 1. Learner model

### Statuses

`ObjectiveStatus` (`src/lib/mastery/types.ts`) gains two values. `unseen` keeps its identifier
(renaming it would touch 18 files and the connector's output, and would collide with the Atlas's
topic strength `unverified`, which means something else); only what the student sees changes.

| Status | Meaning | Due? | Student sees |
|---|---|---|---|
| `unseen` | not in rotation, no answers, no open check | never | "Not flagged" |
| `verified` (new) | not in rotation, answered, no open check | never | "Verified ✓" |
| `check-due` (new) | not in rotation, an open *check me* flag | yes, one question | "Check" |
| `learning` | in rotation, below the mastery bar | yes | as today |
| `mixed-up` | in rotation, mixed up with another (as today) | yes | as today |
| `mastered` | in rotation, met the bar, next check not due | no | as today |
| `fading` | in rotation, its spaced check is due | yes | as today |
| `retired` | in rotation, retired (as today) | no | as today |

**In rotation** means at least one of:
- a *struggled* flag;
- an answer that wasn't fully right (`incorrect` or `partial`, any grader, "Don't know"
  included), in any session, practice, dive or connector answer;
- mastery reached on an answer recorded before `MASTERY_RULES.rotationSince` (the day this ships),
  so nothing a student has already mastered drops off their island.

Everything else follows from it:
- A fully right answer on an objective that isn't in rotation makes it `verified` (a *check me*
  pass, Practice other topics, a dive, a Claude connector answer).
- An objective in rotation follows today's rules unchanged: the mastery bar (3 correct across
  2 days), FSRS spacing, `fading`, `retired`, `mixed-up`.

### The fold

The answer logic of `applyAnswer` (`src/lib/mastery/objective-state.ts`) doesn't change: credit,
FSRS and the mastery check accumulate whether or not the objective is in rotation. The
accumulator gains two fields, and `stateAt` reads them:

- `inRotation: boolean`, set by the rules above and never cleared.
- `checkOpen: boolean`, set by a *check me* flag on an objective not in rotation and cleared by
  its next answer.

`stateAt`: not in rotation → `check-due` if `checkOpen`, else `unseen` with no answers, else
`verified`. In rotation → today's statuses.

Flags in the fold (`applyConfusion`, renamed `applyFlag` if that reads better):
- *struggled*: today's reset (credit, days, mastery check cleared, FSRS memory kept), plus
  `inRotation = true` and `lastAt` set. Unlike today it applies to an objective with no answers
  too, which then reads `learning` with no credit.
- *check me*, not in rotation: `checkOpen = true`. In rotation and mastered: the spaced check
  is due now (`checkDueAt` = the flag's time), so it reads `fading`. In rotation and not mastered:
  nothing (it's already due).

Consequence, accepted: an objective that was `verified` and reached the bar through practice reads
`fading` (not `learning`) after a later miss, since its accumulator is already mastered.

Bump `RULES_VERSION` and record the new hash in `tests/mastery/snapshot.test.ts`
(`rotationSince` is in `MASTERY_RULES`, so it's hashed).

The Atlas's topic strength `unverified` ("New", `src/lib/course/topic-graph.ts`) keeps its name
and meaning. `verified` objectives count as evidence there: a topic whose objectives are all
verified, mastered or retired is "strong"; an open check is "developing"; fading or mixed-up is
"fragile".

The other two status axes stay as they are:
- **Review state** (`proposed` = "Unreviewed"): whether the extraction is right, not what the
  student knows.
- **`upcoming`** material: its objectives aren't due, and flags on them wait until the
  material is marked covered. Exception: a **manual** flag makes the objective due now (the
  student asked for it on purpose); `upcomingObjectives` (`src/lib/store.tsx`, and the
  connector's copy) leaves out objectives with a manual flag.

### Flags are generalised confusion events

There's no new table and no new event kind. `evidence_events` rows with `kind = 'confusion'` gain
two columns:

- `flag_source text`: `'homework' | 'handwritten-marker' | 'connector' | 'slide' | 'manual'`,
  required on confusion rows and null on answers (check constraints). The migration fills
  `'homework'` into the existing confusion rows once, so the fold has no null case. It's named
  `flag_source` because `source` already exists, for answers.
- `page integer`, nullable: the page in `material_id`. For a .pptx this is the slide number,
  since Orca stores one page per slide.

The strength isn't stored: it follows from the source (`connector` → *check me*, every other
source → *struggled*), in one code table. A column can be added if a source ever needs both.

`note` keeps its meaning, "the student's own words": the reflection, the marked passage, or what
the student said to Claude. It becomes nullable (slide and manual flags have none), at most 2,000
characters as today. `material_id` stays required except for `manual` and `connector` flags.

These are called **struggle flags** in code and docs. Objectives' existing `signals` field
(weight inputs) is a different thing, and flags never change an objective's weight.

Who writes them (the browser never writes evidence directly, as today):
- `POST /api/evidence`: homework (as today, after `/api/reflect`; the store sends the source,
  and the route defaults to it), slide and manual. The route accepts only these three sources
  from the browser.
- The upload job on the server: handwritten markers.
- The connector's `flag_check` tool: connector.

Ids: flags the upload job writes get deterministic ids (`src/lib/mastery/ids.ts`, keyed by
material, page, objective and source), so a retried job can't record the same flag twice. Flags
from the browser and the connector get random ids (the store already retries a save with the same
event), so flagging the same objective again weeks later is recorded rather than refused as a
duplicate. Flags follow merges the way answers do.

### Existing data

Nothing is migrated by hand. Recomputing state under the new rules:
- objectives never answered become `unseen` ("Not flagged");
- objectives answered only fully right, never mastered, become `verified` and leave the due list;
- objectives with a miss, a partial answer or a homework confusion stay in rotation;
- objectives mastered before `rotationSince` stay in rotation (mastered, fading or retired), so
  islands keep what they show.

Existing students' due lists shrink to their weak points on the day this ships. Questions
already written stay usable.

## 2. Where flags come from

Listed in order of friction (passive first), and that's the build order.

### Handwritten markers (passive, struggled)

- **Settings → "How do you mark confusion in your notes?"** For example, "★ = lost, ? in the
  margin, red ink = ask in office hours".
  - Per account only (`profiles.marker_notes`), at most 300 characters.
  - Saved only through a server route that screens it like Notes for Orca (`checkNotes`,
    `src/lib/pipeline/notes.ts`; `acceptNotes`, `src/lib/server/notes.ts`): a strong injection
    hit is refused with the offending span, and every hit is logged to `security_events` (new
    kind `marker_notes`).
- **The page-reader** (`transcribe`, `src/lib/pipeline/transcribe.ts`) gets the description as a
  labelled data block, with rules saying it is student data, never instructions. It still never
  sees Notes for Orca. It writes each passage next to one of the student's markers inline in
  the page's transcription, as `[marked: <marker>] <passage> [/marked]`. The tags are part of the
  saved page text, so a retried job (which never transcribes a page twice; `src/lib/jobs/jobs.ts`)
  still has them, and top-ups and dives see them too.
- **The objectives step** returns, on each objective it lists (new or existing, like
  `emphasis`), `struggled: [{ page, quote }]`: marked passages on that topic's pages that are
  about this objective. Being a field of the objective, it works for objectives the same call
  creates and follows them through reconciliation.
- **Code validators**: the quote must appear inside a `[marked]` span on that page (after the
  normalisation the anchor check uses). A failing item is dropped and listed in the run's
  `dropped`, never guessed.
- **Recorded after the structure is saved** (the event's objective must exist), with the
  job's service-role client through `recordEvent`, as the connector records answers.
- Only pages read from their images carry markers: handwritten notes, notes-app PDFs, scans.
  With no description saved, nothing is looked for and nothing changes.

### The Claude connector (passive, check me)

*check me* flags from AI chats come from the Claude connector (`POST /api/mcp/<token>`,
`src/lib/connector/mcp.ts`), not from parsing pasted transcripts. Claude is already in the
student's chat and already reads Orca's objectives through `course_state`, so it names the
objective directly; no model call or quote check is needed on Orca's side.

- A fifth tool, **`flag_check`** `{ courseId, objectiveIds, said }`: the objectives the student
  asked about or seemed unsure of in the chat, and `said`, the student's own words (at most 200
  characters, sanitised and screened like a reflection note). Each live objective of the course
  gets one *check me* flag from `connector` (no material, no page); ids Orca doesn't know are
  refused and listed in the reply. The tool's description tells Claude to flag only what the
  student asked about or got wrong in the chat, never everything the chat touched. Claude can't
  record *struggled* flags.
- A second *check me* on an objective whose check is still open changes nothing (the fold).
- A flagged objective with no question needs the flag-triggered top-up, which moved to the
  follow-up plan ("Writing questions"): Plan B depends on it for that case. Until then such an
  objective has no questions for `questions_for`, and the reply should say so.
- The connector keeps its own copy of the due statuses (`src/lib/server/connector.ts`); it follows
  the new due list.
- Pasted transcripts and shared chat links (`/api/materials/chat`) are still uploaded as material
  and still shape topics and questions, but they don't record flags.

### Homework reflection (light, struggled)

Unchanged in flow: the upload page sends the note to `/api/reflect` as soon as the file is read,
and records the matches through `POST /api/evidence` (`recordReflection`, `src/lib/store.tsx`).
The rows carry `flag_source = 'homework'`. Because the reflection is matched
before the upload job builds anything, it matches only objectives the course already had, which
already have their questions from their own upload (a match without questions is folded once one
arrives: migration `20261105090000`).

### Slides tapped (light, struggled)

- On a material's row on the Uploads tab: **"Which slides were hard?"** opens the file's pages
  as a grid, rendered in the browser with `pdfjs-dist` (already a dependency) from the Storage
  file.
  - A .pptx has no rendered pages: it shows a list of slide titles and first lines from
    `material_pages`.
- Tapping a page flags every live objective taught on that exact page: one whose signals anchor
  it to the page in this material (`locatorPages`), else one whose topic's `source` covers the
  page. Not `pagesFor` (`src/lib/pipeline/topup.ts`): it adds a page either side and falls back
  to the whole file, which would flag far too much. No model call. One *struggled* flag from
  `slide` per objective, with `page` set.

### Manual (deliberate, struggled)

- **"This is hard"** on an objective (objectives page): one *struggled* flag from `manual`. Offered
  on objectives that have questions, except ones already being learned (`learning`, `mixed-up`:
  shown as "In review", since a flag would only wipe their progress). A mastered, fading or retired
  weak point can be flagged again, which resets it.
- **On a topic** ("This topic is hard" in the topic popup that opens a dive): one flag for each
  objective in the topic with questions, with the same exceptions; no button when that's none.
- A manual flag makes the objective due even when its material is marked not covered yet.

### Writing questions

**As built in Plan A:** uploads still write 2 questions per objective, so a flagged objective
already has questions; the post-session top-up writes 2 more only for weak points still being
learned (unflagged objectives get none). Practice other topics and Practice exam topics are dives,
which write their questions when they start.

**Moved to a follow-up plan.** An audit found that an objective with no questions holds no state
(objectives are grouped by their questions, `objectivesForTopic`), so writing questions only for
flagged objectives would leave new objectives unflaggable, undivable and invisible to the
connector. The follow-up plan first makes catalogue objectives hold state, then: uploads write
questions only for flagged objectives, and a flag starts a top-up (`POST /api/top-up` without a
session). Already done toward it: a question inserted for an objective that has evidence but no
snapshot leaves a stale placeholder, so a flag recorded before its objective had questions is
folded once the first arrives (migration `20261105090000`).

## 3. Scheduling and screens

### What's due

In `src/lib/mastery/agenda.ts`, `DUE_TODAY` becomes `["mixed-up", "learning", "fading",
"check-due"]`. The order a quick review asks them in is set by status group in `quickGroup`
(`src/lib/mastery/session.ts`), not by priority scores (a weighted sum can't guarantee an order):
mixed-up, then fading overdue, then learning, then fading due today, then check-due. Priority
breaks ties inside a group, as today. A check-due objective gets one question per session
(`needsMore` leaves it out).

### Quick review

- Weak points only, sized to the course's time budget as today. The sidebar's "Covers N
  objectives" (`askable.ts` + `assembleQuickReview`) counts only those.
- **Nothing due** (nothing in the course's due list, whatever the cadence, and the course has
  objectives with questions): the card reads "You're caught up" with a **Practice other topics**
  button. A due weak point with nothing a quick review can ask shows no quick-review card. It
  opens the dive setup (`DeepReviewSetup`) scoped to the course's `verified` and `unseen`
  objectives, highest weight first: `POST /api/deep-review` already takes `objectiveIds`. No new
  session kind and no new pipeline step. Answers follow the rotation rule.

### Dive in

Still started by the student:
- A topic dive covers every objective in that topic.
- A course-wide dive covers weak points first, then `verified` and `unseen` objectives.

The course's dive cadence still marks a dive due ("Dive in · due"), but only when the course has
something in rotation that isn't retired (`deepReview.candidates` counts those).

### Exams

- In the "1 wk before exam" window of an exam on the exams table, that exam's weak points come
  first inside each quick-review group (its topics, following merges).
- The caught-up card then offers **Practice exam topics**: the same scoped dive, over `verified`
  and `unseen` objectives in those topics only. It shows only when the exam names topics with such
  objectives left (an uploaded exam's calendar entry has no topics, so it would only repeat
  Practice other topics).

Nothing comes due on its own.

### Course trail and islands

- **Each topic node** shows a small ring and "1 of 3 mastered", counting the topic's objectives in
  rotation that are now mastered or retired.
  - A topic with nothing in rotation shows no ring.
  - A `fading` objective drops out of the mastered count until it's answered again, so the ring
    can dip.
  - When everything in rotation is mastered, the ring is full with a ✓.
- **Islands** (`islandLevel`, `src/lib/mastery/progress.ts`) use the same share, over the whole
  course, with the existing thresholds. Nothing in rotation gives the uncharted look, labelled
  "No weak spots flagged yet".
- **Copy**, on the course page and the empty sidebar: "Orca focuses on what you flag: star
  things in your notes, study with Claude, or tap the slides that were hard."

### Unchanged

The streak (days with answers), question thumbs up/down, review settings and cadences, Notes for
Orca. The Claude connector's answers follow the rotation rule; it gains `flag_check` (above).

## 4. Failure handling

No silent placeholders (CLAUDE.md invariant).
- **Invalid model output** (a quote not inside a marked span on its page): the item is dropped
  and listed in the run's `dropped`.
- **A refused marker description:** 400 with the span, as Notes for Orca.
- **`flag_check` with unknown objective ids:** refused per id, listed in the reply; the known
  ones are still recorded.
- **Practice other topics with nothing `verified` or `unseen` left:** "You've practised everything
  here" instead of the button.

## 5. Build: three plans

**Plan A: the core.** This is most of the value, and it ships alone. In order:
1. Migration (block `20261105090000…`): `flag_source` and `page` on `evidence_events`, `note`
   nullable, `material_id` optional for manual and connector flags, the check constraints;
   `security_events` kind `marker_notes` (reserved for Plan B).
2. The fold: `inRotation`, `checkOpen`, `verified` / `check-due`, `rotationSince`, the
   `RULES_VERSION` bump.
3. The agenda, `quickGroup`, the topic ring and island share, the Atlas strength, the
   connector's due statuses, manual flags past `upcoming`.
4. Manual "This is hard" on objectives and topics; homework rows with their source.
5. The caught-up card, Practice other topics, the dive changes, Practice exam topics.
6. The copy.

Moved out of Plan A to a follow-up plan (see "Writing questions"): flag-triggered top-ups and
upload question writing limited to flagged objectives.

**Plan B: passive flags.** The marker setting (column, route, screening, Settings field); the
`transcribe` data block and inline `[marked]` tags; `struggled` on the objectives step's
objectives; validators; recording after the save; the connector's `flag_check` tool.

**Plan C: tapped slides.** The page grid on the Uploads tab, page-to-objective mapping, the
.pptx list.

## 6. Testing

- **Unit (mastery):**
  - an `unseen` objective answered right → `verified`; answered partly right → in rotation;
  - *check me*, then right → `verified`; *check me*, then wrong → `learning`;
  - *check me* on a mastered objective → `fading`;
  - *struggled* with no answers → `learning`, then the bar → `mastered`, then the check due →
    `fading`;
  - a miss in practice → in rotation;
  - mastered before `rotationSince` → still in rotation; mastered after it with no miss →
    `verified`;
  - old confusion rows replay as struggled from homework;
  - the snapshot hash.
- **Unit (agenda and session):** `unseen` and `verified` never due; the caught-up state; the
  `quickGroup` order; check-due gets one question; the topic ring and island share, including
  fading and 0 of 0; a manual flag on upcoming material is due.
- **Unit (pipeline, Plan B):** the validators drop quotes not inside a marked span on their page.
- **Unit (connector, Plan B):** `flag_check` records one *check me* flag per known live objective,
  refuses unknown ids, and screens `said` (`tests/connector/`, fake `ConnectorTools`).
- **pgTAP:** the new columns and constraints; old rows still valid and read as homework.
- **Browser:**
  - a manual flag makes the objective due, and answering it fills the ring;
  - the caught-up card and Practice other topics;
  - markers through a fake-model scenario (Plan B);
  - a tapped slide flags its objectives (Plan C).
- **Existing browser tests** that expect a new objective to be due need updating (8 of the 17
  specs open sessions). That is the largest share of the test work in Plan A.

## 7. Docs to update when building

- `docs/MASTERY-PLAN.md` §2.3: the status table.
- `docs/BACKEND-ROADMAP.md`: the decision.
- `CLAUDE.md` product model: "Practice", islands, statuses, the connector's fifth tool.
- `docs/SETUP-HOSTED.md` §8: the connector's tools.

## Decided with the owner (2026-11-04)

1. Marker descriptions are per account only, with no course override.
2. A tapped slide flags every objective taught on that page, even when the student meant one.
3. *Check me* asks one question; struggled objectives get 2 written up front.
4. A miss anywhere (practice, dive, connector) puts the objective in rotation, as a struggled
   flag would. A partly right answer counts as a miss here.
5. Practice other topics picks the highest-weighted unflagged objectives first. It doesn't
   favour the topic the class is on now; that's still the open "extra priority" item in
   `docs/TO-DISCUSS.md`.
6. Islands and rings count mastered out of everything in rotation (not "ever flagged", which a
   passed *check me* would keep in the total for ever).
7. Objectives already mastered when this ships stay in rotation, so no island loses its look.
8. A manual flag on material the class hasn't reached is due now.
9. The dive cadence still marks a dive due, only when something is in rotation.
10. *Check me* flags from AI chats come from the Claude connector (`flag_check`), which can't
    record *struggled*; pasted chats no longer record flags.
11. Simplifications from the audit: `unseen` keeps its name; two new columns, strength derived
    from the source; Practice other topics and Practice exam topics are scoped dives; limiting
    upload question writing comes last in Plan A.
