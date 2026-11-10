# Upload pipeline: parallel preparation, ordered structure, parallel questions

**Status:** implementation plan reviewed and agreed by the primary agent and independent subagent after an adversarial pass; no runtime changes implemented. Written 2026-11-10 on `upload-pipeline-parallelism`, based on `origin/main` at `75c4758`. Review discussion and remaining assumptions are recorded below. Do not merge this feature or enable it in production just because the plan is reviewed.

**Owner direction:** prepare files concurrently, keep the course-index work ordered, then write questions concurrently. Cover single files, folders, and Canvas imports. Conditional database writes protect against stale snapshots; they do not replace semantic topic/objective reconciliation.

**Goal:** an upload's image reading and question generation no longer hold up another file's structure extraction. Preserve course-index reuse, source provenance, weak-point behavior, warm-up sizing, and reliable retry/stop behavior. Different courses may build structure concurrently, within a student's shared model and budget limits.

**Non-goals:** independent extraction followed by global semantic deduplication; new models or changed reasoning effort; generating questions for every objective; changing mastery rules; automatically finishing a browser upload whose bytes never arrived; replacing the existing Canvas file-selection rules; a general-purpose workflow platform.

## 1. Current system and constraints

Read these before implementing; current source wins over old plan status notes:

| Source | What it establishes |
|---|---|
| `docs/superpowers/specs/2026-10-25-course-index-design.md` | Topics reuse a course table of contents; objectives reconcile within their topic; sequential parts see earlier results. |
| `docs/superpowers/plans/2026-11-08-logic-review-and-plan.md` | Earlier cost estimates and queue fixes; estimates are not current stage measurements. |
| `docs/superpowers/plans/2026-11-05-weak-points-plans-b-c.md` | Marked passages, flag top-ups, and catch-up for flags arriving during work. |
| `src/app/add-material/page.tsx`, `src/lib/uploads.ts` | A folder/multi-file selection currently sends each file sequentially: hash, register, signed Storage upload, process. |
| `src/lib/server/materials.ts`, `src/lib/server/upload-reply.ts` | Verify actual bytes/hash, recognize duplicates, parse to sanitized numbered pages, mark material ready, start generation. |
| `src/lib/server/canvas.ts`, `src/lib/canvas/api.ts`, `src/app/import/canvas/page.tsx` | File picker; module/file ordering; syllabus/dates; sequential downloads within repeated roughly 200-second import requests; `canvas_links` prevents ordinary repeat imports. |
| `src/lib/jobs/start.ts`, `src/lib/server/jobs/start.ts`, `src/lib/server/jobs/run.ts` | One non-dive running job per student; dispatch inline or Trigger; next-run sweep, pause, stop, retry, waiting budgets. |
| `src/lib/jobs/jobs.ts` | Upload claims/checks budget/loads course, transcribes/describes pages, runs extraction and writing, saves everything together, records marked flags. |
| `src/lib/pipeline/run.ts`, `apply.ts`, `topup.ts`, `transcribe.ts` | Actual concurrency pools, `structureOnly`, objective-specific source pages, append plans, question validators and prompt deduplication. |
| `src/lib/server/job-store.ts`, `src/lib/supabase/app-rows.ts` | Fresh reads and partial-row diffs, but array fields such as sources/signals can still be replaced from stale snapshots. |
| `supabase/migrations/20261005170200_structure.sql` | `save_structure` is a transaction, not a semantic conflict resolver. |
| `supabase/migrations/20261030090200_dives_beside_jobs.sql` | Current unique running index excludes dives but serializes uploads/top-ups per owner. |
| `src/lib/server/usage.ts`, `src/lib/jobs/budget.ts`, `src/lib/limits.ts` | Budget checks assume one ordinary job per student and permit that job to overshoot. These assumptions cannot survive unrestricted concurrent jobs. |
| `.claude/skills/assessment/SKILL.md`, `.claude/skills/learner-evidence/SKILL.md` | Objective ownership, canonical filing, anchors, validators, immutable evidence; load before implementing affected code. |

Current background upload flow:

1. `processUpload` has already parsed the file into `material_pages` and returned material status `ready`.
2. `startUploadJob` queues an upload run; a database unique index arbitrates competing workers.
3. `processMaterial` claims it, checks budget once, loads the course, then transcribes scanned/handwritten pages and describes typed PDF figures (three model calls at once, up to four pages each).
4. `runUpload` splits text at about 60,000 characters per part; each part maps against the updated TOC, resolves topics, and extracts/resolves objectives. Topics run four at a time, with nested reconciliation pools.
5. It links topics, selects marked objectives and initial warm-up targets, writes questions, validates them, and renders needed question figures.
6. `applyUploadPlan` and `structureRows` save structure/questions/completed run together; marked flags are recorded afterward; the next student's job is dispatched.

Important existing behavior to preserve:

- Every selected file counts as covered. Each question has a canonical objective; its stored topic can become stale after a merge.
- Later uploads normally write only for confusion markers found in that upload. Other flags/top-ups/dives have their own writers. Initial warm-up writes one question for up to ten unmarked objectives, not ten per file.
- Rejected topics/objectives remain rejected; material-removal archives are distinct from student rejections.
- A failed upload retry retains its earlier position in the queue. It cannot undo structures already committed since it failed.
- Existing `job-store.save` checks status before a separate RPC. New writes must check cancellation/lease inside the committing transaction, closing that race.

## 2. Agreed architecture

One user-visible upload run, durable work records for its phases, and a database scheduler shared by inline and Trigger execution. Database claims decide who may work; Trigger queues/idempotency are an execution aid.

| Phase | Inputs and durable output | Scheduling |
|---|---|---|
| Admission/ingestion | Ordered manifest item, validated metadata, eventual canonical material or duplicate alias | Reserve order before concurrent work; browser/Canvas ingestion pool initially 2 files per operation. |
| Preparation | Existing sanitized pages plus checkpointed vision/figure results; preparation warnings | Initially 2 preparation workers per owner; all actual model calls use a shared limiter. |
| Structure | Prepared pages and a fresh course snapshot -> committed topics/objectives/relations, sources/signals, flag intents, question demands | Exactly one structure worker per course, in admitted order, through extraction AND commit. |
| Questions | Committed demands and fresh canonical objectives/material/stock -> validated append-only questions | Shared objective claims across upload writers, top-ups, and dives; actual model calls remain bounded. |
| Finalization | Settled mandatory phase work, warnings/failures and counts -> parent status/toast | Atomic, repeatable, no additional model call. |

The next file's structure can start immediately after the preceding structure commits, while the preceding upload is writing questions. A file without question demands finishes immediately after structure and required flag bookkeeping.

Keep the existing parsing route for v1. It already enforces file limits, byte validation and duplicate handling. Parallelizing its callers is sufficient; moving all parsing or Canvas downloading into new background tasks is a separate possible follow-up.

Do not hold a database transaction, database connection, or advisory transaction lock open across a model call. A durable lease owns the structure lane; a short transaction owns the commit.

## 3. Ordering, batch manifests, and ingestion

### Browser single-file/folder admission

- Add an idempotent server admission API. Before hashing/transferring any selected file, register a manifest containing a client batch UUID, ordered item UUIDs, relative names, sizes and existing per-file metadata. Validate owner/course, maximum batch size, file kinds and metadata; preserve existing upload rate-limit semantics rather than letting manifest registration bypass them. Browser uploads currently charge one start per file (20/day), while Canvas has its separate import gate (30 requests/hour). A batch is not one upload start. Charge each logical browser item once, not once on admission and again on process/retry delivery; rejected entries are terminal and do not block. Keep documented explicit user re-upload/retry policy distinct from an HTTP idempotency retry.
- A transaction locks the live course, allocates monotonically increasing `course_sequence` values for all accepted manifest entries, and records the request idempotency key. Request retries return the same entries/materials, never new positions.
- Preserve the selected `BatchList` order; make folder enumeration deterministic before showing it (natural filename order, stable relative-path tie-breaker). Reserve before the hash/Storage/parse pool, so a small later file cannot jump ahead of a large earlier file.
- Keep hashing, signed Storage upload, `processUpload`, size/page/time caps, unsupported-file errors, and "Upload again" semantics. Extend calls with the admission item ID, not an arbitrary browser-supplied sequence.
- Start a bounded ingestion pool of 2. Already parsed files may prepare while the browser sends other files. No `Promise.all` over an entire folder.
- An accepted but unfinished ingestion entry has a renewable lease. Suggested default: expire after 15 minutes with no ingestion/batch heartbeat, with worker read leases respected. Use a named constant and fake-clock tests. The existing 24-hour file cleanup is not a queue-unblocking mechanism.
- If the tab closes, files already ready in Storage may be processed/recovered when their completion is observable; do not promise recovery of bytes still on the user's machine. Entries that cannot recover become retryable ingestion failures when the lease expires; later entries proceed. A renewed lease cannot revive a cancelled or expired attempt without an explicit retry.
- Explicit unsupported/failed/cancelled items become terminal immediately. Never block the course behind a rejected file.
- Validate a content hash again on server bytes. Settle same-byte races before model preparation using an atomic `(owner, live course, verified byte hash)` claim. First server-verified copy wins, including its type/dates/handwritten metadata and original course sequence; do not merge metadata or reorder a canonical copy after prep starts. An ordinary duplicate aliases that material/run and releases its own ordering barrier immediately, without waiting for the canonical run to finish. Thus no early-alias/later-canonical dependency cycle. Manifest order is guaranteed for distinct nonduplicate entries. An explicit "Upload again" opts out and is a separate item. Deleting an alias must not remove the canonical material. This first-verified-copy policy is recorded as an assumption below.

### Queue selection

- Within a course, a registered earlier active item that is still ingesting/preparing blocks later structure work. This is intentional order preservation.
- Paused, stopped/cancelled, failed, duplicate-alias, and expired ingestion entries release that barrier. An earlier item waiting on budget stays pending; never label it abandoned simply because it waited a long time.
- Define the ordering barrier independently of parent upload status: an item participates only while its STRUCTURE phase is uncommitted, it is not paused, and ingestion/preparation/structure is not terminal-failed, skipped, cancelled, expired or an alias. In SQL terms the lane query must require `structure_committed_at IS NULL` plus those active-item predicates. An earlier upload whose questions are running/waiting/failed is OUT of this lane. Select the lowest sequence among barrier members; claim only once that head is prepared and can obtain budget/model capacity. Read fresh course state at the start of the claim. Test that A with committed structure and blocked questions does not block B.
- A retry/resume retains its sequence. If successors already committed, it runs against their current structure at the next available opportunity. It does not rewind them or preempt a running structure worker.
- Allocation order across two tabs/batches is the database transaction order, not timestamps or HTTP completion time. Different courses have independent lanes.
- UI order is manifest order; asynchronous completion does not reorder the file list.

### Text, websites, AI-chat pastes and syllabus

- All upload entry points use the same admission protocol. Text/web/chat routes register a singleton entry before their own fetch/read work; already-sanitized pasted pages go directly to preparation with no invented file transfer. Preserve existing public-URL protections, screening, material types and text/web rate limits. A failed fetch releases its barrier.
- A Canvas syllabus is an ordered already-ready session item, not a bypass that creates an unsequenced legacy upload run. Duplicate syllabus links keep their current behavior.
- Single browser file upload is a one-item batch. No code path may call the legacy `startUploadJob` without either finding its v2 admission or creating the appropriate singleton admission.

### Canvas imports and repeated 200-second requests

- Create a durable import session after the picker submission. Freeze selected ordered file descriptors from `pickFiles`, existing import links, and a syllabus item if needed. Reserve all course sequences before downloading any file. Keep dates/exams idempotent and separate from model work.
- Persist `importSessionId`; every continuation request resumes that session. Freeze only selected IDs and trusted metadata/order, not signed download URLs or bearer tokens. Resolve fresh URLs and the encrypted connection at ingestion time.
- A session has bounded ingestion claims. Two HTTP continuations may execute concurrently, but cannot claim the same item; abandoned claims expire safely. Limit download/Storage/parse work to 2 concurrent items initially.
- Retain the request time budget. Stop admitting NEW downloads before the deadline with a safety margin covering the existing download/parse timeout; settle started requests where possible, otherwise recover them by lease/checkpoint. Do not start a fresh long parse at second 199.
- Store truthful session-wide counts, not cumulative counts that double on every continuation. Return remaining/waiting/failed items and stable item/run IDs.
- Scope idempotency by owner, live Orca course, Canvas site/course/object identity, session and item. Concurrent sessions selecting the same Canvas file must resolve to one source ingestion/canonical material. A new session after deleting an Orca course may create a new live course; old source claims must not bind it to the deleted course.
- The existing `canvas_links` behavior for unreadable/skipped files remains explicit; transient download failures remain retryable and must not be permanently linked as successfully imported. An existing duplicate must be linked to its canonical material.
- Refreshing/reopening the picker resumes an identifiable active session or explicitly starts a new selection appended after it. New Canvas files or a different selection form a new frozen session; never mutate ordinals of an active manifest.
- Browser-driven continuation remains required for not-yet-downloaded items in v1. Closing the import tab does not silently complete those downloads. Renew the session ingestion lease while it is actively continued; expire abandoned entries so unrelated uploads are not blocked; resuming uses the same session/items.
- A disconnected/expired Canvas token stops further downloads with a clear reconnect error. Already parsed/prepared files continue without needing the token. Cancel/deleting the course revokes remaining ingestion claims.
- Preserve assignment dates, module order, file-picker choices, and syllabus treatment. No incidental fixes to Canvas classification rules in this feature.

## 4. Durable state and database contracts

Names below are proposed interfaces, not an instruction to generate these tables without checking existing conventions.

### Data additions

1. `upload_batches` / `upload_items`: owner/course, source (`browser`/`canvas`/single text or web), idempotency keys, immutable ordinal, ingestion status/lease, material/run link, duplicate alias, errors, and Canvas session metadata. Bounded metadata only; no raw file bytes in Postgres.
2. `pipeline_tasks`: parent run, phase (`prepare`, `structure`, `questions`, and required bookkeeping if separated), state, attempt epoch, unique lease token, dispatch token/time, heartbeat/expiry, dependencies and checkpoint version. Unique logical `(run, phase)`; a retry changes epoch, not the logical task identity. Question subwork uses demands/claims below.
3. Durable structure checkpoint: validated extraction output, created provisional IDs and dependency revision, stored once before commit when possible. Prepared pages remain in `material_pages`; no second full-file persistence layer. Persist only what's needed to resume/commit without paying for a successful phase again; bound/expire large private checkpoint payloads after terminal retention.
4. `question_demands` and `question_claims`: stable demand identity/origin, course, canonical objective, flavor, target policy, run/session dependencies and settlement. Claims bind a generation batch/attempt to stock reservations; parent runs can depend on demands fulfilled by another writer.
5. A single course warm-up allocation record, including selected objective IDs, desired counts and origin run. A retry resumes it, never creates a new ten-question allowance.
6. `courses.structure_revision` plus a course admission counter. Revision changes on taxonomy/source/signal/relation edits and material removal; not on question appends, run progress, layout-only positions, or evidence. Protect server-maintained fields from browser writes.
7. Model-call admission/reservation records, and per-material page-charge records, with explicit owner-local/UTC budget buckets and request/attempt identity.
8. Step observability: step/phase/attempt, elapsed time, outcome, input/output/cache tokens, cost, queue delay, retry/conflict and lease reasons. Add nullable fields or a linked event table; do not overload existing `kind` or rewrite historical usage.

**Persistence rationale:** the new state stores ordering before bytes arrive, phase completion, ownership across worker crashes, demand sharing, and concurrent budget reservations. Existing `pipeline_runs` cannot represent overlapping phase attempts or immutable folder/import order; in-memory promises/Trigger-only keys cannot enforce the same behavior in inline mode. Record this rationale in `docs/BACKEND-ROADMAP.md` when implementation starts.

### Atomic APIs

Service-only RPCs validate owner/course/material relationships; no client can claim tasks or spend budget directly. Public manifest APIs authenticate/authorize through existing route helpers and enforce quotas. Existing user-facing reads use RLS; private checkpoints, leases and reservations have no browser write policies.

- `admit_upload_batch(...)`: allocate order and idempotent items atomically for the live course.
- `claim_pipeline_task(...)`: test dependencies, earliest-entry barrier, per-owner limits and per-course structure exclusion; claim with epoch/lease. Database constraints back up scheduler checks.
- `checkpoint_preparation(...)`: verify epoch/lease/material live and unchanged byte hash; persist page changes and warnings without accepting late results from cancelled/replaced workers.
- `commit_upload_structure(...)`: lock course and task, validate lease/epoch, parent cancellation, live material, preparation/hash identity and expected structure revision; apply validated structural changes; record structure completion, flag intents, warm-up allocation and question demands atomically. Release the structure lane in the same transaction.
- `claim_question_work(...)`: canonicalize objective merges, lock targets in stable ID order, calculate fresh stock/unseen needs INCLUDING outstanding claims, reserve only uncovered work, and return immutable source/context references.
- `commit_question_work(...)`: lock/revalidate canonical targets, live origins/sources and stock; append only still-needed validated questions, deduplicate by the existing `promptKey`, settle reservations/demands and run counters transactionally. Never save a full stale question bank.
- `stop/retry/finalize`: transition parent/child state and revoke/increment affected epochs atomically; downstream saves cannot race past these guards. Pause instead sets an inhibit-next-claims flag and DOES NOT revoke the currently active phase lease: that phase may commit its checkpoint/results before the parent becomes paused. A paused question phase never reinserts an already-committed structure into the ordering barrier.
- Budget admission/settlement: see section 7; all cost-bearing entry points use the same mechanism.

RPCs must make an already-committed request repeatable after a lost response. Store stable operation IDs; question UUIDs are random once and retained in the persisted generation checkpoint across commit retries. Do not generate new IDs when only retrying a transaction.

### Parent run status and progress

Keep one upload card and one final upload toast. Preserve existing `RunStatus` values where possible; add explicit phase/checkpoint summary fields instead of pretending `done` means just structure committed.

- `queued`: no stage currently running; phase label explains ingestion/preparation/structure/question wait.
- `running`: at least one phase actively executing; structure may already be visible.
- `waiting`: remaining work is held by budget; committed structure remains usable.
- `paused`: no queued upload stage may newly claim; see pause policy below.
- `done`: required structure/flag bookkeeping and all attached question demands settled, including documented dropped/unwritable work. Warnings remain in `dropped`.
- `failed`: hard stage failure/cancellation is explicit. When structure already committed, label "Topics added; question writing failed" and offer phase-only retry.

UploadCard deletion/copy must derive "unbuilt" from `structure_committed_at IS NULL`, never from parent `queued`/`paused` alone: queued questions may already have saved topics. Use monotonic progress/versioned phase updates; don't let stale prep/progress callbacks overwrite a newer phase or terminal status. A structure-ready change triggers a safe store refresh without waiting for terminal `done`; existing local save ordering must be honored. Final `done`/`failed` triggers existing grouped toasts once, not once per child task.

## 5. Extraction, conditional updates, and course edits

- Extract the image-reading work from `processMaterial` into a resumable preparation operation using existing `transcribePages`/`describeFigures`; store each successful page/batch promptly. A failed batch preserves text and reports warnings as today; all-image material with zero readable pages still fails honestly.
- Refactor `runUpload` into explicit structure extraction and question-demand selection; initially preserve all map/objective/reconcile/link prompts, validation, part ordering and local pools. Existing `structureOnly` is a useful seam, not a complete split: warm-up, marker flags and writing targets need explicit handling.
- At structure start, read a consistent course snapshot and its revision (one RPC/snapshot transaction, not independent reads around edits). Each following part still sees earlier parts' accepted topics/objectives.
- Inside `commit_upload_structure`, compare revision AND lease with current state. Source lists/signals are union/appended idempotently by provenance; never overwrite a newer array with a stale list. Existing topic names, review/rejection status and student edits must not be blindly restored.
- A conditional failure writes no partial structure/demands and does not release the lease as a success. For v1, reload and retry the structural extraction at most twice; keep all prepared pages. Checkpoint reuse is allowed only with an identical input/dependency fingerprint. Record extra paid calls and conflict counts. After repeated edits, give a retryable conflict rather than looping indefinitely.
- Do not promise an automatic semantic rebase of every extraction plan. A later optimization may rebase harmless source-only deltas if all touched identities/rejection rules are provably unchanged. A rename/merge/rejection may require another model reconciliation.
- All structure writers (browser `save_structure`, material removal, relink and server upload commit) must participate in the same short commit locking/revision protocol. Audit and guard read-modify-write paths such as material removal; incrementing a revision alone does not make THEIR stale writes safe. Do not put model calls inside those locks.
- Question appends do not invalidate taxonomy extraction. Source removal, objective/topic archive/merge, and relevant semantic edits do invalidate/revalidate affected writes.
- Notes/marker preferences are snapshotted per phase when it starts. Preparation records the marker-notes hash; structure consumes the exact prepared marker interpretation rather than interpreting old OCR markers under newly edited settings. Later phases use current screened Notes for Orca. Record this behavior; a settings edit doesn't silently rerun all paid preparation.

## 6. Question coordination, flags, warm-up, and partial completion

### Target policies, not stale question counts

Represent work as durable desired stock policies evaluated at claim time:

- Upload-marked objective: preserve current `runUpload` initial-stock accounting exactly. It writes ordinary questions toward two existing questions, and its current `liveQuestions` count includes deep questions. Capture that quirk in a compatibility test; do not silently change it to quick-only stock in this scheduling feature. A later explicit bug-fix decision may change it. Flag top-ups already have their own quick-only eligibility policy.
- Warm-up allocation: one ordinary question for each of the persisted up-to-ten writable unmarked targets.
- Flag top-up: ensure askable quick questions for eligible flags still without them; coalesce repeated flags.
- Post-session top-up: current behavior is test `unseen < 2`, then ADD TWO, not fill to two (one unseen becomes three). Retain exclusion of answered/thumbs-down questions and encode a stable `(sessionId, objectiveId)` receipt. At claim, rerun fresh eligibility; if another writer already removed the shortage, settle without generating; otherwise reserve the two-question increment once. Do not reduce this to desired-unseen=2 or total-count=2.
- Dive: preserve the existing deep-review target sizing, reusable unused deep questions and request/session identity; do not treat it as ordinary quick stock.

A demand contains WHY work is requested; claims decide WHAT still needs writing now. Multiple upload/flag demands can be fulfilled by the same quick questions. A session refill must not become two extra writes because another request observed the same shortage. Stable operation IDs make repeated HTTP requests the same demand.

### Claims and final writes

- Scope active claims by owner/course/canonical objective and flavor. Acquire multi-objective batches in stable order and release unneeded locks immediately. Use one canonical resolver shared with catalogue/merge logic, not a different interpretation of `merged_into`.
- Uploads/top-ups/dive writers all use the same claim/commit path before enabling new concurrency. Keep quick and deep policy separate; preserve existing single in-flight dive-per-course/session behavior rather than introducing arbitrary simultaneous dives.
- Fresh source selection uses `pagesFor` and committed signals/ranges, including the just-committed upload. Avoid the current temptation to select pages from an old objective before its new source signal is applied.
- Recheck objective archive/merge, source material removal/hash and live demand origin at commit. A surviving objective does not justify publishing questions anchored to a removed file.
- If two in-flight objectives merge into one, canonicalize again under transaction locks; recalculate stock/reservations on the survivor and retain only still-needed output. Log already-paid surplus as dropped. `promptKey` alone is insufficient: four different prompts can still exceed a demand for two.
- Separate question-writing attempt failure from valid-but-rejected output. Preserve current validators and explicit dropped reasons; don't silently launch unlimited replacement calls to achieve a nominal count.
- If another worker fills the stock, mark dependent demands fulfilled without another model call. A parent upload must finish even when its question need was satisfied by a top-up.
- A stopped upload detaches only its demand origins; do not cancel another upload's or session's independent demand. Already committed questions remain; no deleting answered content.

### Marked flags and warm-up

- Structure commit persists stable `markerFlagId` flag intents AND their question demands. Record evidence via existing evidence/snapshot path; never write derived mastery directly. A crash between structure save and flag recording must leave recoverable intents, not silently lose flags.
- Record intents idempotently through a service-only transaction that locks the intent/parent, checks the current epoch/cancellation state, then delegates to the existing evidence/snapshot write logic. A separate status read before `recordEvent` is not sufficient fencing. Fence cancellation before new evidence writes. A flag already recorded is never erased by stopping a later phase. Log terminal bookkeeping failures explicitly and preserve a manual/retry path.
- Atomically reserve warm-up once per course at the first eligible successful structure commit. Choose at most ten writable unmarked objectives using the same weights and exclusion rules. Preserve the current gate: ANY existing bank question, including deep, prevents this initial warm-up allocation; it is not a quick-only empty-bank test. A course with existing questions does not get a new allocation merely because this feature is enabled.
- Later structure commits see the allocation even while the bank is still empty and do not allocate ten more. Question failure or demand sharing retries the same allocation. If no writable targets existed, do not mark a successful warm-up allocation with invented targets; allow a later eligible commit to allocate it.
- A deleted/merged warm-up target is followed to its live survivor or explicitly settled as unavailable; if retargeting is implemented it stays inside the original ten-slot allocation, never adds another allowance.

## 7. Concurrency, budgets, fairness, and cost visibility

Starting defaults to validate, not measured optimal values:

- Browser/Canvas ingestion: 2 files per operation, with server-side admission/rate limits.
- Preparation: 2 active files per owner.
- Structure: 1 active task per course.
- Model calls: 4 active requests per owner shared across ALL phases, plus a provider/project-level cap configured below the actual account limits. Existing nested pools must acquire this shared permit; "2 files" must not become 32 simultaneous reconciliation calls.
- Prefer interactive grading/dive/flag work over bulk upload work at the NEXT permit opportunity; do not preempt an already-paid call. Use aging/round-robin to prevent permanent bulk starvation. Do not let all permits be hoarded by preparation while interactive work waits.

### Budget correctness

The present check-once-at-job-start is removed for concurrent workers. A hard cap requires a reservation before each provider attempt, not just an in-memory semaphore or summing completed calls.

- Atomically reserve file pages once per material in the owner's local-day bucket before its first model preparation/structure work. Completed usage and active reservations are both counted. The same material/day is not charged twice for prep + structure + retry, consistent with current unique-material counting; a later-day restart follows the explicitly tested day policy.
- Before every provider attempt, reserve conservative input tokens (system/prompt/context/images/cache components) plus `maxTokens`, and a USD upper allowance at the selected model's applicable input/cache/output rates. Use provider-aware estimates with a safety margin/verified bound; do not pretend characters/4 is an exact multimodal upper bound. If a safe estimate isn't available, fail closed or use a documented conservative bound.
- Admission checks consumed + outstanding owner token reservations and global UTC USD reservations in one serialized transaction with deterministic lock order. All callers, including grading/reflection/relink and connector grading, participate; otherwise they race the background workers.
- Settle actual usage and release the unused reservation idempotently when the response reports usage. Each transient HTTP retry is a distinct provider attempt/reservation, while the logical stage/demand remains stable.
- A timeout/disconnect without usage is an UNKNOWN charged-attempt outcome, not a free call. Preserve a conservative charge/hold and a visible reconciliation path; don't return its entire allowance and retry forever. Expiring a task lease releases execution capacity only after fencing the stale worker, not evidence that the provider billed zero.
- Reservations have explicit expiry/heartbeat and original day/timezone buckets. Midnight, DST, timezone edits, a killed worker and late settlement must not double-refund, erase spend, or move charges into a different day silently.
- Count a request waiting for a permit differently from daily allowance exhausted. Near the cap, a conservative maximum-output reservation can defer a request that would probably be cheaper; show "not enough remaining allowance" honestly rather than claiming all tokens were spent.
- This deliberately replaces the old allowance to overshoot by one whole job with conservative per-call admission. Keep the existing numerical page/token/USD limits; no cap increase in this feature.

### Measurement

Persist per-phase queue/active durations and per-step token/cost/attempt data. Compare identical fake-model schedules in tests, then an explicitly authorized real-material benchmark before tuning concurrency/model choices. Report time to first committed structure, time to first usable questions, full folder/import completion, cost per unique material, conflict/retry cost, and peak calls. No real model benchmark is authorized by this plan alone.

Expect approximately unchanged model cost for the same successful calls. Extra paid retries on changed structure, cache differences and lost attempts are recorded, not hidden. Keep worker-compute totals separate from elapsed time and model dollars.

## 8. Failure, pause, stop, and recovery behavior

| Scenario | Required outcome |
|---|---|
| Folder completes out of order | Preparation overlaps; structure still follows admitted order. |
| First file is unsupported/unreadable | Mark that item failed/skipped, release barrier, build later valid files. |
| Tab closes during bytes/Canvas chunks | Ready items continue; unfinished ingestion expires visibly and releases barrier; reopen resumes stable session/items. |
| File parses successfully, process response lost | Same item/material and generation run returned; no second model job. |
| Same file arrives in two tabs/import sessions | Ordinary duplicate aliases canonical file before model prep; no duplicate structure/warm-up. |
| User explicitly uploads same bytes again | Separate material/provenance and ordered run, as current product allows. |
| Preparation partly succeeds, worker dies | Reuse saved vision/figure pages and warnings; only unfinished batches retried. |
| Structure commit succeeded, response lost | Retrying operation finds committed phase/demands; never re-extract. |
| Question call succeeds, commit response lost | Stable generated checkpoint/IDs and idempotent commit; no second paid call. |
| Worker dies after paid reply but before checkpoint | May require another paid attempt; log uncertainty/attempt cost. Cannot promise exactly-once provider execution. |
| Question phase hard-fails | Structure remains; next file already proceeds; retry only question/bookkeeping work. |
| Budget exhausted between phases | Checkpoint persists; parent waiting names remaining work; no rerun of successful phases next day. |
| Warm-up questions lag behind several structures | One persisted allocation; no ten-per-file generation. |
| Flag arrives while writers run | Coalesce/extend demand and schedule uncovered work; no lost late flags. |
| Rename/merge/reject during structure | In-transaction revision failure; bounded fresh structure retry, no overwriting the edit. |
| Merge during two question writes | Canonical survivor stock/claims rechecked atomically; surplus output dropped visibly. |
| Source material removed during question write | Reject that source's pending output; leave existing committed content/evidence under current archive rules. |
| Stop after structure saved | Keep saved topics/flags; cancel remaining upload-owned work, label partial completion; don't stop others' demands. |
| Delete course during any phase | All pending/active child attempts fenced; commits refuse deleted course; best-effort cancel Trigger/provider work. |
| Lost dispatch/duplicate Trigger delivery | DB claim gives one valid owner; durable task outbox and sweeper retry dispatch without creating another logical phase. |
| Old worker wakes after retry/lease expiry | Every checkpoint/evidence/commit requires matching epoch/lease; late writes refused. |
| One course is busy | Another course may proceed, subject to shared owner permits/budgets. |

Pause policy for v1: preserve queued-upload semantics. Pause prevents new upload phase claims; it does not revoke an active phase epoch/lease. An already-running phase finishes its checkpoint/results commit, then no later upload phase starts. The per-course active structure constraint remains held until that running phase settles, even when the parent pause flag is set. Pausing must work for prepared/structure-ready/question-ready entries even when parent status is `running` due to another phase. "Stop" is the immediate fencing operation. Other users' jobs and independent top-up/dive demands are unaffected. Paused entries release the ordering barrier; resume is non-retroactive as described above. Update copy so this distinction is explicit.

The durable task row is the dispatch outbox. Commit the next runnable task/demand before dispatch. Use deterministic Trigger idempotency keys containing logical task ID + epoch; record handoff/claim separately. Sweeps recover unclaimed dispatches and expired attempts with phase-specific limits. Inline mode uses the same claims/dispatcher with `after()` and bounded execution, not a recursively awaited chain of every future upload. Remaining work is discoverable on a later request/sweep; production uses Trigger.

## 9. Implementation tasks and validation

Implement task-by-task on this branch. Do not write the whole feature as one unreviewable migration/commit. Read relevant Next.js bundled docs before route/action changes, and installed Trigger task/queue docs before task API changes. Tests use fake model callers and local Supabase only.

### Task 1 — Baseline instrumentation and pure contracts

Files: `src/lib/server/model.ts`, `src/lib/llm-server.ts`, `src/lib/server/usage.ts`, `src/lib/jobs/jobs.ts`, `src/lib/pipeline/run.ts`; new pure phase/order/demand types under `src/lib/jobs/`.

- [ ] Add nullable step/attempt/duration measurement while keeping historical usage readable.
- [ ] Specify state transitions, task/claim payloads, canonical stock policies, lease constants and concurrency settings as pure types/functions.
- [ ] Separate wait-for-capacity from budget-waiting/error outcomes; extend progress display without inventing time estimates.
- [ ] Verify unchanged pipeline outputs with fake callers and existing extraction tests.

### Task 2 — Additive schema, owner isolation, admission and leases

Files: new migration(s), new pgTAP files; `src/lib/supabase/database.types.ts`, server scheduler/store adapters.

- [ ] Recheck newest migrations on main before numbering (currently main ends at `20261110120000`; other branches may reserve newer timestamps).
- [ ] Add manifest/session/task/checkpoint/demand/warm-up/reservation structures and protected course counters/revision.
- [ ] Implement atomic ordered admission, idempotency, owner-scoped task claim, in-transaction fences and structure snapshot/commit contract.
- [ ] Keep legacy running index and behavior until rollout gate; add new constraints disabled-by-routing, not by dropping safety early.
- [ ] pgTAP: two simultaneous claims, earliest pending barrier, same-course exclusion/different-course admission, lease expiry, cancellation-vs-commit, cross-owner/course injection, idempotent lost-response commits, permission checks, revision behavior.

### Task 3 — Shared model permits and budget reservations

Files: `src/lib/server/usage.ts`, `src/lib/jobs/budget.ts`, `src/lib/server/model.ts`, `src/lib/server/grade.ts`, `src/lib/llm-server.ts`, limits; DB reservation RPCs.

- [ ] Route every paid provider attempt through shared admission/settlement; preserve provider retry limits and model selection.
- [ ] Add page accounting that includes active preparations, idempotent actual usage, and unknown-response accounting.
- [ ] Test simultaneous near-limit calls/courses, all shared call types, retries, failed metering, unknown usage, midnight/DST/timezone changes, stale leases, late settlement, permit fairness and release.
- [ ] Do not enable parallel stages until this gate passes.

### Task 4 — Browser manifests and bounded folder ingestion

Files: new authenticated admission route(s), `src/app/add-material/page.tsx`, `src/lib/uploads.ts`, `src/components/upload/BatchList.tsx`, `src/lib/server/materials.ts`, `src/lib/server/upload-reply.ts`, `src/app/api/materials/text/route.ts`, `src/app/api/materials/web/route.ts`, their server import helpers, cleanup.

- [ ] Register ordered/idempotent batches before hashing; attach items to canonical material/run after byte validation. Adapt single files, pasted text, AI chats and websites as singleton admissions, and Canvas syllabus as a session item; test that no existing upload entry point bypasses the structure lane.
- [ ] Run two ingestion workers, preserving per-file metadata/errors and displayed order.
- [ ] Implement renewal/expiry/cancel and duplicate aliases; do not claim browser-byte recovery that cannot happen.
- [ ] Browser tests: folder with deliberately delayed first file, mixed valid/invalid files, repeated POST, tab close/reopen, same-byte race, explicit Upload again, batch-level rate-limit behavior.

### Task 5 — Canvas sessions and bounded ingestion continuations

Files: `src/lib/server/canvas.ts`, `src/lib/canvas/api.ts`, Canvas routes, `src/app/import/canvas/page.tsx`, tests/Canvas fixtures.

- [ ] Freeze picks/syllabus and allocate manifest order once; persist and pass session ID across all chunks/retries.
- [ ] Atomically claim up to two ingestion items; preserve download credential boundaries and request deadline margin.
- [ ] Deduplicate simultaneous import sessions/source objects and preserve readable import outcomes/counts.
- [ ] Tests: multiple200s chunks, out-of-order downloads, retry after material ready but before canvas_link, two import tabs, picker subset/new selection, syllabus-first ordering, expired token, deletion/new live course, abandoned session resumed after successors commit.

### Task 6 — Resumable preparation and ordered structure

Files: split `src/lib/jobs/jobs.ts` into focused phase operations, pipeline `run.ts`/`apply.ts`/`transcribe.ts`, scheduler/store adapters, material removal/relink/structure writes.

- [ ] Checkpoint successful page reads before mapping; preserve warnings/all-image failure behavior and byte-hash validation.
- [ ] Extract structure and writing-target planning while preserving current prompts/validators/part order.
- [ ] Claim per-course lane, load coherent snapshot, commit fenced deltas/revision/flag intents/demands, release lane before writing questions.
- [ ] Implement bounded structural retry on conflicting user edits; do not re-run committed extraction.
- [ ] Tests: file2 prep finishes before file1, independent course overlap, shared topic/objective reuse, source union, preserved rejection/merge, conflict retry bound, stop/remove/delete race, next structure starts while first questions are blocked.

### Task 7 — Shared question coordinator and once-only warm-up

Files: `src/lib/pipeline/run.ts`, `topup.ts`, new demand/claim helpers, job-store, top-up/deep entrypoints, marker flag recovery, warm-up allocator.

- [ ] Persist policies and warm-up selection at structure commit; route upload/top-up/dive writing through canonical claims and append-only commit.
- [ ] Preserve normal/deep sizing, asked/down exclusions, source selection, code validators, figure checks and random stable question UUIDs.
- [ ] Settle dependent runs when another writer fills their demand; propagate cancellations only to the correct origins.
- [ ] Tests: two uploads flag same objective, upload+flag+session-topup overlap, quick/deep distinction and dive session identity, merge two claimed objectives, remove source during paid write, warm-up while bank empty across five structures, retry question-only, invalid outputs, exact prompt duplicates, no source anchors for inferred objectives.

### Task 8 — Scheduler/Trigger/inline recovery and user-visible stages

Files: `src/lib/jobs/start.ts`, `src/lib/server/jobs/start.ts`/`run.ts`, `src/trigger/jobs.ts`, `src/hooks/useRun.ts`, store, upload cards/controls/toasts and connector writing/budget summaries.

- [ ] Replace whole-owner job selection with stage-aware DB claims/outbox recovery and phase-specific heartbeats/limits. Every legacy-compatible start/sweep must filter `protocol_version`; no old whole-run dispatcher may claim v2 parents.
- [ ] Derive parent status from durable work; refresh structure-ready data, report partial failure, keep a single terminal upload toast.
- [ ] Update Pause/Stop/Try again/remove semantics, import summary and connector writing status; keep data-part hooks stable where possible.
- [ ] Tests: dropped handoff, duplicate delivery, dead worker, retry with newepoch, non-retroactive resume, partial-save UI, budget wait between stages, no duplicate toast, inline/Trigger adapters obey same claim contract.

### Task 9 — Integration, rollout, documentation

- [ ] Run targeted fake-model and pgTAP concurrency tests; use actual two-connection transactions for races, not only sequential mocks.
- [ ] Run the full repository merge gate once: typecheck/lint/build as applicable, unit tests, locked database/browser/isolation/evidence checks. Local reset requires existing environment authorization; never use hosted student data for tests.
- [ ] Benchmark fake latency with controlled barriers (avoid fragile elapsed-time thresholds). Demonstrate prep overlap, per-course structure exclusion, question overlap, and global model permit cap.
- [ ] Update `CLAUDE.md`, `docs/BACKEND-ROADMAP.md`, setup/job env docs and any changed route/status contracts.
- [ ] Record any real benchmark separately, only with explicit authorization; do not claim production speedups from fake timing.

## 10. Deployment and compatibility gates

This is a multi-worker protocol change. A feature flag alone cannot make old unfenced workers safe beside new ones.

1. Ship additive schema, nullable instrumentation, version-aware readers/UI and new worker code with staged dispatch OFF. Existing behavior remains supported; don't drop old constraints yet.
2. Pause NEW generation admission using an operator maintenance switch; uploads can be clearly queued/stored while preparation/extraction admission is paused. Drain or explicitly cancel all legacy upload/top-up/dive workers, including handed-off Trigger runs and long inline after() chains. Verify both database state and worker platform; don't infer drained from a lease timeout alone.
3. Under the gate, backfill unfinished queued/waiting/paused runs into deterministic manifest/task state, preserving original order and pause/wait reasons. Done history is unchanged; failed-history retries use new protocol. Flag legacy completed warm-up courses as already allocated when appropriate; no accidental new warm-up for established courses.
4. Install final guarded commit/revision paths and replace the one-running-per-owner index with stage/course and objective claim constraints. Refuse legacy worker commit payloads after the cutover; the generic browser structure API remains authenticated/authorized and revision-aware. Increment protocol version and verify every worker supports it before enabling admissions.
5. Enable staged dispatch at concurrency1, verify recovery/idempotency and user-visible progress, then increase prep to2 and shared calls to4. Do not enable new parallel writers before legacy writers are drained and new question/budget claims are universal.
6. Rollback disables new admissions and drains/cancels new phases while leaving committed structure/checkpoints intact. Reverting to old application code is NOT safe until new task state has been deliberately migrated/drained; no deleting new tables or replaying completed extraction as a shortcut.

Include a migration rehearsal with legacy queued, handed-off, running, waiting and paused runs; a crashed v2 worker; mixed browser versions; rollback after structure-only commit; and late legacy task delivery. Never deploy or push hosted migrations as part of writing this plan.

## 11. Review record and assumptions

Owner-approved architecture: parallel preparation, ordered structure, parallel questions; use this branch based on main. The numeric concurrency settings, ingestion lease interval and conservative near-budget admission policy above are proposed implementation defaults, not measured product promises.

Discussion with independent reviewer `upload_plan_review`:

- Both agree order must be allocated before async ingestion and enforced by the database, not inferred from which file finishes first.
- Both agree the structure queue includes index-dependent model work through commit; a lock only around the final save cannot resolve semantic duplicates.
- Both agree on a parent run plus durable phase records, a task outbox, atomic epoch/lease fences inside every committing RPC, and a taxonomy revision excluding question appends.
- Reviewer identified warm-up multiplication, Canvas manifest drift across continuation requests, merged-objective claim collisions, and the existing status-check/save race. Each has an explicit contract and test above.
- Both reject a general semantic-rebase engine in v1. Bounded structural re-extraction after meaningful revision conflicts is simpler and honest about extra model cost; cached preparation remains reusable.
- Both agree to preserve original retry ordinals without pretending already-committed successors can be rewound.
- Final full-draft adversarial review completed: reviewer agrees, with no remaining specific architectural blockers. Resolved additional objections: ordering excludes structure-committed parents even if questions are active; text/web/chat/syllabus cannot bypass admission; ordinary aliases release barriers without canonical dependency cycles; session top-ups retain add-two semantics; marker/warm-up deep-question counting quirks remain unchanged; Pause does not revoke an active phase lease; evidence intent fencing is transactional; legacy dispatchers cannot claim v2 parents. Proposed defaults remain subject to validation, not a speed/cost promise.

Assumptions to call out before implementation:

1. Folder ordering is the displayed, deterministically enumerated list, not file-completion order; separate batches use server admission order.
2. Earlier paused/failed/abandoned entries don't block later structure; resuming never rewinds history.
3. Structure may appear before questions finish. A late question failure retains topics and offers phase-only retry.
4. Existing budget ceilings stay numerically unchanged, with more conservative admission near the limit to make concurrency safe.
5. Canvas continuation remains browser-driven for missing bytes in v1; moving downloads to durable workers is intentionally deferred.
6. Ordinary byte duplicates use first server-verified-copy metadata and its sequence; aliases release their barrier immediately. Explicit Upload again is separate.
7. Pause lets the active phase checkpoint/finish; Stop fences remaining writes immediately. Already committed structure, questions and evidence are kept under existing archive/merge rules.
