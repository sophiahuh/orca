# A: 7b injection defences (2026-10-06, cloud container)

## Status

Done on `phase-4`, one commit after B's. Redone from scratch (the teammate's run of A stopped at
its session limit). Plan decision 13, layer by layer:

- **Pattern screen** (`src/lib/untrusted/screen.ts`, pure): OWASP-style phrasing ("ignore
  previous instructions", "you are now", "system prompt", "developer message", "act as", "mark
  all correct", "reset every objective", "to the AI", …), with letters optionally separated by
  spaces, dots or dashes and one letter swapped, added or dropped in words of five or more
  letters; chat role tags (`<|im_start|>`, `[INST]`, `<<SYS>>`, `system:` at a line start, …);
  Base64 runs of 40+ characters and hex runs of 20+ bytes decoded and rescanned when they decode to
  printable text. A hit never blocks: it sets `suspected` and quotes the span (≤ 240 characters).
  Course text that discusses these ("a system prompt is…") is flagged too, by design; the warning
  on the review screen asks the student to check, nothing is removed.
- **Every prompt sends untrusted text as data blocks** (`src/lib/pipeline/prompts.ts`): the
  material (`uploaded_pdf`, one entry per page, identical bytes across the calls of one upload, so
  caching still works), the course's existing items and the generated questions under check
  (`generated_question`: written by earlier calls from someone's material), and the reflection
  note (`reflection_note`). `UNTRUSTED_POLICY` is in every system prompt; each step's first line is
  unchanged (the fake API recognises steps by it); the task's instruction follows the data.
  Extraction and generation also carry a rule that anything in the material addressing the model
  is content to report. **Caveat for the owner:** this is a prompt-format change on every step;
  `npm run score:extraction` should be rerun with a key before merging (Task 10) to see whether
  recall or precision moved. The fake API (`e2e/fake-anthropic.ts`) now reads its inputs from the
  data blocks, as the real model would.
- **Output validators** (`src/lib/untrusted/validate.ts`, pure; applied in `src/lib/pipeline/run.ts`):
  every string the model returns has a schema length limit (`schemas.ts`); every id must be one
  the call was given (already so: objective ids, existing ids, relation ends); an anchor or place
  that names slides must name ones the material has (one naming a problem number can't be checked
  and is kept); generated text (topic names, summaries, aliases; objective names, descriptions,
  aliases, place excerpts, emphasis quotes; question prompts, options, explanations, exact answers,
  rubric lines, anchor excerpts; relation anchors) is sanitised and refused when it holds a URL
  the material doesn't contain, HTML, a markdown link, or screen-flagged phrasing. Refused items
  are dropped with `refused: <field> <reason>` in `run.dropped`, never repaired; a refused topic
  takes its objectives with it ("skipped: its topic was rejected" is the existing wording); a bad
  place is dropped, its objective kept.
- **`instructionsFound`** on the extraction schema (quoted spans addressed to an AI). Together
  with the screen's hits it goes on the run as `security` (new `pipeline_runs.security` jsonb:
  `{ screen, instructionsFound, refused }`, mapped in `app-rows.ts` and `PipelineRun`). The review
  page's done block shows "This file contains text aimed at an AI; check what it added." when
  either is non-empty, plus how many items the checks left out.
- **`security_events`** (migration `20261005210000_security.sql`): owner, kind (`upload`,
  `reflection_note`, `student_answer`, `generated`), check, run/material/question refs, quote
  (≤ 240), time. RLS on, no policies: service role only. A trigger on `pipeline_runs.security`
  writes one event per screen hit (`check` = the screen's) and per reported span
  (`model:instructionsFound`), so the job never touches the table. `/api/reflect` screens the
  sanitised note, records events (`src/lib/server/security.ts`, `recordSecurityEvents`) and still
  matches it (the prompt says instructions in the note match nothing). `flaggedCount(db, owner,
  kind, since)` is exported for integration's repeat-offender rule.
- **Red-team set** (`tests/fixtures/injection/samples.ts`): plain, misspelt/spaced, role-tagged,
  Base64, hex, tag-block smuggled and zero-width attacks; an answer arguing with the grader; a
  note trying to reset the course; generated text with a URL, HTML, a markdown link and an
  instruction; a hidden-text PDF and a visible-injection PDF; benign security-course sentences.
  Unit tests run them through the sanitiser, the screen and the validators (`tests/untrusted/
  screen.test.ts`). `npm run score:extraction` gains an injected L02 (three planted slides) in both
  `--dry` and the live run; a planted item reaching the structure fails the run.

Tests: unit as above plus the pipeline tests (fixtures carry `instructionsFound`); pgTAP
`09_security.test.sql` (the trigger writes one event per finding and nothing for an unchanged or
clean run; the jsonb shape is checked; students can read their run's findings but never
`security_events`); e2e `e2e/injection.spec.ts` (the visible-injection deck against the fake API
answering as if steered: the planted topic with a URL is refused, the planted place naming a
missing slide is dropped while its objective stays, the warning shows, `security_events` holds a
`phrase` hit and the `model:instructionsFound` span, nothing is readable by the student; a
reflection note aimed at the AI is logged and still answered).

## Proof (final run, all green)

See the commit message for counts.

## Judgement calls

- **Anchors that don't name slides are kept.** Homework and exam anchors say "problem 3"; refusing
  them would drop every objective a problem set teaches. Only slide/page locators are checked.
- **The screen flags legitimate discussion** of injection ("a system prompt is…"). Accepted: a hit
  only warns; a security course's student sees the warning once per such deck.
- **Validators refuse, never repair**, as the plan says, so a question with one bad option is lost
  rather than shown with three.
- **Prompt caching:** the material block is the same string for every call of an upload (the pages
  are trimmed to the same budget as before), so the cache still pays for the material once.
- **Not done here, by the plan:** screening prose answers in `/api/grade`, turning model grading
  off for repeat offenders, and the Haiku pre-screen (deferred by the owner). `screen`,
  `recordSecurityEvents` and `flaggedCount` are what integration needs.
- **`generated_question` as the source label for existing course items** (topic and objective
  names in prompts): they are model output from earlier material, so the policy's "untrusted,
  written by someone other than Orca" fits; the four sources were fixed in W0.
