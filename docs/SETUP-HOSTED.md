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
   `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`. Tasks run on Trigger.dev's
   machines, so they need their own copies.

## 3. Anthropic

Create an API key at console.anthropic.com for Orca's server (the only model key the server uses)
and set a monthly spend limit on the workspace. The same key unlocks the extraction baseline
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
| `ANTHROPIC_API_KEY` | Anthropic key | mark sensitive |
| `ORCA_JOBS` | `trigger` | |
| `TRIGGER_SECRET_KEY` | `tr_prod_…` | mark sensitive |

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

## Order

1. Anthropic key into the cloud environment (unblocks the extraction baseline now).
2. Supabase project, keys, auth settings; environment variables and network access.
3. Trigger.dev project and keys.
4. Vercel variables, once Phase 4 is merged and ready to deploy.
5. Email provider, before real students.
