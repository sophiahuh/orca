# Setting up the hosted services (owner's checklist)

What the owner sets up so Phase 4 can be checked live (plan Task 10,
`docs/superpowers/plans/2026-10-05-orca-phase4-supabase.md`). Tasks 1–9 don't need any of it:
they run against local Supabase, inline jobs and a fake Anthropic API. Dashboard menu names drift;
if one below doesn't match, look for the closest equivalent.

**Never paste a key, token or password into a chat.** Keys go into the Claude Code cloud
environment's settings (the cloud environment menu in the session's title bar → Edit →
environment variables), Vercel's project settings, and Trigger.dev's dashboard. A new session
picks up environment changes.

## 1. Supabase

1. Create a project at supabase.com. Pick the region closest to the students (for Columbia,
   US East). Keep the database password somewhere safe (a password manager).
2. **API keys** (project settings → API keys): note the project URL (`https://<ref>.supabase.co`),
   the publishable key (`sb_publishable_…`) and the secret key (`sb_secret_…`). The older
   anon / service_role keys do the same jobs. The secret key bypasses row-level security: it
   goes only into server-side settings, never into anything with `NEXT_PUBLIC_` in front.
3. **Email sign-in** (Authentication → Sign In / Providers → Email): enabled, "Confirm email"
   on, minimum password length 8. If the plan offers leaked-password protection, turn it on.
4. **URLs** (Authentication → URL Configuration): Site URL = the production address
   (`https://orca-lake-omega.vercel.app` until there's a domain). Redirect URLs:
   the production address with `/**`, `http://localhost:3000/**`, and Vercel's preview pattern
   for the project if previews should sign in.
5. **Emails to real students** (Authentication → SMTP Settings): Supabase's built-in sender is
   for testing (very low limits). Before real students sign up, connect an email provider
   (section 4).
5b. **Email templates** (Authentication → Email Templates): change the link in *Confirm signup* to
   `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=signup&next=/` and in *Reset
   password* to `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery`. With these,
   a link works from any browser or device (the default links only work in the browser that asked).
   The Site URL from step 4 must equal the app's `SITE_URL` (section 5).
6. **For the agent to push migrations**, create a personal access token (supabase.com account →
   Access Tokens).

The agent applies the migrations (`supabase link` + `supabase db push`) and runs
`npm run check:isolation` against the project. Don't create tables by hand in the dashboard: the
migrations in `supabase/migrations/` are the source of truth.

## 2. Trigger.dev

1. Create an organisation and a project at cloud.trigger.dev. Note the project ref (`proj_…`).
2. **API keys** (project → API keys): the dev secret key (`tr_dev_…`) and the prod secret key
   (`tr_prod_…`).
3. **For the agent or CI to deploy tasks**: a personal access token (account → Personal Access
   Tokens, `tr_pat_…`).
4. **Environment variables for the tasks** (project → Environment Variables, for Prod and Dev):
   the model key (`OPENAI_API_KEY` or `ANTHROPIC_API_KEY`, plus `ORCA_MODEL_PROVIDER` if set),
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`
   (the names `src/lib/supabase/env.ts` reads), and `ORCA_DAILY_BUDGET_USD` (the jobs check it).
   Tasks run on Trigger.dev's machines, so they need their own copies.
5. **Deploy the tasks** (separate from Vercel; again whenever the job code changes): put
   `TRIGGER_PROJECT_REF=proj_…` in `.env`, then `npx trigger.dev@latest login` and
   `npx trigger.dev@latest deploy`. On Vercel set `TRIGGER_SECRET_KEY` (`tr_prod_…`) and
   `ORCA_JOBS=trigger`, and redeploy.

## 3. Anthropic or OpenAI

Create an API key for Orca's server: at console.anthropic.com, or at platform.openai.com
(`OPENAI_API_KEY`; set `ORCA_MODEL_PROVIDER=openai` to make the choice explicit). Set a monthly
spend limit on the workspace or project either way. Unset, the provider is OpenAI when its key is
set, else Anthropic (`src/lib/model-config.ts`). The same key unlocks the extraction baseline
(`npm run score:extraction`), so it's worth adding to the cloud environment first.

## 4. Email provider (before real students, not before testing)

A provider such as Resend or Postmark: verify a sending domain you own (DNS records), create
SMTP credentials, and enter them in Supabase's SMTP settings (sender e.g.
`Orca <noreply@your-domain>`). Then send yourself a sign-up and a password reset to check they
arrive.

## 5. Vercel

Project `orca` → Settings → Environment Variables (Production, and Preview if previews should
work):

| Variable | Value | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | project URL | public |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | publishable key | public |
| `SUPABASE_SECRET_KEY` | secret key | mark sensitive |
| `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` | the model key | mark sensitive |
| `ORCA_MODEL_PROVIDER` | `openai` or `anthropic` (optional) | unset: OpenAI if its key is set, else Anthropic |
| `ORCA_MODEL` | optional model override | must be priced in `src/lib/pricing.ts` |
| `ORCA_JOBS` | `trigger` (or `inline` until Trigger.dev is set up: jobs then run inside the request, fine for short decks) | |
| `TRIGGER_SECRET_KEY` | `tr_prod_…` | mark sensitive |
| `SITE_URL` | the production address | emailed links come back to it; production refuses to send links without it |
| `ORCA_DAILY_BUDGET_USD` | e.g. `25` | the service-wide daily ceiling on estimated model spend; unset means none |
| `CRON_SECRET` | a long random string (`openssl rand -hex 32`) | mark sensitive; turns on the dead-run sweep below |

The full list with explanations is `.env.example`.

**Dead-run sweep (optional, added 2026-10-17).** A run still "running" 40 minutes after its job
claimed it (an upload's 30-minute limit plus 10) has died, e.g. the server restarted. Pages that
follow a run already ask the server to mark it failed (`POST /api/runs/check`); this sweep catches
the ones nobody is looking at. With `CRON_SECRET` set, register the cron in a `vercel.json` at the
repo root:

```json
{ "crons": [{ "path": "/api/cron/runs", "schedule": "*/15 * * * *" }] }
```

Every 15 minutes needs a Pro plan; Hobby allows one run a day (e.g. `"0 9 * * *"`), and Vercel
refuses a deploy with a more frequent schedule on Hobby, so it isn't committed until the plan is
known.

GitHub auto-deploy isn't linked yet (CLAUDE.md, Deploy).

## 6. The Claude Code cloud environment

So a session can run the live checks:

- **Environment variables** (cloud environment menu → Edit): `ANTHROPIC_API_KEY`,
  `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_ACCESS_TOKEN`,
  `SUPABASE_DB_PASSWORD`, `TRIGGER_SECRET_KEY` (dev key), `TRIGGER_ACCESS_TOKEN`,
  `TRIGGER_PROJECT_REF`.
- **Network access** (same menu → Network access → Custom, keeping the default package-manager
  list): as of 2026-10-05 this environment blocks every service above except the Anthropic API.
  Add `*.supabase.co`, `api.supabase.com`, `supabase.com`, `*.pooler.supabase.com`,
  `api.trigger.dev`, `cloud.trigger.dev`, and `api.vercel.com` if sessions should deploy.
  Steps: https://code.claude.com/docs/en/cloud-environments#network-access.
- **Unknown until tried:** `supabase db push` talks to Postgres directly (port 5432 or 6543), not
  over HTTPS, and this environment's proxy may not carry that. If it can't, migrations go out
  from the owner's machine (`npx supabase link --project-ref <ref>` then `npx supabase db push`)
  or from a GitHub Actions job with `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` as repo
  secrets. The REST, Storage and auth checks (`check:isolation`) only need HTTPS.

## 7. Watching costs and security (after launch)

Run these with the secret key (the Supabase SQL editor). Nothing in the app sends a notification;
this is how the owner sees what the cost guard and the injection defences recorded.

```sql
-- Top students by tokens and cost today (UTC).
select owner_id, count(*) as calls,
       sum(input_tokens + output_tokens + cache_write_tokens + cache_read_tokens) as tokens,
       round(sum(cost_usd), 4) as usd
from public.model_usage
where at >= date_trunc('day', now())
group by owner_id order by usd desc limit 20;

-- Everyone's spend today against ORCA_DAILY_BUDGET_USD.
select round(sum(cost_usd), 2) as usd_today from public.model_usage where at >= date_trunc('day', now());

-- Calls a fallback answered with a model that has no recorded price (priced as the requested one).
select at, owner_id, model from public.model_usage where model like '%(priced as %' order by at desc;

-- Runs held by a limit or still queued, with why and for how long.
select owner_id, kind, status, progress ->> 'reason' as reason, at, started_at
from public.pipeline_runs where status in ('queued', 'waiting', 'running') order by at;

-- Students hitting rate limits repeatedly (worth a look).
select owner_id, action, count(*) as windows_over_limit
from public.rate_limits
where count > case action when 'upload' then 20 when 'reflect' then 10 when 'grade' then 60 when 'topUp' then 30 end
group by owner_id, action order by windows_over_limit desc;

-- Security events this week: uploads with text aimed at an AI, flagged notes and answers, refused
-- generated items. Strong student_answer rows are what turn a student's model grading off (3 in 7 days).
select kind, "check", severity, count(*) from public.security_events
where at >= now() - interval '7 days' group by 1, 2, 3 order by 4 desc;
select owner_id, count(*) as flagged_answers from public.security_events
where kind = 'student_answer' and severity = 'strong' and at >= now() - interval '7 days'
group by owner_id having count(*) >= 3;

-- Turn a student's model grading back on (after looking at their answers).
-- delete from public.security_events where owner_id = '<uuid>' and kind = 'student_answer';
```

### Question feedback (thumbs up / down, added 2026-10-18)

Every student's ratings, across the platform (secret key). Use them to find weak question types and
to build a test set for the prompts (the worst-rated questions with their reasons).

```sql
-- Ratings by question type and tier: how often each is thumbed down, and why.
select q.kind, q.tier, q.deep,
       count(*) filter (where f.rating = 'up') as up,
       count(*) filter (where f.rating = 'down') as down,
       round(100.0 * count(*) filter (where f.rating = 'down') / count(*), 1) as pct_down
from public.question_feedback f join public.questions q on q.id = f.question_id
group by q.kind, q.tier, q.deep order by pct_down desc;

-- Reasons given for a thumbs down.
select reason, count(*) from public.question_feedback where rating = 'down' group by reason order by count(*) desc;

-- By the kind of material the question was written from.
select m.type as material_type, count(*) filter (where f.rating = 'down') as down, count(*) as rated
from public.question_feedback f join public.questions q on q.id = f.question_id
left join public.materials m on m.id = q.material_id
group by m.type order by down desc;

-- The latest thumbs-down questions with the students' notes, for reading (and for a prompt test set).
select f.created_at, f.reason, f.note, q.kind, q.prompt, q.explanation, q.exact
from public.question_feedback f join public.questions q on q.id = f.question_id
where f.rating = 'down' order by f.created_at desc limit 50;
```

## Order

1. Anthropic key into the cloud environment (unblocks the extraction baseline now).
2. Supabase project, keys, auth settings; environment variables and network access.
3. Trigger.dev project and keys.
4. Vercel variables, once Phase 4 is merged and ready to deploy.
5. Email provider, before real students.
