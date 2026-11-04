# Weak points first — design

Status: design agreed with the owner in brainstorming, 2026-11-04. Not built. Plans A, B and C
(below) follow from it.

## Why

Students found Orca overwhelming. Every objective of every upload came due, and studying meant
working through all of them, on top of their usual coursework. Orca now practises only what
the student struggles with. An objective nobody has flagged is left alone. Struggles are found
mostly from work the student already does: stars in their notes, questions they asked an AI,
homework reflections.

Ruled out:
- **Random checks of unflagged objectives.** There are too many objectives for an occasional
  sample to cover enough to matter.
- **A placement quiz after upload.** It's extra work outside the student's normal routine.

## Decisions

1. Unflagged objectives are never due. When nothing is due, the quick review shows "You're
   caught up" and an optional **Practice other topics**.
2. Flags come in two strengths:
   - **struggled**: back to learning, the full mastery bar, then spaced checks.
   - **check me**: one question. A pass clears it; a miss turns it into struggled.
3. Islands and topic rings measure **weak points mastered**: flagged objectives now mastered or
   retired, out of all objectives ever flagged. An island with nothing flagged shows its
   uncharted look, labelled "No weak spots flagged yet".
4. Questions are written only for flagged objectives, plus whatever Practice other topics and
   dives ask for when they start.
5. In optional practice, a miss makes the objective struggled. A pass is recorded but never adds
   future work.
6. Learner state stays derived from the evidence log (CLAUDE.md invariant). Flags are
   evidence events, not a stored status.

## 1. Learner model

### Statuses

`ObjectiveStatus` (`src/lib/mastery/types.ts`) becomes:

| Status | Meaning | Due? | Student sees |
|---|---|---|---|
| `unverified` | no answers, no open flag (replaces `unseen`) | never | "Not flagged" |
| `verified` | answered correctly while not in rotation | never | "Verified ✓" |
| `check-due` | an open *check me* flag | yes, one question | "Check" |
| `learning` | in rotation, below the mastery bar | yes | as today |
| `mixed-up` | in rotation, mixed up with another (as today) | yes | as today |
| `mastered` | in rotation, met the bar, next check not due | no | as today |
| `fading` | in rotation, its spaced check is due | yes | as today |
| `retired` | in rotation, retired (as today) | no | as today |

**In rotation** means the objective has had at least one *struggled* flag or at least one
missed answer, in any session, practice or dive. This one rule covers everything:
- A pass on an objective that isn't in rotation makes it `verified`. That includes a *check me*
  pass, Practice other topics, a dive, and a Claude connector answer.
- Any miss puts the objective in rotation.
- An objective in rotation follows today's rules unchanged: the mastery bar (3 correct across
  2 days), FSRS spacing, `fading`, `retired`, `mixed-up`.

The fold (`applyAnswer` / `applyConfusion` in `src/lib/mastery/objective-state.ts`) gains an
`inRotation` flag on the accumulator. Today `applyConfusion` ignores an objective with no
answers (`if (acc.answered === 0) return acc`). Under this design a struggled flag on a
never-answered objective must put it in rotation, as `learning` with no credit. A `check` flag
opens `check-due` until the next answer on that objective. Bump `RULES_VERSION` and record the
new hash in `tests/mastery/snapshot.test.ts`.

The Atlas's existing topic strength `unverified` ("New", `src/lib/course/topic-graph.ts:22`)
keeps its name and meaning. `verified` objectives now count as evidence there. The other
strengths (strong, developing, fragile) come only from objectives in rotation.

The other two status axes stay as they are:
- **Review state** (`proposed` = "Unreviewed"): whether the extraction is right, not what the
  student knows.
- **`upcoming`** material: its objectives aren't due, and flags on them wait until the
  material is marked covered.

### Flags are generalised confusion events

There's no new table and no new event kind. `evidence_events` rows with `kind = 'confusion'`
gain four columns:

- `strength text`: `'struggled' | 'check'`.
- `flag_source text`: `'homework' | 'handwritten-marker' | 'ai-chat' | 'slide' | 'manual'`.
  It's named `flag_source` because `source` already exists, for answers.
- `page integer`, nullable: the page in `material_id`. For a .pptx this is the slide number,
  since Orca stores one page per slide.
- `quote text`, nullable, at most 200 characters: the marked passage, or the student's line in
  an AI chat.

Existing rows read as `struggled` from `homework`: either a migration default, or the fold
treating null as that. The log is append-only, so old rows are never rewritten. `note`
(required today for confusion) becomes optional when `quote` is set. `material_id` stays
required, except for `manual` flags.

These are called **struggle flags** in code and docs. Objectives' existing `signals` field
(weight inputs) is a different thing, and flags never change an objective's weight.

All flags are written through `POST /api/evidence` (browser-originated: slide, manual) or by
the upload job on the server (markers, AI chats, homework). As today, the browser never
writes evidence directly. Flags follow merges the way answers do. Deterministic ids
(`src/lib/mastery/ids.ts`) keep a retried job from recording the same flag twice: the key is
material, page, objective and source.

### Existing data

Nothing is migrated by hand. Recomputing state under the new rules:
- objectives never answered become `unverified`;
- objectives answered correctly with no miss become `verified` and leave rotation;
- objectives with a miss or a homework confusion stay in rotation.

Existing students' due lists shrink to their weak points on the day this ships. Questions
already written stay usable.

## 2. Where flags come from

Listed in order of friction (passive first), and that's the build order.

### Handwritten markers (passive, struggled)

- **Settings → "How do you mark confusion in your notes?"** For example, "★ = lost, ? in the
  margin, red ink = ask in office hours".
  - Per account only (`profiles.marker_notes`), at most 300 characters.
  - Saved only through a server route that screens it like Notes for Orca (`checkNotes` /
    `acceptNotes`): a strong injection hit is refused with the offending span, and every hit
    is logged to `security_events` (new kind `marker_notes`).
- **The page-reader** (`transcribe`, `src/lib/pipeline/transcribe.ts`) gets the description as
  a labelled data block, with rules saying it is student data, never instructions.
  - It still never sees Notes for Orca.
  - Its output schema adds `marked: [{ quote, marker }]` per page: passages next to one of the
    student's markers, quoted from that page's transcription.
- **The objectives step** maps each page's marked passages to that topic's objectives and
  returns `struggled: [{ objectiveId, page, quote }]`. It already sees each topic's
  objectives and pages.
- **Code validators** check two things:
  - the objective must be one the call was given;
  - the quote must appear in that page's text (after the normalisation the anchor check uses).

  A failing item is dropped and listed in the run's `dropped`. It's never guessed.
- Only pages read from their images carry markers: handwritten notes, notes-app PDFs, scans.
  With no description saved, nothing is looked for and nothing changes.

### AI chats (passive, check me)

The map and objectives steps already read STUDENT lines as signals (`src/lib/pipeline/prompts.ts`,
`isAIChatMaterial`). Their output adds `askedAbout: [{ objectiveId, page, quote }]`, where the
quote must come from a STUDENT line (checked in code, same drop rule). Each item records a
`check` flag from `ai-chat`. This applies to pasted transcripts and shared links (`/api/materials/chat`).

### Homework reflection (light, struggled)

Unchanged (`/api/reflect`). It now records `strength = 'struggled'` and
`flag_source = 'homework'`.

### Slides tapped (light, struggled)

- On a material's row on the Uploads tab: **"Which slides were hard?"** opens the file's pages
  as a grid, rendered in the browser with `pdfjs-dist` (already a dependency) from the Storage
  file.
  - A .pptx has no rendered pages: it shows a list of slide titles and first lines from
    `material_pages`.
- Tapping a page flags every live objective taught on it, found from each objective's own
  pages (`pagesFor`, `src/lib/pipeline/run.ts`). No model call. One `struggled` flag from
  `slide` per objective, with `page` set.

### Manual (deliberate, struggled)

- **"This is hard"** on an objective (objectives page): one `struggled` flag from `manual`.
- **On a topic** (its trail node menu): one flag for each live objective in the topic.

### Writing questions

- The upload job writes questions only for objectives flagged in that same job: markers, AI
  chat, a reflection on that upload. That's 2 per struggled objective and 1 per check-me
  objective.
- A flag added later (slide, manual) starts the existing top-up job (`topup.ts`, the `topUp`
  rate limit) for the flagged objectives.
- Practice other topics writes its questions when it starts, as a dive does.

## 3. Scheduling and screens

### What's due

In `src/lib/mastery/agenda.ts`, `DUE_TODAY` becomes `["mixed-up", "learning", "fading",
"check-due"]`. Priority order: mixed-up, then struggled (the existing `confusion` priority term
in `priority.ts`), then fading, then check-due, with weights and the other terms breaking ties.

### Quick review

- Weak points only, sized to the course's time budget as today. The sidebar's "Covers N
  objectives" (`askable.ts` + `assembleQuickReview`) counts only those.
- **Nothing due:** the card reads "You're caught up" with a **Practice other topics** button.
  It writes questions for the highest-weighted `unverified` objectives, sized to the time
  budget. It's a session kind next to `deep`, with the same pipeline step and the same rules
  for its answers.

### Dive in

Still started by the student:
- A topic dive covers every objective in that topic.
- A course-wide dive covers weak points first, then `unverified` objectives.

Answers follow the rotation rule.

### Exams

- In the "1 wk before exam" window, that exam's weak points come first (the exam's topics, if
  it lists any).
- The caught-up card then offers **Practice exam topics**: `unverified` objectives in those
  topics only.

Nothing comes due on its own.

### Course trail and islands

- **Each topic node** shows a small ring and "1 of 3 mastered", counting the topic's flagged
  objectives that are now mastered or retired.
  - A topic with nothing flagged shows no ring.
  - A `fading` objective drops out of the mastered count until it's answered again, so the ring
    can dip.
  - When everything flagged is mastered, the ring is full with a ✓.
- **Islands** (`islandLevel`, `src/lib/mastery/progress.ts`) use the same share, over the whole
  course, with the existing thresholds. Nothing flagged gives the uncharted look, labelled "No
  weak spots flagged yet".
- **Copy**, on the course page and the empty sidebar: "Orca focuses on what you flag: star
  things in your notes, add AI chats, or tap the slides that were hard."

### Unchanged

The streak (days with answers), question thumbs up/down, `upcoming`, review settings and
cadences, Notes for Orca, the Claude connector (its answers follow the rotation rule).

## 4. Failure handling

No silent placeholders (CLAUDE.md invariant).
- **Invalid model output** (an objective the call wasn't given, or a quote not on the page or
  not from a STUDENT line): the item is dropped and listed in the run's `dropped`.
- **A top-up for a new flag fails:** the weak spot shows "Couldn't write questions for this yet"
  with Try again, never an empty session.
- **A refused marker description:** 400 with the span, as Notes for Orca.
- **Practice other topics with nothing unverified left:** "You've practised everything here"
  instead of the button.

## 5. Build: three plans

**Plan A: the core.** This is most of the value, and it ships alone.
- Migration (block `20261105090000…`): the four confusion columns, check constraints,
  `security_events` kind `marker_notes` (reserved for Plan B).
- The fold: `inRotation`, `unverified` / `verified` / `check-due`, the `RULES_VERSION` bump.
- The agenda and priorities; the topic ring and island share; the Atlas strength.
- Manual "This is hard" on objectives and topics.
- Upload question writing limited to flagged objectives; a top-up on later flags.
- The caught-up card, Practice other topics, the dive changes, Practice exam topics.
- The copy.

**Plan B: passive flags.** The marker setting (column, route, screening, Settings field); the
`transcribe` data block and `marked` output; `struggled` from the objectives step; `askedAbout`
from AI chats; validators.

**Plan C: tapped slides.** The page grid on the Uploads tab, page-to-objective mapping, the
.pptx list.

## 6. Testing

- **Unit (mastery):**
  - an unverified objective answered right → `verified`;
  - *check me*, then right → `verified`; *check me*, then wrong → `learning`;
  - *struggled* with no answers → `learning`, then the bar → `mastered`, then the check due →
    `fading`;
  - a miss in practice → in rotation;
  - old confusion rows replay as struggled from homework;
  - the snapshot hash.
- **Unit (agenda):** unverified never due; the caught-up state; priority order; the topic ring
  and island share, including fading and 0 of 0.
- **Unit (pipeline, Plan B):** the validators drop unknown objectives, quotes not on the page,
  and quotes not from a STUDENT line.
- **pgTAP:** the new columns and constraints; old rows still valid.
- **Browser:**
  - a manual flag makes the objective due, and answering it fills the ring;
  - the caught-up card and Practice other topics;
  - markers through a fake-model scenario (Plan B);
  - a tapped slide flags its objectives (Plan C).
- **Existing browser tests** that expect a new objective to be due need updating. That is the
  largest share of the test work in Plan A.

## 7. Docs to update when building

- `docs/MASTERY-PLAN.md` §2.3: the status table.
- `docs/BACKEND-ROADMAP.md`: the decision.
- `CLAUDE.md` product model: "Practice", islands, statuses.
- `docs/TO-DISCUSS.md`: the assumptions below.

## Assumptions (for the owner to confirm or change)

1. Marker descriptions are per account only, with no course override.
2. A tapped slide flags every objective taught on that page, even when the student meant one.
3. *Check me* asks one question; struggled objectives get 2 written up front.
4. A miss anywhere (practice, dive, connector) puts the objective in rotation, as a struggled
   flag would.
5. Practice other topics picks the highest-weighted unverified objectives first. It doesn't
   favour the topic the class is on now; that's still the open "extra priority" item.
