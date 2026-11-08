# Orca: logic review and improvement plan (2026-11-08)

> **Status: proposal, 2026-11-08.** Written for the owner after a read-only review of the whole
> app on `phase-4` at f647e20f..c9bdd255. Nothing here is built. Decisions the owner must make
> are in §5; everything else is ordered work.

**How it was done.** Five read-only passes over the code (the learner model and scheduling; the
extraction pipeline and its cost; jobs, uploads and the Canvas import; the Claude connector and the
student's journey; the data model and security), each against the docs that state the intent
(`CLAUDE.md`, `docs/MASTERY-PLAN.md`, the weak-points spec, `docs/TO-DISCUSS.md`). The findings
below carry `file:line` evidence. The ones marked **(verified)** were reproduced by hand on the
branch; the rest come from the passes and should be read in the code before they're fixed.

## 1. The picture

The foundations are good and should stay: learner state is derived from an append-only evidence
log by a pure, versioned fold; every table is owner-only under RLS with the sensitive ones
service-role-only; material is read in parts with strict schemas, data blocks and validators; jobs
have explicit queued / waiting / paused / stopped / failed states; the connector is a pure protocol
module with a fake-tools test seam. The invariants in `CLAUDE.md` are mostly honoured.

Five things are broken or missing, in order of how much they matter to the product the owner
decided on ("Claude teaches, Orca keeps score"; self-sustaining before company; cheap):

1. **The scoreboard doesn't score the way the student now studies.** Every answer that comes
   through the connector is half credit and never counts toward the two graded marks mastery needs,
   so a student who studies only in Claude can never reach "mastered" and the island never grows. At
   the same time a single self-marked "correct" permanently marks an unflagged objective "verified".
2. **Day one is empty.** After an upload (or a Canvas import) nothing is flagged, so the trail says
   "No weak spots flagged yet", the sidebar says "You're caught up", and the connector has no
   questions to ask and no sanctioned way to get any. The only first actions cost a model call and a
   wait.
3. **Cost is small but the budget machinery makes it feel broken.** A 40-slide deck costs about
   60 cents to read at the default model and about 3 cents at the small one; a whole course is about
   $10 or $0.50. The real pain is the cap logic: a spent day silently parks dives, top-ups and
   connector requests, nothing wakes them until the next cron, and the import page reports files as
   "added" that will sit for days.
4. **A handful of correctness bugs corrupt the signal or the content.** Boolean-expression answers
   are string-compared; pasted chats get their speakers mangled by a regex; removing a file archives
   objectives other files also teach; coarse syllabus objectives and fine lecture objectives
   coexist.
5. **Two security holes and one operational unknown.** Redirect hops in the Canvas client aren't
   checked (SSRF); several routes have no rate limit; and the Trigger.dev worker may be unable to
   advance a student's queue if its environment lacks `ORCA_JOBS`.

## 2. What it costs (corrected)

Per-call token estimates from the pipeline pass (`src/lib/pipeline/run.ts`, `jobs.ts`,
`pricing.ts`); reasoning billed as output; cache writes omitted (about +2%).

| Unit | Model calls | gpt-6.1-sol ($2 / $10 per M) | gpt-6-luna ($0.1 / $0.5 per M) |
|---|---|---|---|
| One typed 40-slide deck, extraction only | ~26 | **~$0.60** (first deck ~$0.35) | **~$0.03** |
| Same deck, handwritten (adds transcribe) | +10 | +$1.00 | +$0.05 |
| Flag top-up, 3 objectives (6 questions) | 1 | $0.07 | $0.003 |
| 30-minute dive (8 questions) | 1–2 | $0.14 | $0.007 |
| Course of 400 pages (10 decks), extraction | ~260 | **~$5–6** | **~$0.30** |
| + 150 flagged objectives + 10 dives | ~60 | +$4.70 | +$0.24 |
| **Course total** | | **~$10** | **~$0.50** |

So the earlier working estimate of $30–60 a student per semester was too high; it's closer to $10
at the default model, and under a dollar at the small one. Output tokens (including reasoning) are
about 80% of the cost at the default model, so **effort level and model per step matter far more
than trimming input**. A 400-page course lands near the 2M-token day, which is why a Canvas import
of a whole course hits the cap.

Levers, in order of effect: reasoning effort `low` on map/objectives/link/transcribe (about −40%
output); the small model for describe, transcribe, reconcile and link; fewer reconcile calls (the
shortlist matches on stop words); short topic refs in the table of contents; fix or remove the
prompt-cache breakpoint (today it pays the 1.25× write price on every call and almost never hits).
The owner's rule stands: **the token cap stays at 2M until the cheap-model switch is measured**.

## 3. Findings, ranked

Severity: H = corrupts the mastery signal, loses data, or blocks the product; M = wrong behaviour a
student will hit; L = hygiene.

### A. The mastery signal

| # | Finding | Evidence | Effect | Fix |
|---|---|---|---|---|
| A1 | **H (verified)** Connector answers never count toward mastery. | `src/lib/server/connector.ts:211` records `grader: "self"`; `src/lib/mastery/objective-state.ts:17,262-265,273,294` (self credit never raises `gradedCredit`; `requiredGradedCredit: 2`; a check pass needs `!assisted`). | A Claude-only student stays "learning" forever; nothing fades or clears; island stays sprouting; streak stays 0. | `check_answer`: Orca grades choice and exact itself (free), prose through the server grader; records `grader` accordingly, full credit. Keep `record_answer` as the self-grade fallback, with the student's words stored. |
| A2 | **H (verified)** Any answer makes an unflagged objective "verified". | `objective-state.ts:349`: not in rotation and `answered > 0` → `verified`, whatever the grader. | Claude (or the no-AI self-report panel) saying "correct" once verifies it for good; it leaves Practice other topics and is never due. | `verified` requires an unaided correct answer; a self-marked correct on an unseen objective stays unseen. |
| A3 | **H (verified)** Boolean expressions are graded by string compare. | `src/lib/pipeline/prompts.ts:55` lets `exact` be "an expression"; `src/lib/mastery/grading.ts:33-76` only normalises; no truth-table or equivalence module exists in `src/lib`; `grading.ts:39` strips `*`, `·`, `×` so "10*2" ≡ "102". | "B+A" against a key of "A+B" is marked wrong and the objective enters rotation. The invariant "Boolean expressions by truth table" is unmet. | Short term: forbid expressions in `exact` (prompt + validator; rubric or multiple choice instead) and add a numeric parse-and-compare path. Later: a small Boolean evaluator for exact answers that parse. |
| A4 | M | A struggled flag resets credit but keeps FSRS stability. | `objective-state.ts:321-338` keeps `card`; `:276` sets the next check from the old stability. | "I don't get this" on a mastered objective, three right answers later, and no check for two months. | Apply `Rating.Again` to the card on a flag, or cap the first check after a flag. |
| A5 | M | Burned questions can make an objective unmasterable. | `:260-269` (a missed question never earns credit); supply is 2 per objective + 2 per session. | Miss both initial questions and the student can answer right daily with "0 of 3 correct"; permanently if the top-up fails. | Credit a previously missed question answered right on a later day (full or half), and never show "Finish" copy that promises what the top-up hasn't delivered. |
| A6 | M | "Mixed up: two different questions in a row" can span months. | `:252-258`: `lastMissQuestion` is cleared only by an unaided correct. | False mix-ups, +2 priority, forced mechanism question. | Clear it on any graded non-incorrect answer, or scope "in a row" to a day. |
| A7 | M | A due weak point with nothing askable shows "Nothing due. Nice." forever. | `src/lib/mastery/todo.ts:208-219`, `Sidebar.tsx:52,62`; `store.tsx` `requestFlagTopUp` counts thumbed-down questions as present. | Both questions thumbed down → stuck. | Count only askable questions; show "Writing questions for N weak spots…". |
| A8 | M | Islands and rings punish Orca's own schedule. | `progress.ts:21,47`: fading counts as not held the moment `checkDueAt` passes; `todo.ts:229-233` shows "Due tomorrow" when no review is tomorrow. | Level drops mid-week before the review day Orca chose. | Treat fading as held until the next quick-review day for display. |
| A9 | L | FSRS rates the card once per answer. | `:239-241`. | Interval depends on how many questions a session happened to ask. | One rating per objective per day (worst grade). |
| A10 | L | Connector session id is the UTC day. | `src/app/api/mcp/[token]/route.ts:40` vs `connector.ts:130`. | "Retry must come from a later session" is wrong around 19:00 ET. | `dayKeyIn(timezone)`. |
| A11 | L | Silent placeholder for a missing snapshot. | `course-mastery.ts:56` `?? EMPTY_ACCUMULATOR`. | Reads "unseen" for an unfetched objective. | Throw or mark unknown. |

### B. Day one, and the connector

| # | Finding | Evidence | Effect | Fix |
|---|---|---|---|---|
| B1 | **H** A fresh course has three screens that say "nothing to do". | `KnowledgePath.tsx:89-96`, `CaughtUp.tsx:25`, `Sidebar.tsx:37,50-62`, `course/[slug]/page.tsx:76,113,150-164` (the only first actions: a dive or "flag all of it"). | No free first "aha"; "caught up" is false for someone who has done nothing. | A first-run state with a cheap warm-up (§4, phase 2). |
| B2 | **H** The connector can't quiz a freshly imported course. | `connector.ts:122-126` (`dueNow` needs questions > 0), `:150-151`; `flag_check`'s description tells Claude to flag only what the student raised (`mcp.ts:202-205`). | On day one Claude has no sanctioned way to get a question. Tonight's live test hit exactly this. | `next_questions` that writes on demand with a `pending` contract; `course_state` carries `budget` and `writing`. |
| B3 | **H** Spent budget and queued top-ups are invisible to Claude. | Only `flag_check` reports it (`connector.ts:282-290`, added 2026-11-07); nothing Claude calls resumes anything; top-ups queue behind any upload (`jobs/start.ts:137-145`). | "A few minutes" can mean a day after an import. | `course_state.budget {ok, reason, resetsAt}`; `writing [...]`; never an empty result without `reason`. |
| B4 | M | Answer keys go to the chat; the student's words aren't stored. | `mcp.ts:71-86` ships `answer`, `exact`, `rubric`; `record_answer` has no `response`. | Peeking (already in TO-DISCUSS); no audit or regrade possible. | Comes with A1: keys only after `check_answer`; `response` stored on the event. |
| B5 | M | The connector instructions don't script a session. | `mcp.ts:20-27`; `course_state` says "call again after recording" (`:134-135`), a full 78-objective payload per round. | Claude dumps five questions, re-pulls state each time. | Rewrite as a script: state → one question → check → explain → repeat; `record_answer` already returns the new status. |
| B6 | M | `questions_for` repeats and miscounts. | `connector.ts:152-187`: round-robin returns each objective's first question; attempted questions aren't excluded; deep questions counted in `course_state.questions` but ignored in `withoutQuestions`. | Same question every call; "0: it can't be checked" is wrong when only deep ones exist. | Unanswered first, then least recently seen; count askable only. |
| B7 | M | Contradictory copy and vocabulary. | `UploadCard.tsx:191-195` vs `review/page.tsx:77` ("New topics are quizzable now", untrue); dive = deep review = Practice other topics; check / Check / check me / check-due; weak spot / weak point / flag / This is hard. | The student can't name what they're being asked to do. | One glossary, applied in the UI and the connector descriptions. |
| B8 | L | Dead routes and stale states. | `/quiz/[slug]/[topic]` unreachable with a false empty state; `/welcome` + `profiles.onboarded` unused; `agenda.ts:48` comment stale. | | Delete or wire. |

### C. Cost and budget

| # | Finding | Evidence | Effect | Fix |
|---|---|---|---|---|
| C1 | **H (verified)** Reasoning at `medium` on every extraction step. | `src/lib/pipeline/budget.ts:4-17`; applied at `llm-server.ts:319`. | 3–4k reasoning tokens per map/objectives call billed as output ($10/M). | `low` for map, objectives, link, transcribe; measure from `model_usage`. |
| C2 | **H** Prompt caching is nominal and net-negative. | `prompts.ts:1-4` claims it; the cache prefix includes the per-step system prompt (`llm-server.ts:237-239,304-309`) and page subsets differ per part and topic (`run.ts:303,406,544`); every call pays the 1.25× write price (`pricing.ts:44-45`). | Paying for a cache that almost never hits. | Remove the breakpoint, or make the material the true prefix (one system prompt for the writing steps, material first, instructions after; send the whole part to `objectives`). |
| C3 | **H** When the budget is spent, `resumeNext` still dispatches every queued run. | `jobs/start.ts:150,290-292` (`mayRun` gates only `waiting`); `jobs.ts:144-150`. | A cascade: each queued file gets a Trigger run that loads pages, then parks. The import page reports them as "added". | Check the budget once in `resumeNext`; dispatch nothing when it's spent; the import summary counts waiting runs and says so. |
| C4 | **H** A waiting upload resumes up to a day late and the student can't touch it. | Budget days start at local midnight (`budget.ts:52`); the only sweeps are 05:10 UTC (`vercel.json`) and `useRun`'s check, which never fires for `waiting` (`useRun.ts:43,82-87`); the waiting card has no Stop/Remove (`UploadCard.tsx:103-110`) though `stopRun` accepts it. | A Pacific student's reset is 08:00 UTC; nothing moves until the next morning. | `POST /api/runs/check` on Uploads-tab load when any run is waiting; Stop/Remove on the waiting card. |
| C5 | M | Budget inconsistencies. | Per-student day local, global ceiling UTC (`usage.ts:87-89`); dives run beside uploads and both pass the once-at-start check; `grade.ts:67` self-marks every prose answer when the token day is spent (half credit: the student is penalised for uploading); `pagesSince` counts pages of runs that failed before a model call, and a retry's kept `at` escapes today's count; the 2M-token cap is model-agnostic. | | Grade from a separate, small allowance; count pages at claim; one budget clock. |
| C6 | M | Reconcile call volume. | `match.ts:60-63,80`: any shared 3-letter token including "the", "and" → a reconcile call per new objective. | ~15 model calls per later deck for matching. | Stop words + Jaccard ≥ 0.2, or one batched reconcile per objectives call. |
| C7 | L | Table of contents re-sent per part with UUIDs and full summaries. | `run.ts:291-300`. | ~13k tokens per map call at 150 topics. | Short refs as `link.ts:72` does. |
| C8 | L | Figure questions for .pptx are paid for then dropped. | `figures.ts:34-40`, `render-slide.ts:14-15`, `run.ts:740-745`. | | Tell the writer `figureSlide` must be null when nothing can render. |

### D. Pipeline and content correctness

| # | Finding | Evidence | Effect | Fix |
|---|---|---|---|---|
| D1 | **H (verified)** The chat-transcript role regex mangles ordinary lines. | `src/lib/material/ai-chat.ts:58-59,95-103`: the delimiter is optional and there's no word boundary. Reproduced: "Memory is byte-addressed" → "STUDENT: mory is byte-addressed"; "AI models are large" → "AI ASSISTANT: models are large". | Every pasted non-JSON transcript is corrupted and role-switched; the chat rules then weight the wrong speaker. | Require the delimiter or a word boundary after the role word; a bare role word is a label only when the rest of the line is empty or after a colon. |
| D2 | **H** Objective duplication across topics and granularities is unguarded. | New objectives reconcile only within their topic (`run.ts:402,418`); verdicts are same/new/uncertain, no "subsumes" (`prompts.ts:207`); Syllabus creates coarse objectives from schedule lines (`prompts.ts:81`). | Inferred skills recur under several topics; coarse syllabus objectives and fine lecture ones coexist (the owner's 78-objective syllabus will never match the decks' drills). | Course-wide exact-name check; a `subsumes` verdict that merges the coarse one; **Syllabus produces topics and `taught` hints, no objectives.** |
| D3 | **H (verified)** Removing a file archives objectives other files also teach. | `src/lib/server/materials.ts:273` archives every objective whose `material_id` is the removed file, regardless of `signals` from later uploads; the comment and `CLAUDE.md` claim "only it taught". | Mastery on those objectives disappears from the island; no repair except hand-confirming. | Skip objectives whose signals or topic `source` name another live material. |
| D4 | M | Top-ups and dives check anchors against the excerpt, not the file. | `topup.ts:155,232` omit `facts`; `run.ts:594,669-671`. | A valid "slide 12" anchor is refused when pages 10, 11, 13 were sent. | Pass `facts: materialFacts(...)` in both places. |
| D5 | M | One over-long string voids a whole model call. | `openai-schema.ts:6-8,22-27` drops `maxLength`; the full reply is zod-parsed (`model.ts:124`). | One 121-char `exact` loses all 16 questions of a generate call. | Parse arrays element-wise; drop bad items with a reason. |
| D6 | M | The strong-phrase screen refuses legitimate course content. | `screen.ts:44-69` ("system prompt", "jailbreak" are STRONG); applied to generated names and questions (`run.ts:317,411-416,652-664`). | An LLM or security course loses topics and questions. | For generated text keep only imperative/role-tag patterns, or allow phrases present in the material. |
| D7 | M | A pasted chat can become the answer key. | `TRANSCRIPT_HEADER` sits inside a data block the policy says to ignore (`ai-chat.ts:48`); `deepPrompt` has no chat caveat; `topup.ts:71-74` ranks sources by place count. | The assistant's claims become the key for an objective. | Exclude "AI chat" from `sourceFor`; put the speaker rule in the system prompts, deep included. |
| D8 | M | Marked-passage tag capped at 40 characters. | `marked.ts:7` vs `limits.ts:23` (300) and the transcribe prompt asking for the mark verbatim. | Long marker descriptions drop every flag on the page. | `[^\]]*` or a fixed tag. |
| D9 | M | Exact-answer normaliser. | `grading.ts:39`. | ".5" ≠ "0.5"; "a_1" ≡ "a1". | Numeric compare (see A3). |

### E. Jobs, uploads and Canvas

| # | Finding | Evidence | Effect | Fix |
|---|---|---|---|---|
| E1 | **H (verify in production)** The Trigger.dev worker may not be able to advance the queue. | `src/lib/server/jobs/start.ts:31-36` throws when `ORCA_JOBS` is unset in production; a finishing job calls `resumeNext` through it (`run.ts:34,42`); `docs/SETUP-HOSTED.md` §2 step 4 doesn't list `ORCA_JOBS` among the task env vars. | Every job ends with "Couldn't start the next job"; a 30-deck import moves one file per daily cron. | **Tonight:** check the Trigger project's Prod env vars for `ORCA_JOBS=trigger` and the worker log of the last run. Then make the worker pass the mode explicitly instead of reading the env. |
| E2 | **H** A task killed at its time limit stays "running" for 40 minutes; Stop doesn't cancel the paid run. | `src/trigger/jobs.ts:16` (1800 s), `jobs/start.ts:55-60` (2400 s), `server/jobs/start.ts:73` stores `job_id` but nothing uses it. | Blocks every upload and top-up; a stopped run keeps calling the model for up to 30 min. | `runs.cancel(job_id)` on stop/remove; an `onFailure` hook that marks the run failed; shrink the dead margin. |
| E3 | **H** The Canvas import page hides progress and errors. | Loop ≤ 10 rounds (`import/canvas/page.tsx:107`) vs 6 imports/hour (`limits.ts:49`) → round 7 is a 429 shown as "failed"; any non-`CanvasError` in `importFile` (30 s timeouts, Storage errors) aborts the round with a 500; `remaining > 0` after 10 rounds is never shown; unreadable files are counted "failed" and linked, so never retried, and don't appear on the Uploads tab. | After 20 minutes of good importing the page says it failed. | Per-file try/catch → "skipped" with names; always render the partial summary + "Import again to continue"; exempt continuation rounds from the rate limit; list `remaining`. |
| E4 | M | Canvas dates land a day late for US students. | `src/lib/canvas/api.ts:71-76` takes the UTC day. | An 11:59 PM ET due date becomes the next day; exams, homework, unlock dates and `upcoming` are off by one. | Use the profile timezone (`timezoneOf` exists) or the Canvas course `time_zone`. |
| E5 | M | Dump rule, typing and classification are brittle. | `postedAtOnce` runs on unlinked picks (`server/canvas.ts:290,294`); a module item with no file record disables the dump check (`api.ts:173-177`); module names feed the type ("Midterm review" → every deck Past exam, `api.ts:95-96`); every "quiz" is an exam (`:82`); re-import never updates moved due dates. | Re-asked coverage questions; wrong types; 12 weekly quizzes drive exam cadences. | Compute the dump rule over all picks; type from file name first; a "quiz" is an exam only above a weight threshold or when named midterm/final; update linked dates on re-import. |
| E6 | M | Claim races. | `start.ts:383-387` lets an upload and a top-up both dispatch; the loser's claim hits the one-running index and the run is later failed as "never started"; `resumeNext`'s queue loop doesn't skip handed-off runs (`:289`). | Spurious failures; duplicate Trigger runs. | Clear `started_at` on a 23505 claim; skip `queued && started_at` in the queue loop. |
| E7 | M | A hand-off failure is reported against the wrong run. | `start.ts:260-267`. | The page says the new upload failed when an older one did. | Report the failed run's id. |
| E8 | L | Limits that bite. | `upload` 20/day (`limits.ts:39`) refuses file 21 of a folder while Canvas bypasses it; one Realtime channel + 5 s poll per unfinished card (40 decks = 40 channels). | | Count a batch as one; one channel per course. |

### F. Security and data

| # | Finding | Evidence | Effect | Fix |
|---|---|---|---|---|
| F1 | **H** SSRF through a student-chosen Canvas host. | `src/lib/canvas/client.ts:52` follows redirects on API calls; `:86-93` follows up to 5 download hops to any https host with no `isPublicAddress` check; `canvasSite` checks DNS only at connect (`server/canvas.ts:55-69`). | A student points Orca at their own server and makes it fetch internal hosts; bodies are stored as material. | Check every hop's resolved address (as `public-page.ts` does); re-resolve on every use. |
| F2 | **H (verified)** `removeMaterial` data loss: see D3. | | | |
| F3 | M | No rate limit on costly routes. | `/api/materials/text`, `/api/materials/web` (any public URL, 10 MB, bypasses the upload limit), `POST /api/canvas`, `/api/llm/models`, `/api/mcp/[token]` (none; a write per call). | Abuse and cost. | `LIMITS.rate` entries; a per-token MCP counter; 401s to `security_events`. |
| F4 | M | Structure saves are last-writer-wins with a stale `before`. | Jobs diff against the course read at start (`jobs.ts:219-220`); `applyUploadPlan` replaces `topics.source` wholesale (`apply.ts:11`); `save_structure` has no version check. | A remove during an upload loses its pruning; layout collisions. | A version column on structure rows (the activity-log plan's `updated_at` is the hook), or re-read and re-apply before saving. |
| F5 | M | Dead duplicate checks since the hash index went non-unique. | Migration `20261107110000`; `materials/web/route.ts:34` still relies on 23505. | The same URL can be added repeatedly, each starting a job. | Query like `materials/text/route.ts:56`. |
| F6 | M | Rendering bypasses the PDF hardening. | `render-slide.ts:16-21` runs pdf.js on the main thread, no worker/timeout/heap cap; `read-pptx.ts:504` unbounded regex parsing. | A crafted page can hang the job. | Render in the worker with the remaining budget; a time budget for pptx. |
| F7 | M-L | Browser-chosen `grader`/`source` on evidence. | `api/evidence/route.ts:31-33` accepts `grader: "rubric"` and `source: "deep-review"` from the client. | The graded-credit invariant is client-enforced. | Server derives grader from question kind; `/api/grade` returns a signed verdict. |
| F8 | L | Whole-row RLS update on `profiles`/`courses`; missing indexes; tables with no retention (`model_usage`, `security_events`, `pipeline_runs`, Storage orphans); `my_data()` ships the whole evidence log on every load. | | | Column grants; indexes on `pipeline_runs(status)`, `objectives(material_id)`, `questions(topic_id)`, etc.; a retention section in the activity-log plan. |

### G. Docs and dead code (clean-up list)

`CLAUDE.md:484-490` says production is both `inline` and `trigger`; `docs/BACKEND-ROADMAP.md:293,340,350` ("no vercel.json", "still inline", "300 pages") and §7 (four connector tools; there are five); `docs/TO-DISCUSS.md:184,368-370` (300 pages; "200–400k tokens per deck"); `MASTERY-PLAN.md` §4 (uploads write 2 per objective); the Canvas plan names `assignedDateFor` (doesn't exist) and lists unlock-date `upcoming` as out of scope (it's built); `limits.ts:13` "60 s" vs 300; `materials/route.ts:12` "not a PDF" (pptx allowed); `trigger.config.ts:3` "No project exists yet"; `start.ts:14` "hourly" sweep; `Generation` duplicated in `uploads.ts` and `jobs/start.ts`; `session.test.ts:315-328` tests an unreachable candidate; the activity-log plan names the old chat route and misses three newer hard-delete paths.

## 4. The plan

Ordered by what unblocks the product the owner chose, at the cost the owner set. Each phase is
one PR to `main`; Fix-mode checks per commit, the merge gate once per phase.

### Phase 0: stop the bleeding (this week, no cost change)

> **Status (2026-11-08):** landed on `phase-4`: D1 (chat role regex), D3 (remove-material archiving),
> F1 (every Canvas hop public-address checked), F5 (web duplicate by hash), E3 (import page: per-file
> skip, partial summary, `remaining`, the import limit holds the loop), E4 (Canvas dates in the
> student's timezone), C4 (check on Uploads-tab load; Stop/Remove on a waiting card), E2 (Trigger
> run cancelled on stop/remove; failure hook marks the run failed), F3 for text/web/canvas routes.
> Then (879065f) C3, A10 and the MCP route's rate limit. E1: `ORCA_JOBS=trigger` was missing from
> the Trigger project's Prod env vars and was set on 2026-11-07 (a flag top-up had sat queued behind
> it); the worker still reads the mode from the env. Phases 0–2 reached `main` in PR #6 (2026-11-08).

1. **Verify the Trigger worker** (E1): check `ORCA_JOBS` on the Trigger project; read the last
   run's log for "Couldn't start the next job". Make the worker pass the mode explicitly.
2. D1 chat regex; D3 remove-material archiving; F1 SSRF hop checks; F5 web duplicate check.
3. C3 no dispatch cascade when the budget is spent; C4 check on Uploads-tab load + Stop/Remove on
   the waiting card.
4. E3 Canvas import page: per-file skip, partial summary always, continuation rounds exempt from
   the rate limit, `remaining` shown. E4 dates in the student's timezone.
5. F3 rate limits on text/web/canvas/mcp; A10 connector session day.
6. E2 cancel the Trigger run on stop/remove; `onFailure` marks the run failed.

### Phase 1: make the scoreboard true (connector first)

1. **`check_answer`** (A1, B4): Orca grades. Choice and exact locally (free); prose through
   `gradeAnswer` on the owner's key with the grade rate limit and a small separate allowance (C5),
   falling back to `{needsSelfGrade, answer, rubric}` when it can't. Records full-credit evidence
   with `source: "connector"`. `questions_for` stops returning keys; `record_answer` keeps the
   self-grade path, stores the student's `response`, stays half credit.
2. A2 `verified` needs an unaided correct. A3 short-term: no expressions in `exact`, numeric compare.
3. A4 flag resets the FSRS card; A5 credit for a previously missed question on a later day; A6
   mix-up scoped to a day; A7 count askable only; A8 fading held until the review day.
4. Bump `RULES_VERSION`, re-record the hash; a snapshot test per rule.

### Phase 2: day one works, with or without Claude

1. **First-run state** (B1): after the first covered upload, Orca writes one ordinary question for
   the ten highest-weight objectives of the newest covered deck (about 10 cents at the default
   model, under a cent at the small one). The trail's START reads "Try 5 questions"; the sidebar's
   first card is "Warm-up · 5 min"; misses become weak spots. This is the one place the weak-points
   spec is bent (it ruled out a placement quiz): it's a warm-up on the current topic, not a
   placement across the course. **Owner's call (§5).**
2. **Connector v2** (B2, B3, B5, B6): `course_state(detail, topicIds)` with `budget` and `writing`;
   `next_questions(count, write)` that returns `pending {runId, state, retryAfterSeconds, resumesAt}`
   instead of an empty list; `INSTRUCTIONS` rewritten as a script; `set_exam` gains remove. Later,
   `propose_question` (Claude authors a question from the deck it's reading, validated by Orca's
   output validators, zero model cost) as the tight-budget unblocker.
3. B7 one glossary; the false "quizzable now" line; the dead `/quiz/[slug]/[topic]` route.

### Phase 3: cost (measure, then switch)

1. C1 effort `low` on extraction steps. Record `model_usage` before and after on one deck.
2. Run `npm run score:extraction` with the local ALD decks at the default model, then with
   gpt-6-luna for describe/transcribe/reconcile/link, then for map/objectives. Keep whichever holds
   the score. Per-step model config in `src/lib/pipeline/budget.ts`.
3. C2 fix or remove the cache breakpoint; C6 reconcile shortlist; C7 TOC refs; D5 element-wise
   parsing (also a quality fix); C8.
4. Only then revisit the token cap.

### Phase 4: Canvas import correctness (reading on import stays)

**Decided by the owner (2026-11-08):** the import keeps reading every file. With the reading steps
on the small model (`ORCA_READ_MODEL`, built the same day) a whole course costs about 30 cents to
read, so the "list files, read on demand" design is dropped: it would have traded a few cents for
a five-minute wait the first time a student practised an unread deck. What stays from it:

1. E5: the dump rule over all picks (not only unlinked ones); material type from the file name
   before the module name; a "quiz" assignment isn't an exam by default; re-import updates moved
   due dates and a changed syllabus.
2. D2's syllabus half: the syllabus produces topics and `taught` hints, no objectives.
3. The import summary counts runs held by the daily limit and says so (with C3).

### Phase 5: structure integrity

D2 course-wide objective dedupe + `subsumes`; F4 versioned structure saves; D4, D6, D7, D8; then the
activity-log and soft-delete plan, revised (keep `activity_events`, `updated_at`, `audit_log`;
rethink universal `forbid_delete`; add retention for `model_usage`, `security_events`,
`pipeline_runs`; the three hard-delete paths added since 10-27).

### Phase 6: hygiene

E6, E7, E8, F6, F7, F8, A9, A11, and the §3G clean-up list.

## 5. Decisions for the owner

1. **Who grades connector answers.** Recommend `check_answer` (Orca grades; prose costs about a
   cent a question on the default model). Without it the connector can't produce mastery (A1).
2. **A warm-up on upload.** Recommend yes: one question each for the ten heaviest objectives of
   the current deck, so a new student has something to do in the first minute (B1). The
   weak-points spec said no placement quiz; this is narrower.
3. **Syllabus → topics only, no objectives** (D2). Recommend yes; the 78-objective Circuit
   Analysis outline is the case against the current behaviour.
4. **Model per step.** **Decided 2026-11-08:** the reading steps run on the small model
   (`ORCA_READ_MODEL=gpt-6-luna`); question writing and grading stay on the strong one. The token
   cap stays at 2M until the quality of the small model's reading has been looked at.
5. **Canvas lite** (reading on demand). **Decided 2026-11-08: no.** Reading on import stays; the
   small model makes it cheap enough, and on-demand reading would add a wait before practice.
6. **A "quiz" assignment is an exam** (E5). Recommend no by default.

## 6. What's good (keep)

- The fold: pure, JSON-storable, versioned with golden hashes; same-millisecond ordering; throws on
  out-of-order events; `checkDueAt` kept apart from FSRS `card.due` so partial, early and self-marked
  answers can't postpone a check; "Don't know" as an honest miss; a grading failure records nothing.
- Weak points first is coherent: unflagged never due, flags are events with strength from source,
  manual flags override `upcoming`, old confusion rows replay as homework.
- Every table under RLS with composite owner keys; evidence, snapshots, runs, usage, security and
  tokens service-role-only; optimistic versions with stale-mark triggers; `NewerRulesError` for
  rolling deploys; server stamps time and derives topic/objective from rows.
- Part-wise reading with per-part failure isolation; strict schemas on both providers; untrusted
  text as data blocks with a policy in every system prompt; marker flags accepted only from vision
  pages; prices in one place with source and date; spend-limit errors never retried.
- One-running-per-student and per-material partial unique indexes; atomic claim; final save
  re-checks `running`; dead-run timing from the claim; retries keep course order.
- Canvas token AES-256-GCM with an HKDF key; downloads strip the bearer; everything imported is
  linked, so re-import is idempotent.
- The connector: pure protocol module with a fake-tools seam; tool errors aren't protocol errors;
  only the token's hash stored; revoke is instant; `said` is screened like a reflection note.
