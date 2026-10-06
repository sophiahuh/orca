# B: 7c cost guard (2026-10-06, cloud container)

## Status

Done on `phase-4`, one commit after D's. Redone from scratch (the teammate's run of B stopped at
its session limit). Plan decision 10, layer by layer:

- **Metering.** `completeJson` (`src/lib/llm-server.ts`) reports every reply's token counts
  (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`)
  through a new `opts.onUsage`; `stepCaller` and `meter(ctx)` in `src/lib/server/model.ts` write
  them to **`model_usage`** (migration `20261005220000_cost_guard.sql`: owner, kind, run, model, the
  four token counts, `cost_usd`, time; RLS on, no policies, service role only). Prices are in
  `src/lib/pricing.ts`, copied from platform.claude.com/docs/en/about-claude/pricing on
  2026-10-06 (no `claude-api` skill exists in this environment; the page was fetched and the figures
  copied as written): Opus 5.5 $4 in, $20 out, $5 5-minute cache write, $0.20 cache read per
  million. A unit test fails if `ORCA_MODEL` has no price. Metering a call that can't be priced
  throws rather than writing a guessed cost.
- **Budgets** (`src/lib/jobs/budget.ts` decides, pure; `src/lib/server/usage.ts` reads): per
  student per day, in the student's timezone (`dayStartIn`), 300 pages (`LIMITS.pagesPerDay`,
  uploads: the pages of every upload run started today) and 2,000,000 tokens
  (`LIMITS.tokensPerDay`, every call's four counts); for everyone, `ORCA_DAILY_BUDGET_USD` per UTC
  day (unset = no ceiling, right only for development; `.env.example` gets it in 9b). A job checks
  once, right after claiming its run (`jobs.ts`): over a limit, the run goes to **`waiting`** with
  `progress: { stage: "waiting", reason, message }` and nothing is called. `/api/reflect`'s step
  caller checks before every call and answers 429 with the message. The grader is wired by
  integration (`meter(ctx)` and `checkBudget` are exported for it).
- **Resume.** As the plan's default: `resumeNext(ownerId)` runs when any of the student's jobs
  finishes (done, failed or waiting; `src/lib/server/jobs/run.ts`), and hourly in trigger mode
  (`resume-waiting` schedule in `src/trigger/jobs.ts`) for every student with a waiting run. It
  starts the oldest queued run, or the oldest waiting run whose budget now allows it (a held upload
  is skipped for a later top-up that fits), after moving it back to `queued` so the job can claim
  it. Inline mode has no schedule: a waiting run resumes when the student next starts or finishes
  a job, which the review screen's copy says ("Orca builds the topics and questions when the limit
  resets").
- **One job at a time per student.** A new upload or top-up whose student already has a run queued,
  waiting or running is recorded `queued` and not dispatched (`Generation`/`TopUpStart` gain
  `{ state: "queued", runId }`); the database enforces it too with a unique index on `owner_id`
  where `status = 'running'`, so a claim that would run two at once fails and the run stays queued
  (`job-store.ts` treats 23505 as "not mine to run"). A top-up's `objective_ids` are now stored on
  the run so a queued or waiting top-up can start later without the browser. Dead-run detection
  (W0) now judges only `running` runs by age: a queued run may legitimately wait behind a long
  upload, and the sweep starts it.
- **Rate limits** (`src/lib/server/rate-limit.ts`, `LIMITS.rate`): uploads 20 a day, reflection
  matches 10 an hour, grading 60 a minute, counted by `hit_rate_limit(owner, action, window,
  max)`: one `insert … on conflict do update … returning` on **`rate_limits`** (fixed windows;
  service role only; not executable by API roles). Over the limit a route answers 429 with
  `retry-after` and "That's 20 uploads in 1 day, the most Orca allows. Try again in …". Wired into
  `/api/materials` (starting an upload) and `/api/reflect`; `/api/grade` is integration's.
- **Bounded calls.** The SDK client runs with `maxRetries: 0` and `timeout: LIMITS.modelTimeoutMs`
  (10 min; a `generate` reply streams for minutes); `withRetries` retries at most
  `LIMITS.modelRetries` (2) times, only connection failures, 5xx/529 and a 429 **with**
  `retry-after`. A spend limit is recognised the way the API documents it
  (platform.claude.com/docs/en/api/rate-limits, 2026-10-06): the tier cap is a 429
  `rate_limit_error` with `details.error_code: enforced_spend_limit_reached` and no `retry-after`;
  a limit the owner set is a 400 whose message begins "You have reached your specified … API
  usage limits". Both become `LlmError` 429 with `spendLimit: true` and the message "Orca's model
  budget is used up for this month…", never retried. `max_tokens` per step were reviewed and kept
  (`budget.ts`: extract 16k, generate 24k, solve/ambiguity/agreement 8k, reflect 4k, reconcile
  2k; grading 1,024).
- **Screens.** The review page shows a `run-waiting` card with the run's message for a waiting run
  and "Waiting for your other upload to finish; this one starts next" for a queued one; the
  add-material page says the same when it hands over; the session end card shows the waiting
  message as the top-up's reason; `progressMessage` knows `waiting`.
- **The fake API** gained `fail.type: "spend-limit" | "rate-limit"`, answering as the real API
  does (429 without / with `retry-after`).

Tests: unit (`tests/pricing.test.ts`, `tests/jobs/budget.test.ts` incl. `dayStartIn` across DST,
`tests/jobs/jobs.test.ts` waiting for an upload and a top-up, `tests/jobs/start.test.ts` queueing,
`resumeNext` order and budget skipping, queued runs never dead, `tests/llm-server.test.ts` against
a fake fetch: spend-limit 429 and 400 never retried, a retry-after 429 and a 529 retried at most
twice, a 400 never, usage metered); pgTAP `08_cost_guard.test.sql` (both tables closed to
students, `hit_rate_limit` closed to API roles, atomic and per student/action, the one-running
index); e2e `e2e/cost-guard.spec.ts` (an upload past the token budget waits with the message and
no model call, the file kept; a second upload queues and runs after the first, every call metered
with a cost; a spend-limit answer fails the job once; the 21st upload start of a day is 429 with
`retry-after`).

## Monitoring (run with the secret key, e.g. in the Supabase SQL editor)

```sql
-- Top students by tokens and cost today (UTC).
select owner_id, count(*) as calls,
       sum(input_tokens + output_tokens + cache_write_tokens + cache_read_tokens) as tokens,
       round(sum(cost_usd), 4) as usd
from public.model_usage
where at >= date_trunc('day', now())
group by owner_id order by usd desc limit 20;

-- Everyone's spend today against the ceiling.
select round(sum(cost_usd), 2) as usd_today from public.model_usage where at >= date_trunc('day', now());

-- Runs held by a limit, with why, and students hitting limits repeatedly (worth a look).
select owner_id, kind, progress ->> 'reason' as reason, at
from public.pipeline_runs where status = 'waiting' order by at;
select owner_id, action, count(*) as windows_over_limit
from public.rate_limits where count > case action when 'upload' then 20 when 'reflect' then 10 else 60 end
group by owner_id, action order by windows_over_limit desc;
```

## Judgement calls (for TO-DISCUSS)

- **The daily token budget is 2,000,000 tokens per student** (about $8 of Opus 5.5 input, less
  with caching). The plan named a token budget without a number. One ALD deck of 40 slides runs
  about 200–400k tokens through the pipeline, so this allows a few decks a day.
- **The page budget counts uploads only.** A top-up sends excerpts of the stored pages, not whole
  files, so counting its pages would spend the budget on text the model never saw in full; its
  cost is bounded by the token budget. Deviation from "uploads and top-ups together", recorded.
- **Budgets are checked once per job, at its start.** A job that starts under the limits may
  overshoot by one job (bounded by the page cap and per-step `max_tokens`); stopping a job mid-way
  would waste what it had already paid for, and the pipeline isn't resumable.
- **`ORCA_DAILY_BUDGET_USD` unset means no global ceiling.** Production must set it; 9b adds it to
  `.env.example` and `docs/SETUP-HOSTED.md`. A default number would be a silent decision.
- **Spend-limit recognition** follows the documented shape; the fallback (a 429 without
  `retry-after` whose message mentions usage limits) covers an older response shape.
- **Metering failures throw.** A call whose usage can't be written fails the step after the model
  was paid: visible rather than a quiet hole in the budget. If this proves too strict in
  production, log-and-continue is a one-line change in `meter`.
- The review page's waiting block, the add-material copy and `useTopUp` were B's to edit (the
  plan's ownership table); `src/lib/uploads.ts`'s `Generation` copy gained `queued` too.
