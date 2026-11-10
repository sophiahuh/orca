# Cost log

Started 2026-11-10 (owner). What Orca costs per task, measured on real cases with a pass criterion
each, failures and retries included. Model and tool costs plus human fallback time at a stated
rate, divided by the tasks that passed. Success rate and human minutes are reported on their own.
When nothing passes, that is the result; there is no cost per success to report.

## Method

- **A task** is one thing a student would do: import a course from Canvas, paste a syllabus,
  upload a deck, start a dive, run a quiz through the Claude connector, remove material. Each row
  names its pass criterion before the attempt.
- **Model cost** is the metered spend in `model_usage` for the task's runs (`run_id`), in dollars,
  from `src/lib/pricing.ts` prices. A task with no model calls costs 0 there, not "free": its human
  minutes still count.
- **Tool cost** is what the hosting bills for the task. Today Supabase, Vercel (Hobby) and
  Trigger.dev (free tier) bill nothing, so it is 0 until a bill arrives; Claude for the connector
  is the student's own plan, not Orca's.
- **Human fallback** is minutes a person spent making the task happen or recovering from it:
  reconnecting, retrying, re-pasting, restoring, waiting on a screen that should not have needed
  watching. Study time itself is not fallback. Valued at the rate below.
- **Cost per successful task** = (model + tool + human) summed over every attempt, including the
  failed ones, divided by the number of attempts that met their criterion.

**Assumptions (change here, not in the rows).**
- Human time at **$30/hour** (the owner's estimate of a student founder's hour; placeholder until
  stated otherwise).
- Model prices as in `src/lib/pricing.ts` on the date of the row; until `ORCA_READ_MODEL` was set
  on Vercel and Trigger, every step ran on gpt-6.1-sol.
- Minutes marked ~ are the owner's recollection, not a timer.

## Queries (production project, SQL editor)

Spend per run, newest first, with the run's status:
```sql
select r.id as run_id, r.kind, r.status, r.at, u.model, sum(u.cost_usd)::numeric(10,4) as usd,
       sum(u.input_tokens + u.output_tokens + u.cache_write_tokens + u.cache_read_tokens) as tokens
from public.pipeline_runs r left join public.model_usage u on u.run_id = r.id
where r.owner_id = auth.uid() or true
group by r.id, r.kind, r.status, r.at, u.model order by r.at desc limit 50;
```
Spend by day and kind (grading has no run):
```sql
select date_trunc('day', at) as day, kind, model, count(*) as calls, sum(cost_usd)::numeric(10,4) as usd
from public.model_usage group by 1, 2, 3 order by 1 desc, 2;
```

## Log

| Date | Task | Pass criterion | Result | Model $ | Tool $ | Human min | Notes |
|---|---|---|---|---|---|---|---|
| 2026-11-07 | Paste the Circuit Analysis syllabus | Course has topics and objectives, material typed Syllabus | **Fail**: built (22 topics, 78 objectives) through the chat lane with the chat rules applied; removed on 11-08 | fill from query | 0 | ~10 | Led to the paste lane and the AI-chat type (shipped 11-08) |
| 2026-11-07 | Import ALD from Canvas | Dates on the calendar, syllabus saved, every deck read | **Fail**: dates and syllabus in; decks hit the 300-page day and sat waiting; Canvas disconnected by accident and reconnected with a new token | fill from query | 0 | ~25 | 300 → 1,000 pages; disconnect confirmation; waiting runs resume on the Uploads tab (all shipped 11-08) |
| 2026-11-07 | Dive into "Circuit variables and elements" | Quiz starts within 2 minutes | **Fail**: "Preparing your quiz" with no end; the run was held by the spent token day and the screen didn't say | 0 | 0 | ~5 | The preparing screen now says so (11-08) |
| 2026-11-07 | Quiz through the Claude connector | Claude asks an Orca question and records the answer | **Fail**: no questions existed for unflagged objectives; the flag top-up parked on the spent day; Claude promised "a few minutes" | 0 | 0 | ~10 | `next_questions`, `check_answer`, budget in `course_state` (11-08) |
| 2026-11-08 | Remove a failed upload from Circuit Analysis | The failed card goes; the course keeps what other files taught | **Fail**: the file's done run went too (same material), its objectives were archived; restored by hand | 0 | 0 | ~10 | Removal now archives only what no other file teaches (11-08); the course had one file, so this case still loses its source |
| 2026-11-08 | Re-paste the syllabus as Syllabus, then quiz through Claude | A Syllabus-typed material builds; Claude asks and Orca grades one question | pending | | | | After the 11-08 deploy |

## Totals so far

| | |
|---|---|
| Attempts | 5 (1 pending) |
| Passed | 0 |
| Success rate | 0 of 5 |
| Model $ | to fill from the first query (the three model-free fails are 0) |
| Tool $ | 0 |
| Human minutes | ~60, about $30 at the stated rate |
| Cost per successful task | **none: no task passed** |

Each fail above has a shipped fix beside it; the next rows are the same tasks run again on the
11-08 deploy, which is the number that matters.
