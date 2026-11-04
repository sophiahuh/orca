# Activity logs, edit history, test accounts and soft delete — Implementation Plan

> **Status (checked 2026-11-04): planned, not started.** The code has moved since this was written
> (2026-10-27). Before building:
> - **Migration numbers:** the block `20261031090000`–`20261031090500` clashes with migrations
>   added since (`20261031090000_upcoming_materials` through `20261031120000`, then up to
>   `20261104100000_canvas`). Number
>   each migration after the newest one in `supabase/migrations/` (the weak-points spec reserves
>   `20261105090000…`).
> - **More hard deletes to convert in Task 5:**
>   - `removeMaterial` (`src/lib/server/materials.ts`, `DELETE /api/materials/:id`, 2026-10-28)
>     deletes the material's pages, calendar entry and Storage file and marks the row `removed`;
>     decide whether `removed` becomes the soft delete or `deleted_at` replaces it.
>   - `canvas_connections` and `connector_tokens` rows are deleted on Disconnect
>     (`src/lib/server/canvas.ts`, `connector.ts`). They're credentials, so deleting them may be
>     the right exception; ask the owner.
> - **New tables for Task 6's `forbid_delete` list:** `connector_tokens`, `canvas_connections`,
>   `canvas_links`.
> - **Line numbers** quoted below (e.g. `src/lib/store.tsx:585`) have shifted; find the calls with
>   the grep commands each task gives.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner monitor adoption and activity (who is active and when, which features they use, what they edited and when), tell test and team accounts apart from real students, and make sure no student data, accounts included, is ever hard-deleted.

**Architecture:** Five pieces, all first-party in Postgres (no analytics vendor):
1. `profiles` gains `account_kind` (student / team / test), `last_seen_at` and `deleted_at`.
2. A new service-role-only `activity_events` table, written only by `POST /api/activity`, which the browser feeds in batches (page views and session lifecycle). The auth server actions write sign-in, sign-up and sign-out events directly.
3. `updated_at` columns plus a generic `audit_log` (one row per insert/update/soft delete of a student-editable row, with a column diff), filled by triggers.
4. Soft delete: a `deleted_at` column wherever the app deletes rows today. Every `.delete()` becomes an update, every read filters, and a `forbid_delete` trigger on every student-data table and on `auth.users` makes any hard delete fail.
5. A `private` schema view the owner queries from the SQL editor, plus the adoption SQL in `docs/SETUP-HOSTED.md`.

**Tech Stack:** Supabase Postgres (migrations, RLS, pgTAP), Next.js 16 route handlers, `zod`, `node:test`, Playwright.

## Global Constraints

- No new dependency (CLAUDE.md invariant). No vendor analytics.
- New persistence (`activity_events`, `audit_log`) must be recorded with its reason in `docs/BACKEND-ROADMAP.md` (CLAUDE.md invariant) — Task 8.
- Migrations are numbered after the newest applied one (`20261030090200`); this plan uses the block `20261031090000`–`20261031090500`.
- Nothing is hard-deleted: not student rows, not accounts, not Storage files. One exception: `hit_rate_limit` prunes its own expired `rate_limits` windows (throttle counters, not student data). Task 8 lists this for the owner.
- Learner state stays derived: activity events are **never** evidence and never change mastery.
- The browser never writes `activity_events`, `audit_log`, `account_kind`, `last_seen_at` or `deleted_at` on `profiles`.
- Pure modules (`src/lib/activity/`) load under plain Node: relative `.ts` imports and `import type`.
- Commit as the machine's git user; work lands on `phase-4`. Use Fix-mode checks per commit (`npx tsc --noEmit`, `npx eslint <changed files>`, the one relevant test file). Run `npm run locked -- npm run test:db` whenever a migration changes, and `npm run db:types` after each migration.
- Run `npx next typegen` before `tsc` after adding a route.
- Merge gate once, at the end (Task 9).

## Assumptions to confirm with the owner (also written to `docs/TO-DISCUSS.md` in Task 8)

1. **Erasure requests.** "Never hard delete" conflicts with a student's legal right to have their data erased (GDPR/CCPA-style requests). The plan soft-deletes and bans; a real erasure would be a manual, owner-run step outside the app, and no code path for it exists.
2. **Storage files are kept** when a material is soft-deleted (duplicates and the stale-upload sweep included). Storage use grows; nothing is purged.
3. **In-app "Delete account"** (Settings) soft-deletes the profile and bans the auth user. Restoring an account is owner SQL plus an unban.
4. **Test accounts** are flagged from `app_metadata.account_kind = 'test'` (set by the test scripts) or an `@example.com` / `@example.test` email. **Team accounts** (owner, Amanda, teammates) are flagged by one SQL statement the owner runs on production. No emails are committed to the repo.
5. **What is tracked:** page views (route pattern, course id), session start/resume/finish/discard/leave, sign-in/sign-up/sign-out. No keystrokes, no answer text (that's already in evidence), no third-party scripts. The privacy notice wording is the owner's call.
6. **`session_progress` stays one row per course and kind.** A new session overwrites the previous unfinished one (an update, not a delete). The abandoned session's trace lives in `activity_events` (`session_left` / `session_discarded`), not in that row.

## File structure

- Create `supabase/migrations/20261031090000_accounts.sql` — `profiles.account_kind`, `last_seen_at`, `deleted_at`; profile creation reads the kind; column-level update grants.
- Create `supabase/migrations/20261031090100_activity_events.sql` — `activity_events` table, `touch_last_seen`.
- Create `supabase/migrations/20261031090200_edit_history.sql` — `updated_at` columns, `private.touch_updated_at`, `audit_log`, `private.audit_row`.
- Create `supabase/migrations/20261031090300_soft_delete.sql` — `deleted_at` columns, a partial unique index, `my_data` filtered, RLS reads filtered, `security_events.cleared_at`.
- Create `supabase/migrations/20261031090400_no_hard_deletes.sql` — `private.forbid_delete` on public tables and `auth.users`; delete privileges and policies removed.
- Create `supabase/migrations/20261031090500_admin_views.sql` — `private.user_overview`, `private.daily_actives`.
- Create `src/lib/activity/events.ts` (pure) — event names, the batch schema, `routeOf(path)`.
- Create `src/lib/activity/client.ts` — browser queue, `track()`, flush via `fetch` / `sendBeacon`.
- Create `src/app/api/activity/route.ts` — `POST`: validate, rate-limit, insert, touch `last_seen_at`.
- Create `src/lib/server/activity.ts` — `recordServerActivity(db, ownerId, name, props)` for server code.
- Create `src/components/layout/ActivityTracker.tsx` — page views.
- Create `src/app/api/account/delete/route.ts` — soft delete and ban.
- Modify `src/lib/store.tsx`, `src/lib/server/materials.ts`, `src/lib/material/cleanup.ts`, `src/lib/server/security.ts`, the server reads of soft-deletable tables, `src/app/auth/actions.ts`, `src/app/auth/callback/route.ts`, `src/app/providers.tsx`, `src/components/quiz/QuizRunner.tsx`, `src/app/session/[slug]/page.tsx`, `src/components/settings/Account.tsx`, `src/lib/limits.ts`, `src/lib/server/rate-limit.ts`.
- Modify the test harness: `e2e/fixture.ts`, `e2e/global-setup.ts`, `e2e/auth.spec.ts`, `e2e/upload.spec.ts`, `e2e/grade.spec.ts`, `scripts/check-isolation.ts`, `scripts/check-evidence.ts`, `supabase/tests/01_ownership.test.sql`.
- Tests: `supabase/tests/13_accounts.test.sql`, `14_activity.test.sql`, `15_edit_history.test.sql`, `16_soft_delete.test.sql`; `tests/activity/events.test.ts`; `tests/server/activity-route.test.ts`; `tests/material/cleanup.test.ts` (existing, updated); `e2e/activity.spec.ts`.
- Docs: `docs/BACKEND-ROADMAP.md`, `docs/TO-DISCUSS.md`, `docs/SETUP-HOSTED.md` §7, `CLAUDE.md` (stack and map lines).

---

### Task 1: Account kind, last seen, account soft-delete columns

**Files:**
- Create: `supabase/migrations/20261031090000_accounts.sql`
- Test: `supabase/tests/13_accounts.test.sql`
- Modify: `e2e/fixture.ts:73`, `e2e/global-setup.ts` (its `createUser`), `e2e/auth.spec.ts`, `e2e/upload.spec.ts:~320`, `scripts/check-isolation.ts:66`, `scripts/check-evidence.ts` (its user creation): pass `app_metadata: { account_kind: "test" }`

**Interfaces:**
- Produces: `profiles.account_kind text` (`'student' | 'team' | 'test'`), `profiles.last_seen_at timestamptz | null`, `profiles.deleted_at timestamptz | null`. The browser can update only `timezone, onboarded, name, avatar, default_review_config` on `profiles`.

- [ ] **Step 1: Write the failing pgTAP test** `supabase/tests/13_accounts.test.sql`

```sql
-- Account kinds (student / team / test), set when the account is made and never by the student.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

\set A aaaaaaaa-0000-4000-8000-000000000001
\set T aaaaaaaa-0000-4000-8000-000000000002
\set E aaaaaaaa-0000-4000-8000-000000000003

insert into auth.users (id, email, raw_app_meta_data) values
  (:'A', 'student@columbia.edu', '{}'),
  (:'T', 'someone@columbia.edu', '{"account_kind": "test"}'),
  (:'E', 'e2e-1@example.test', '{}');

select is((select account_kind from public.profiles where owner_id = :'A'), 'student', 'a plain sign-up is a student');
select is((select account_kind from public.profiles where owner_id = :'T'), 'test', 'app_metadata.account_kind = test marks a test account');
select is((select account_kind from public.profiles where owner_id = :'E'), 'test', 'an @example.test email is a test account');
select is((select last_seen_at from public.profiles where owner_id = :'A'), null, 'never seen yet');

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  select set_config('role', 'authenticated', true);
$$;
select pg_temp.act_as(:'A');
select throws_ok($$update public.profiles set account_kind = 'team'$$, '42501', null, 'a student cannot change their account kind');
select throws_ok($$update public.profiles set deleted_at = now()$$, '42501', null, 'or mark themselves deleted from the browser');
select lives_ok($$update public.profiles set timezone = 'America/New_York'$$, 'but can still change their timezone');

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run locked -- npm run test:db`
Expected: FAIL in `13_accounts` with `column "account_kind" does not exist`.

- [ ] **Step 3: Write the migration** `supabase/migrations/20261031090000_accounts.sql`

```sql
-- Monitoring (2026-10-27 plan): which accounts are real students, when each was last active, and
-- account soft delete. account_kind comes from app_metadata (only the service role can set it) or a
-- test email domain; team accounts are marked by the owner with SQL (docs/SETUP-HOSTED.md §7).
alter table public.profiles
  add column account_kind text not null default 'student' check (account_kind in ('student', 'team', 'test')),
  add column last_seen_at timestamptz,
  add column deleted_at timestamptz;

create or replace function private.create_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  tz text := coalesce(new.raw_user_meta_data ->> 'timezone', 'UTC');
  creature text := coalesce(new.raw_user_meta_data ->> 'avatar', 'orca');
  given_name text := nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'name', '')), 80), '');
  kind text := coalesce(new.raw_app_meta_data ->> 'account_kind',
    case when new.email ~* '@example\.(com|test)$' then 'test' else 'student' end);
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = tz) then
    tz := 'UTC';
  end if;
  if creature not in ('orca', 'dolphin', 'octopus', 'turtle', 'jellyfish') then
    creature := 'orca';
  end if;
  if kind not in ('student', 'team', 'test') then
    kind := 'student';
  end if;
  insert into public.profiles (owner_id, timezone, avatar, name, account_kind) values (new.id, tz, creature, given_name, kind);
  return new;
end;
$$;

-- Accounts made before this migration by the test scripts.
update public.profiles p set account_kind = 'test'
  from auth.users u where u.id = p.owner_id and u.email ~* '@example\.(com|test)$';

-- The browser updates only what Settings and onboarding change; Notes for Orca go through
-- PUT /api/account-notes (service role), and the monitoring columns are server-only.
revoke update on public.profiles from anon, authenticated;
grant update (timezone, onboarded, name, avatar, default_review_config) on public.profiles to authenticated;
```

- [ ] **Step 4: Pass `account_kind: "test"` everywhere a script creates a user**

In `e2e/fixture.ts` (the `createUser` call in the `student` fixture):

```ts
const { data, error } = await admin().auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { timezone: TIMEZONE }, app_metadata: { account_kind: "test" } });
```

Make the same change in `e2e/global-setup.ts` and wherever `e2e/auth.spec.ts` and `e2e/upload.spec.ts` call `createUser`. In `scripts/check-isolation.ts:66` and `scripts/check-evidence.ts` the body goes to `/auth/v1/admin/users`; add `app_metadata: { account_kind: "test" }` to it. Their emails (`@example.com`) are caught by the domain rule anyway; the explicit flag protects against a later change of address.

- [ ] **Step 5: Run the tests and regenerate types**

Run: `npm run locked -- npm run test:db` → PASS (all files). Then `npm run locked -- npm run db:types`, then `npx tsc --noEmit`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261031090000_accounts.sql supabase/tests/13_accounts.test.sql src/lib/supabase/database.types.ts e2e scripts
git commit -m "Profiles: account kind (student/team/test), last seen, deleted_at; the browser can update only its own settings columns"
```

---

### Task 2: `activity_events` and `POST /api/activity`

**Files:**
- Create: `supabase/migrations/20261031090100_activity_events.sql`
- Create: `src/lib/activity/events.ts`
- Create: `src/lib/server/activity.ts`
- Create: `src/app/api/activity/route.ts`
- Modify: `src/lib/limits.ts` (rate entry), `src/lib/server/rate-limit.ts` (`WHAT` entry)
- Test: `supabase/tests/14_activity.test.sql`, `tests/activity/events.test.ts`, `tests/server/activity-route.test.ts`

**Interfaces:**
- Produces (pure, `src/lib/activity/events.ts`):
  - `ACTIVITY_NAMES` — `readonly ["page_view", "session_started", "session_resumed", "session_finished", "session_discarded", "session_left"]` (what the browser may send)
  - `SERVER_ACTIVITY_NAMES` — `readonly ["sign_in", "sign_up", "sign_out", "account_deleted"]` (server only)
  - `type ActivityName`, `type ServerActivityName`
  - `ActivityBatch` — zod schema `{ events: Array<{ name: ActivityName; path: string; courseId?: string | null; props?: Record<string, string | number | boolean | null>; clientAt: string }> }`, 1–50 events, `path` ≤ 300 chars, `props` ≤ 10 keys, string values ≤ 120 chars
  - `routeOf(path: string): string` — `/course/data-structures/atlas` → `/course/[slug]/atlas`
- Produces (server): `recordServerActivity(db: OrcaSupabase, ownerId: string, name: ServerActivityName, props?: Record<string, string | number | boolean | null>): Promise<void>` (logs and swallows errors, so monitoring never breaks sign-in)
- Produces (DB): `public.activity_events (id, owner_id, at, client_at, name, route, path, course_id, props)`; `public.touch_last_seen(owner uuid)` (service role only)

- [ ] **Step 1: Write the failing unit test** `tests/activity/events.test.ts`

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { ActivityBatch, routeOf } from "../../src/lib/activity/events.ts";

test("routeOf turns a path into its route pattern", () => {
  assert.equal(routeOf("/"), "/");
  assert.equal(routeOf("/course/data-structures"), "/course/[slug]");
  assert.equal(routeOf("/course/data-structures/atlas"), "/course/[slug]/atlas");
  assert.equal(routeOf("/session/data-structures"), "/session/[slug]");
  assert.equal(routeOf("/quiz/ald/2b0c1f9e-0000-4000-8000-000000000001"), "/quiz/[slug]/[topic]");
  assert.equal(routeOf("/settings?tab=x"), "/settings");
  assert.equal(routeOf("/no-such-page/deep"), "/other");
});

test("ActivityBatch accepts a page view and refuses unknown or server-only names", () => {
  const ok = ActivityBatch.safeParse({ events: [{ name: "page_view", path: "/calendar", clientAt: "2026-10-27T12:00:00Z" }] });
  assert.equal(ok.success, true);
  assert.equal(ActivityBatch.safeParse({ events: [{ name: "sign_in", path: "/", clientAt: "2026-10-27T12:00:00Z" }] }).success, false);
  assert.equal(ActivityBatch.safeParse({ events: [{ name: "clicked_everything", path: "/", clientAt: "2026-10-27T12:00:00Z" }] }).success, false);
  assert.equal(ActivityBatch.safeParse({ events: [] }).success, false);
});

test("ActivityBatch bounds the batch and its props", () => {
  const one = { name: "page_view", path: "/", clientAt: "2026-10-27T12:00:00Z" };
  assert.equal(ActivityBatch.safeParse({ events: Array(51).fill(one) }).success, false);
  const props = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, 1]));
  assert.equal(ActivityBatch.safeParse({ events: [{ ...one, props }] }).success, false);
  assert.equal(ActivityBatch.safeParse({ events: [{ ...one, props: { note: "x".repeat(121) } }] }).success, false);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test tests/activity/events.test.ts`
Expected: FAIL, `Cannot find module '../../src/lib/activity/events.ts'`.

- [ ] **Step 3: Write `src/lib/activity/events.ts`**

```ts
/**
 * Activity events (2026-10-27 plan): what the owner sees of how students use Orca, beyond their
 * answers. Never evidence: nothing here changes mastery. The browser may send only ACTIVITY_NAMES
 * through POST /api/activity; SERVER_ACTIVITY_NAMES are written by server code. Pure; loads under
 * plain Node.
 */
import { z } from "zod";

export const ACTIVITY_NAMES = ["page_view", "session_started", "session_resumed", "session_finished", "session_discarded", "session_left"] as const;
export const SERVER_ACTIVITY_NAMES = ["sign_in", "sign_up", "sign_out", "account_deleted"] as const;
export type ActivityName = (typeof ACTIVITY_NAMES)[number];
export type ServerActivityName = (typeof SERVER_ACTIVITY_NAMES)[number];

const PropValue = z.union([z.string().max(120), z.number().finite(), z.boolean(), z.null()]);

export const ActivityEvent = z.object({
  name: z.enum(ACTIVITY_NAMES),
  path: z.string().min(1).max(300),
  courseId: z.uuid().nullable().optional(),
  props: z.record(z.string().max(40), PropValue).refine((p) => Object.keys(p).length <= 10, "at most 10 props").optional(),
  clientAt: z.iso.datetime({ offset: true }),
});
export type ActivityEvent = z.infer<typeof ActivityEvent>;

export const ActivityBatch = z.object({ events: z.array(ActivityEvent).min(1).max(50) });

/** Route patterns, most specific first. A path matching none is "/other". */
const ROUTES: ReadonlyArray<[RegExp, string]> = [
  [/^\/$/, "/"],
  [/^\/course\/[^/]+\/(review|objectives|atlas|settings|uploads)$/, "/course/[slug]/$1"],
  [/^\/course\/[^/]+$/, "/course/[slug]"],
  [/^\/session\/[^/]+$/, "/session/[slug]"],
  [/^\/quiz\/[^/]+\/[^/]+$/, "/quiz/[slug]/[topic]"],
  [/^\/(home|welcome|new-course|add-material|settings|calendar|sign-in|sign-up|forgot-password|reset-password)$/, "/$1"],
];

export function routeOf(path: string): string {
  const bare = path.split(/[?#]/)[0] || "/";
  for (const [re, pattern] of ROUTES) {
    const m = bare.match(re);
    if (m) return pattern.replace("$1", m[1] ?? "");
  }
  return "/other";
}
```

Before committing, check the course sub-routes against `ls src/app/course/[slug]` and keep the `(review|objectives|atlas|settings|uploads)` list in step with what's there.

- [ ] **Step 4: Run the unit test**

Run: `node --test tests/activity/events.test.ts` → PASS.

- [ ] **Step 5: Write the failing pgTAP test** `supabase/tests/14_activity.test.sql`

```sql
-- Activity events: written only by the service role; students can't read or write them.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

\set A aaaaaaaa-0000-4000-8000-000000000001
insert into auth.users (id, email) values (:'A', 'a@columbia.edu');

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  select set_config('role', 'authenticated', true);
$$;

select lives_ok(format($$insert into public.activity_events (owner_id, name, route, path, client_at) values (%L, 'page_view', '/calendar', '/calendar', now())$$, :'A'), 'the service role records an event');
select throws_ok(format($$insert into public.activity_events (owner_id, name, route, path, client_at) values (%L, 'made_up', '/', '/', now())$$, :'A'), '23514', null, 'unknown names are refused');
select public.touch_last_seen(:'A');
select isnt((select last_seen_at from public.profiles where owner_id = :'A'), null, 'touch_last_seen stamps the profile');

select pg_temp.act_as(:'A');
select throws_ok($$select count(*) from public.activity_events$$, '42501', null, 'a student cannot read activity events');
select throws_ok(format($$select public.touch_last_seen(%L)$$, :'A'), '42501', null, 'or call touch_last_seen');

select * from finish();
rollback;
```

Run: `npm run locked -- npm run test:db` → FAIL (`relation "public.activity_events" does not exist`).

- [ ] **Step 6: Write the migration** `supabase/migrations/20261031090100_activity_events.sql`

```sql
-- Activity events (2026-10-27 plan): page views, session lifecycle and sign-ins, for monitoring
-- adoption. Service role only (POST /api/activity and the auth actions write; the owner reads in the
-- SQL editor). Never evidence. `at` is the server's clock; `client_at` is the browser's, kept for
-- ordering events sent in one batch.
create table public.activity_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users,
  at timestamptz not null default now(),
  client_at timestamptz not null,
  name text not null check (name in (
    'page_view', 'session_started', 'session_resumed', 'session_finished', 'session_discarded', 'session_left',
    'sign_in', 'sign_up', 'sign_out', 'account_deleted')),
  route text not null check (length(route) <= 80),
  path text not null check (length(path) <= 300),
  course_id uuid,
  props jsonb not null default '{}' check (jsonb_typeof(props) = 'object' and length(props::text) <= 2000)
);
create index activity_events_owner_at on public.activity_events (owner_id, at);
create index activity_events_name_at on public.activity_events (name, at);
alter table public.activity_events enable row level security;
revoke all on public.activity_events from anon, authenticated;

-- Last activity, at most once a minute per student so a burst of batches is one write.
create function public.touch_last_seen(owner uuid) returns void
language sql security definer set search_path = '' as $$
  update public.profiles set last_seen_at = now()
  where owner_id = owner and (last_seen_at is null or last_seen_at < now() - interval '1 minute');
$$;
revoke execute on function public.touch_last_seen(uuid) from public, anon, authenticated;
grant execute on function public.touch_last_seen(uuid) to service_role;
```

`course_id` has no foreign key on purpose: the event log outlives any change to a course, and a forged id from the browser is harmless (the route checks ownership anyway; see Step 8). Run `npm run locked -- npm run test:db` → PASS, then `npm run locked -- npm run db:types`.

- [ ] **Step 7: Add the rate limit**

`src/lib/limits.ts`, inside `rate`:

```ts
    /** Activity batches from the browser (POST /api/activity): one every ~15 s while a tab is open. */
    activity: { max: 400, windowSeconds: 3600 },
```

`src/lib/server/rate-limit.ts`, in `WHAT`: `activity: "activity reports",`.

- [ ] **Step 8: Write `src/lib/server/activity.ts` and the route**

`src/lib/server/activity.ts`:

```ts
/** Activity events written by server code (sign-in and the rest); see src/lib/activity/events.ts. */
import type { ServerActivityName } from "@/lib/activity/events";
import type { OrcaSupabase } from "@/lib/supabase/server";

/** Record one server-side event. Monitoring must never break the action it watches: errors are logged, not thrown. */
export async function recordServerActivity(db: OrcaSupabase, ownerId: string, name: ServerActivityName, props: Record<string, string | number | boolean | null> = {}): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await db.from("activity_events").insert({ owner_id: ownerId, name, route: "/auth", path: "/auth", client_at: now, props });
  if (error) console.error(`activity: couldn't record ${name}: ${error.message}`);
  const seen = await db.rpc("touch_last_seen", { owner: ownerId });
  if (seen.error) console.error(`activity: couldn't touch last seen: ${seen.error.message}`);
}
```

`src/app/api/activity/route.ts`:

```ts
import { ActivityBatch, routeOf } from "@/lib/activity/events";
import { rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { forStudent, reply } from "@/lib/server/student";

/** POST { events } → 204: the browser's activity batch (page views, session lifecycle). Text bodies too, for sendBeacon. */
export const runtime = "nodejs";

export async function POST(request: Request) {
  return forStudent(request, async (student, db) => {
    const text = await request.text().catch(() => "");
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      return reply(400, { error: "Not an activity batch." });
    }
    const parsed = ActivityBatch.safeParse(json);
    if (!parsed.success) return reply(400, { error: "Not an activity batch." });
    const verdict = await rateLimit(db, student.id, "activity");
    if (!verdict.ok) return tooManyRequests(verdict);
    // Only the student's own courses are kept; an id that isn't theirs is dropped, not trusted.
    const ids = [...new Set(parsed.data.events.map((e) => e.courseId).filter((id): id is string => Boolean(id)))];
    const owned = new Set<string>();
    if (ids.length) {
      const { data, error } = await db.from("courses").select("id").eq("owner_id", student.id).in("id", ids);
      if (error) return reply(500, { error: "Orca couldn't record activity." });
      for (const r of data) owned.add(r.id);
    }
    const rows = parsed.data.events.map((e) => ({
      owner_id: student.id,
      name: e.name,
      route: routeOf(e.path),
      path: e.path,
      course_id: e.courseId && owned.has(e.courseId) ? e.courseId : null,
      props: e.props ?? {},
      client_at: e.clientAt,
    }));
    const { error } = await db.from("activity_events").insert(rows);
    if (error) return reply(500, { error: "Orca couldn't record activity." });
    const seen = await db.rpc("touch_last_seen", { owner: student.id });
    if (seen.error) return reply(500, { error: "Orca couldn't record activity." });
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  });
}
```

- [ ] **Step 9: Write the route test** `tests/server/activity-route.test.ts` (same shape as `tests/server/evidence-route.test.ts`)

```ts
import test from "node:test";
import assert from "node:assert/strict";

test("POST /api/activity answers 503 when Supabase isn't configured, before reading the body", async () => {
  const saved = { ...process.env };
  for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY"]) delete process.env[k];
  try {
    const { POST } = await import("../../src/app/api/activity/route.ts");
    const res = await POST(new Request("http://orca.test/api/activity", { method: "POST", body: "not json" }));
    assert.equal(res.status, 503);
    assert.equal(res.headers.get("cache-control"), "no-store");
  } finally {
    Object.assign(process.env, saved);
  }
});
```

The signed-in paths (400, 204, the ownership filter) are covered end to end in Task 3's `e2e/activity.spec.ts`.

- [ ] **Step 10: Run checks**

Run: `npx next typegen && npx tsc --noEmit && npx eslint src/lib/activity src/lib/server/activity.ts src/app/api/activity src/lib/limits.ts src/lib/server/rate-limit.ts && node --test tests/activity/events.test.ts tests/server/activity-route.test.ts`
Expected: PASS. (Use `npm test -- <files>` if the plain `node --test` can't resolve `@/…`; `npm test` loads `tests/support/register.mjs`.)

- [ ] **Step 11: Commit**

```bash
git add supabase/migrations/20261031090100_activity_events.sql supabase/tests/14_activity.test.sql src/lib/supabase/database.types.ts src/lib/activity src/lib/server/activity.ts src/app/api/activity src/lib/limits.ts src/lib/server/rate-limit.ts tests/activity tests/server/activity-route.test.ts
git commit -m "Activity events: service-role-only table, POST /api/activity (validated, rate-limited, own courses only), last_seen_at"
```

---

### Task 3: The browser reports page views and session lifecycle; auth actions report sign-ins

**Files:**
- Create: `src/lib/activity/client.ts`, `src/components/layout/ActivityTracker.tsx`
- Modify: `src/app/providers.tsx` (render `<ActivityTracker />` inside `Loaded`, beside `SaveStatus`), `src/components/quiz/QuizRunner.tsx`, `src/app/session/[slug]/page.tsx:79-82`, `src/app/auth/actions.ts` (sign in, sign up, sign out), `src/app/auth/callback/route.ts`
- Test: `e2e/activity.spec.ts`

**Interfaces:**
- Consumes: `ActivityName`, `routeOf` (Task 2); `recordServerActivity` (Task 2)
- Produces: `track(name: ActivityName, data?: { courseId?: string | null; props?: Record<string, string | number | boolean | null> }): void` and `flushActivity(): void` from `src/lib/activity/client.ts`

- [ ] **Step 1: Write the failing e2e spec** `e2e/activity.spec.ts`

```ts
import { admin, expect, test } from "./fixture";

test("page views and sign-ins reach activity_events, and last_seen_at moves", async ({ page, student }) => {
  await page.goto("/calendar");
  await page.goto("/settings");
  // A hidden page flushes at once (sendBeacon); then poll the table.
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect
    .poll(async () => {
      const { data } = await admin().from("activity_events").select("name, route").eq("owner_id", student.id).eq("name", "page_view");
      return (data ?? []).map((r) => r.route).sort();
    }, { timeout: 20_000 })
    .toEqual(expect.arrayContaining(["/calendar", "/settings"]));
  const { data: profile } = await admin().from("profiles").select("last_seen_at, account_kind").eq("owner_id", student.id).single();
  expect(profile?.last_seen_at).not.toBeNull();
  expect(profile?.account_kind).toBe("test");
});

test("POST /api/activity refuses a server-only name and a junk body", async ({ page }) => {
  await page.goto("/");
  expect((await page.request.post("/api/activity", { data: { events: [{ name: "sign_in", path: "/", clientAt: new Date().toISOString() }] } })).status()).toBe(400);
  expect((await page.request.post("/api/activity", { data: "nope" })).status()).toBe(400);
});
```

Run: `npm run locked -- npx playwright test e2e/activity.spec.ts` → FAIL (no page views recorded).

`dispatchEvent(new Event("visibilitychange"))` doesn't change `document.visibilityState`, so the client below flushes on **any** `visibilitychange` and on `pagehide`, not only when hidden. If the poll is flaky, add a test-only `window.__orcaFlushActivity = flushActivity`, assigned in `ActivityTracker` when `process.env.NODE_ENV !== "production"`, and call that from the spec instead.

- [ ] **Step 2: Write `src/lib/activity/client.ts`**

```ts
/**
 * The browser's activity queue: events are batched and sent every 15 s, and at once when the tab is
 * hidden or closed (sendBeacon, which survives the page going away). A failed send is dropped:
 * monitoring never retries into a student's bandwidth or blocks a screen.
 */
import type { ActivityName } from "./events";

type Props = Record<string, string | number | boolean | null>;
interface Queued { name: ActivityName; path: string; courseId: string | null; props: Props; clientAt: string }

const FLUSH_MS = 15_000;
const MAX_BATCH = 50;
let queue: Queued[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let listening = false;

export function track(name: ActivityName, data: { courseId?: string | null; props?: Props } = {}): void {
  if (typeof window === "undefined") return;
  queue.push({ name, path: location.pathname, courseId: data.courseId ?? null, props: data.props ?? {}, clientAt: new Date().toISOString() });
  if (!listening) {
    listening = true;
    document.addEventListener("visibilitychange", flushActivity);
    window.addEventListener("pagehide", flushActivity);
  }
  if (queue.length >= MAX_BATCH) flushActivity();
  else if (!timer) timer = setTimeout(flushActivity, FLUSH_MS);
}

export function flushActivity(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  while (queue.length) {
    const events = queue.splice(0, MAX_BATCH);
    const body = JSON.stringify({ events });
    const sent = typeof navigator.sendBeacon === "function" && navigator.sendBeacon("/api/activity", body);
    if (!sent) void fetch("/api/activity", { method: "POST", body, keepalive: true, headers: { "content-type": "application/json" } }).catch(() => undefined);
  }
}
```

Check that `connect-src 'self'` in `src/lib/csp.ts` covers `sendBeacon` to the same origin (it does: beacons are governed by `connect-src`).

- [ ] **Step 3: Write `src/components/layout/ActivityTracker.tsx`**

```tsx
"use client";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { track } from "@/lib/activity/client";
import { isPublicPath } from "@/lib/auth/paths";
import { useOrca } from "@/lib/store";

/** One page_view per signed-in navigation, with the course when the path names one. Renders nothing. */
export function ActivityTracker() {
  const pathname = usePathname();
  const { courses } = useOrca();
  useEffect(() => {
    if (isPublicPath(pathname)) return;
    const slug = pathname.match(/^\/(?:course|session|quiz)\/([^/]+)/)?.[1];
    const courseId = slug ? (courses.find((c) => c.slug === slug)?.id ?? null) : null;
    track("page_view", { courseId });
    // Only a navigation counts as a view; courses loading later doesn't add one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);
  return null;
}
```

In `src/app/providers.tsx`, inside `Loaded`'s fragment: `{children}<SaveStatus /><ActivityTracker />`.

- [ ] **Step 4: Session lifecycle in `QuizRunner` and the session page**

In `src/components/quiz/QuizRunner.tsx`:
- On mount, one effect with `[]` deps: `track(resume ? "session_resumed" : "session_started", { courseId: course.id, props: { mode, sessionId: sessionId.current, questions: allItems.length } })`.
- In the finish effect (around line 153, where `saveProgress(course.id, progressKind, null)` runs): `track("session_finished", { courseId: course.id, props: { mode, sessionId: sessionId.current, correct, total, seconds } })`.
- An unmount cleanup in the mount effect: if the session isn't finished (keep a ref `finishedRef` in step with `finished`), `track("session_left", { courseId: course.id, props: { mode, sessionId: sessionId.current, position: indexRef.current } })`.

In `src/app/session/[slug]/page.tsx`, `ResumePrompt`'s `onNew` (line 80): `track("session_discarded", { courseId: course.id, props: { kind, position: resumed.resume.index } })` before `saveProgress(course.id, kind, null)`.

Use the props names exactly as written here; Task 8's SQL reads `props->>'mode'` and `props->>'sessionId'`.

- [ ] **Step 5: Auth events**

In `src/app/auth/actions.ts`:
- `signIn`: after `signInWithPassword` succeeds, take the user id from its result (`const { data, error } = …`) and `await recordServerActivity(adminClient(), data.user.id, "sign_in", { method: "password" })`.
- `signUp`: after `signUp` succeeds with a user, `"sign_up"`.
- `signOut`: read the user before signing out (`(await client.auth.getUser()).data.user`) and record `"sign_out"` if there is one.

In `src/app/auth/callback/route.ts`, after a successful `exchangeCodeForSession` / `verifyOtp`, record `"sign_in"` with `{ method: type ?? "link" }`.

Import `adminClient` from `@/lib/supabase/server` (the secret-key client `forStudent` uses). `recordServerActivity` never throws, so a monitoring failure can't block sign-in.

- [ ] **Step 6: Run the spec and checks**

Run: `npx tsc --noEmit && npx eslint src/lib/activity src/components/layout/ActivityTracker.tsx src/app/providers.tsx src/components/quiz/QuizRunner.tsx "src/app/session/[slug]/page.tsx" src/app/auth && npm run locked -- npx playwright test e2e/activity.spec.ts e2e/auth.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/activity/client.ts src/components/layout/ActivityTracker.tsx src/app/providers.tsx src/components/quiz/QuizRunner.tsx "src/app/session/[slug]/page.tsx" src/app/auth e2e/activity.spec.ts
git commit -m "Report page views, session start/resume/finish/discard/leave, and sign-in/up/out to activity_events"
```

---

### Task 4: Edit history (`updated_at` and `audit_log`)

**Files:**
- Create: `supabase/migrations/20261031090200_edit_history.sql`
- Test: `supabase/tests/15_edit_history.test.sql`

**Interfaces:**
- Produces: `updated_at timestamptz not null default now()` on `courses, materials, topics, objectives, relations, exams, profiles, calendar_events, questions`, kept current by `private.touch_updated_at()`; `public.audit_log (id bigint, at, actor uuid | null, owner_id, table_name, row_id, op, changed jsonb)`, service role only. `op` is `'insert' | 'update' | 'soft_delete' | 'restore'`; `soft_delete` / `restore` are updates whose `deleted_at` goes from null to set, or back.

- [ ] **Step 1: Write the failing pgTAP test** `supabase/tests/15_edit_history.test.sql`

```sql
-- Edit history: updated_at moves on every change; audit_log keeps who changed what, column by column.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

\set A aaaaaaaa-0000-4000-8000-000000000001
\set course c0000000-0000-4000-8000-00000000000a
\set exam e0000000-0000-4000-8000-00000000000e
insert into auth.users (id, email) values (:'A', 'a@columbia.edu');

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  select set_config('role', 'authenticated', true);
$$;

select pg_temp.act_as(:'A');
insert into public.courses (id, slug, name, short, variant, pos_x, pos_y) values (:'course', 'ald', 'ALD', 'ALD', 'ald', 0, 0);
insert into public.exams (id, course_id, title, date) values (:'exam', :'course', 'Midterm', '2026-11-10');
update public.exams set title = 'Midterm 1' where id = :'exam';
update public.exams set title = 'Midterm 1' where id = :'exam'; -- no change: no history row
select set_config('role', 'postgres', true);

select is((select count(*) from public.audit_log where table_name = 'exams' and row_id = :'exam')::int, 2, 'an insert and one real update, not the no-op');
select is((select changed -> 'title' ->> 0 from public.audit_log where table_name = 'exams' and op = 'update'), 'Midterm', 'the old value');
select is((select changed -> 'title' ->> 1 from public.audit_log where table_name = 'exams' and op = 'update'), 'Midterm 1', 'the new value');
select is((select actor from public.audit_log where table_name = 'exams' and op = 'update'), :'A'::uuid, 'who made it');
select ok((select updated_at >= created_at from public.exams where id = :'exam'), 'updated_at moved');

update public.profiles set last_seen_at = now() where owner_id = :'A';
select is((select count(*) from public.audit_log where table_name = 'profiles' and op = 'update')::int, 0, 'last_seen_at alone is not an edit');

select pg_temp.act_as(:'A');
select throws_ok($$select count(*) from public.audit_log$$, '42501', null, 'students cannot read the audit log');

select * from finish();
rollback;
```

Before running it, check the `courses` insert against the current columns (`weights` was dropped; `review_config` is nullable since `20261006070000`). Run: `npm run locked -- npm run test:db` → FAIL (`relation "public.audit_log" does not exist`).

- [ ] **Step 2: Write the migration** `supabase/migrations/20261031090200_edit_history.sql`

```sql
-- Edit history (2026-10-27 plan). updated_at on every student-editable table, and audit_log: one
-- row per insert or real change, with the changed columns as {column: [old, new]}. actor is
-- auth.uid() (null when a server job made the change). Service role only. Big or noisy columns are
-- left out per table (the trigger's arguments); a change touching only those writes nothing.

create function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  owner_id uuid not null,
  table_name text not null,
  row_id text not null,
  op text not null check (op in ('insert', 'update', 'soft_delete', 'restore')),
  changed jsonb not null
);
create index audit_log_owner_at on public.audit_log (owner_id, at);
create index audit_log_row on public.audit_log (table_name, row_id, at);
alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon, authenticated;

-- TG_ARGV[0]: the key column (id, or owner_id for profiles). TG_ARGV[1..]: columns never recorded.
create function private.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  key text := TG_ARGV[0];
  skip text[] := array['updated_at', 'created_at'] || coalesce(TG_ARGV[1:], '{}');
  o jsonb := case when TG_OP = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  n jsonb := to_jsonb(new);
  diff jsonb := '{}'::jsonb;
  col text;
  kind text := lower(TG_OP);
begin
  for col in select jsonb_object_keys(n) loop
    continue when col = any(skip);
    if TG_OP = 'INSERT' then
      diff := diff || jsonb_build_object(col, n -> col);
    elsif (o -> col) is distinct from (n -> col) then
      diff := diff || jsonb_build_object(col, jsonb_build_array(o -> col, n -> col));
    end if;
  end loop;
  if diff = '{}'::jsonb then return new; end if;
  if TG_OP = 'UPDATE' and n ? 'deleted_at' then
    if (o ->> 'deleted_at') is null and (n ->> 'deleted_at') is not null then kind := 'soft_delete';
    elsif (o ->> 'deleted_at') is not null and (n ->> 'deleted_at') is null then kind := 'restore';
    end if;
  end if;
  insert into public.audit_log (actor, owner_id, table_name, row_id, op, changed)
    values ((select auth.uid()), (n ->> 'owner_id')::uuid, TG_TABLE_NAME, n ->> key, kind, diff);
  return new;
end;
$$;
revoke execute on function private.audit_row() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['courses', 'materials', 'topics', 'objectives', 'relations', 'exams', 'profiles', 'calendar_events', 'questions'] loop
    execute format('alter table public.%I add column if not exists updated_at timestamptz not null default now()', t);
    execute format('create trigger touch_updated_at before update on public.%I for each row execute function private.touch_updated_at()', t);
  end loop;
end;
$$;

-- What's audited, and what's left out. questions are written by jobs in bulk and never edited by
-- the student, so only their updates are kept (a rename or archive later); their inserts are
-- already counted in pipeline_runs.questions_added.
create trigger audit after insert or update on public.courses for each row execute function private.audit_row('id');
create trigger audit after insert or update on public.materials for each row execute function private.audit_row('id', 'hidden_text');
create trigger audit after insert or update on public.topics for each row execute function private.audit_row('id');
create trigger audit after insert or update on public.objectives for each row execute function private.audit_row('id');
create trigger audit after insert or update on public.relations for each row execute function private.audit_row('id');
create trigger audit after insert or update on public.exams for each row execute function private.audit_row('id');
create trigger audit after insert or update on public.calendar_events for each row execute function private.audit_row('id');
create trigger audit after update on public.profiles for each row execute function private.audit_row('owner_id', 'last_seen_at');
create trigger audit after update on public.questions for each row execute function private.audit_row('id');
create trigger audit after insert or update on public.question_feedback for each row execute function private.audit_row('question_id');
```

Before running it, check `materials`' current columns (`\d public.materials` via `npx supabase db dump --local --schema public` or the types file) and add any other large jsonb column to its skip list. Run `npm run locked -- npm run test:db` → PASS, then `npm run locked -- npm run db:types`.

- [ ] **Step 3: Check the hot paths don't slow down**

`save_structure` and the upload job write many topics and objectives at once; each row now writes one audit row. Run `npm run locked -- npx playwright test e2e/upload.spec.ts` and compare its duration with the last CI run (`gh run list --branch phase-4 -L 1` → `gh run view <id>`). A slowdown over ~20% means narrowing the topics and objectives triggers to `after update` only (inserts are already tied to a `pipeline_runs` row); note it in the commit.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261031090200_edit_history.sql supabase/tests/15_edit_history.test.sql src/lib/supabase/database.types.ts
git commit -m "Edit history: updated_at on every editable table and an audit_log of inserts and column-level changes (service role only)"
```

---

### Task 5: Soft delete in the schema and the app

**Files:**
- Create: `supabase/migrations/20261031090300_soft_delete.sql`
- Test: `supabase/tests/16_soft_delete.test.sql`
- Modify: `src/lib/store.tsx:585,603,617,656`; `src/lib/server/materials.ts:126-132` (`discard`); `src/lib/material/cleanup.ts:68-86`; `src/lib/server/security.ts:50`; `e2e/grade.spec.ts:113`; `docs/SETUP-HOSTED.md:182`; and every service-role read of `materials` / `exams` / `calendar_events` / `question_feedback` / `session_progress`: `src/app/add-material/page.tsx`, `src/app/api/evidence/route.ts`, `src/app/api/materials/chat/route.ts`, `src/app/api/materials/web/route.ts`, `src/app/api/reflect/route.ts`, `src/lib/jobs/start.ts`, `src/lib/server/figures.ts`, `src/lib/server/job-store.ts`, `src/lib/server/materials.ts`, `src/lib/uploads.ts`, `scripts/cleanup-uploads.ts`
- Test: `tests/material/cleanup.test.ts` (find the existing cleanup test with `grep -rl cleanupUploads tests`)

**Interfaces:**
- Produces: `deleted_at timestamptz` on `materials, exams, calendar_events, question_feedback, session_progress`; `deleted_reason text` on `materials` (`'duplicate' | 'abandoned' | 'failed' | 'student'`); `security_events.cleared_at timestamptz`. The browser reads (RLS select and `my_data`) never return a soft-deleted row. `materials_same_file` is unique only among live rows.

- [ ] **Step 1: Write the failing pgTAP test** `supabase/tests/16_soft_delete.test.sql`

```sql
-- Soft delete: a deleted_at row is gone from the student's reads but still in the table.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

\set A aaaaaaaa-0000-4000-8000-000000000001
\set course c0000000-0000-4000-8000-00000000000a
\set exam e0000000-0000-4000-8000-00000000000e
\set m1 d0000000-0000-4000-8000-000000000001
\set m2 d0000000-0000-4000-8000-000000000002
insert into auth.users (id, email) values (:'A', 'a@columbia.edu');
insert into public.courses (id, owner_id, slug, name, short, variant, pos_x, pos_y) values (:'course', :'A', 'ald', 'ALD', 'ALD', 'ald', 0, 0);
insert into public.exams (id, owner_id, course_id, title, date) values (:'exam', :'A', :'course', 'Midterm', '2026-11-10');
insert into public.materials (id, owner_id, course_id, filename, type, content_hash, deleted_at, deleted_reason)
  values (:'m1', :'A', :'course', 'a.pdf', 'Lecture', 'h1', now(), 'duplicate');

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  select set_config('role', 'authenticated', true);
$$;

select set_config('role', 'postgres', true);
select lives_ok(format($$insert into public.materials (id, owner_id, course_id, filename, type, content_hash) values (%L, %L, %L, 'a.pdf', 'Lecture', 'h1')$$, :'m2', :'A', :'course'), 'a soft-deleted file does not block uploading it again');

select pg_temp.act_as(:'A');
update public.exams set deleted_at = now() where id = :'exam';
select is((select count(*) from public.exams)::int, 0, 'a soft-deleted exam is gone from the student''s reads');
select is(jsonb_array_length(public.my_data() -> 'exams'), 0, 'and from my_data');
select is(jsonb_array_length(public.my_data() -> 'materials'), 1, 'my_data returns only the live material');

select set_config('role', 'postgres', true);
select is((select count(*) from public.exams where id = :'exam')::int, 1, 'but the row is still there');
select is((select count(*) from public.audit_log where table_name = 'exams' and op = 'soft_delete')::int, 1, 'and its deletion is in the history');

select * from finish();
rollback;
```

Run: `npm run locked -- npm run test:db` → FAIL (`column "deleted_at" does not exist`).

- [ ] **Step 2: Write the migration** `supabase/migrations/20261031090300_soft_delete.sql`

Write `my_data` from its latest definition (`20261019090000_session_progress.sql`; confirm none is newer with `grep -l "function public.my_data" supabase/migrations/*.sql | tail -1`), adding `and r.deleted_at is null` to the five soft-deletable sources. Write `course_structure` the same way if it reads `materials` (check its latest definition in `20261029090000_course_structure_topic_merges.sql`).

```sql
-- Soft delete (2026-10-27 plan): nothing a student made is removed; a deletion sets deleted_at.
-- The student's reads (RLS and my_data) leave those rows out; the service role sees them and must
-- filter (every server read of these tables says `.is("deleted_at", null)`).
alter table public.materials add column deleted_at timestamptz,
  add column deleted_reason text check (deleted_reason in ('duplicate', 'abandoned', 'failed', 'student')),
  add constraint materials_deleted_reason check ((deleted_at is null) = (deleted_reason is null));
alter table public.exams add column deleted_at timestamptz;
alter table public.calendar_events add column deleted_at timestamptz;
alter table public.question_feedback add column deleted_at timestamptz;
alter table public.session_progress add column deleted_at timestamptz;
-- An owner's "clear" of flagged answers (it used to delete them): grading counts only uncleared ones.
alter table public.security_events add column cleared_at timestamptz;

drop index public.materials_same_file;
create unique index materials_same_file on public.materials (course_id, content_hash)
  where content_hash is not null and deleted_at is null;

-- Student reads skip deleted rows.
alter policy "own materials: read" on public.materials using (owner_id = (select auth.uid()) and deleted_at is null);
alter policy "own feedback: read" on public.question_feedback using (owner_id = (select auth.uid()) and deleted_at is null);
-- Same for exams, calendar_events and session_progress: look up their read policy names with
--   select tablename, policyname from pg_policies where cmd = 'SELECT' and tablename in ('exams', 'calendar_events', 'session_progress');
-- and write one `alter policy … using (owner_id = (select auth.uid()) and deleted_at is null)` each.

-- The student's own soft delete and restore are updates of deleted_at.
grant update (deleted_at) on public.exams, public.calendar_events, public.question_feedback, public.session_progress to authenticated;

create or replace function public.my_data() returns jsonb
language sql stable security invoker set search_path = '' as $$
  -- (the latest definition, with `and r.deleted_at is null` on materials, calendar, exams,
  --  question_feedback and session_progress; every other line unchanged)
$$;
```

The comment inside `my_data` above marks where the engineer pastes the current body; write the full function, not that comment. Check for existing column-level grants on `exams`, `calendar_events`, `question_feedback` and `session_progress` first (`grep -n "grant update" supabase/migrations/*.sql`): if a table still has a table-wide `update` grant, `grant update (deleted_at)` adds nothing and can be left out for it.

Run `npm run locked -- npm run test:db` → PASS, then `npm run locked -- npm run db:types`.

- [ ] **Step 3: Replace every app delete with a soft delete**

`src/lib/store.tsx`:

```ts
// saveProgress (line 585)
if (!progress) return void must(await db.from("session_progress").update({ deleted_at: new Date().toISOString() }).eq("course_id", courseId).eq("kind", kind).is("deleted_at", null));
must(await db.from("session_progress").upsert({ ...progressToRow(progress), deleted_at: null }, { onConflict: "owner_id,course_id,kind" }));

// rateQuestion (line 603)
if (!rating) return void must(await db.from("question_feedback").update({ deleted_at: new Date().toISOString() }).eq("question_id", questionId).is("deleted_at", null));
// …and add `deleted_at: null` to its upsert payload, so re-rating revives the row.

// removeExam (line 617)
save(async () => mustChange(await browserSupabase().from("exams").update({ deleted_at: new Date().toISOString() }).eq("id", id).is("deleted_at", null).select("id")));

// updateMaterial (line 656)
if (old && !event) must(await db.from("calendar_events").update({ deleted_at: new Date().toISOString() }).eq("material_id", id).is("deleted_at", null));
```

The `session_progress` upsert sends `deleted_at: null`, but the browser has only `update (deleted_at)` on that table, which is enough for the conflict path. Its insert path needs `deleted_at` in the insert grant too, if inserts on that table are column-restricted; check with `npm run locked -- npx playwright test e2e/resume.spec.ts` (or whichever spec covers resuming: `grep -l "Resume" e2e/*.spec.ts`).

`src/lib/server/materials.ts` `discard`: keep the Storage file, mark the row.

```ts
/** An upload that turned out to be a file the course already has: marked deleted (its file is kept). */
async function discard(db: OrcaSupabase, ownerId: string, id: string) {
  const { error } = await db.from("materials").update({ deleted_at: new Date().toISOString(), deleted_reason: "duplicate" }).eq("owner_id", ownerId).eq("id", id);
  if (error) throw fail("set aside the duplicate upload", error);
}
```

Drop the `path` argument at its call site(s).

`src/lib/material/cleanup.ts`: `cleanupUploads` no longer removes files. It sets `deleted_at = now()` and `deleted_reason = u.why` (`'abandoned' | 'failed'`) on each stale row. Its list query adds `.is("deleted_at", null)`, so a row is set aside once. Rewrite its doc comment ("removed" becomes "set aside; file and row kept"). Update `tests/material/cleanup.test.ts` so the fake client expects an `update` with `{ deleted_at, deleted_reason }` and no `storage.remove` call. `staleUploads` (pure) is unchanged and its tests stand.

`src/lib/server/security.ts:50`: add `.is("cleared_at", null)` to the count.

`e2e/grade.spec.ts:113`: `await admin().from("security_events").update({ cleared_at: new Date().toISOString() }).eq("owner_id", student.id);`

`docs/SETUP-HOSTED.md:182`: change the commented `delete from public.security_events …` to `update public.security_events set cleared_at = now() where owner_id = '<uuid>' and kind = 'student_answer' and cleared_at is null;`.

- [ ] **Step 4: Filter every service-role read**

For each file in this task's list, add `.is("deleted_at", null)` to each `.from("materials" | "exams" | "calendar_events" | "question_feedback" | "session_progress")` **select**. Leave out the reads that look a row up by its own id to process it (`processUpload` reading the material it was handed). Find them all with:

```bash
grep -rn 'from("materials")\|from("exams")\|from("calendar_events")\|from("question_feedback")\|from("session_progress")' src scripts | grep -v database.types
```

`processUpload` should answer 404 for a soft-deleted material: add `if (m.deleted_at) return reply(404, { error: "No such upload." });` after its read. Then check that no `.delete(` is left anywhere in app code:

```bash
grep -rn '\.delete(' src scripts | grep -v database.types
```

Expected: no output.

- [ ] **Step 5: Run checks**

Run: `npx tsc --noEmit && npx eslint src/lib/store.tsx src/lib/server src/lib/material src/app/api src/app/add-material src/lib/jobs src/lib/uploads.ts scripts && npm test -- tests/material && npm run locked -- npx playwright test e2e/grade.spec.ts e2e/upload.spec.ts e2e/exams.spec.ts`
(Find the exams and calendar specs with `ls e2e`; run the ones covering exams, uploads' due dates and resume.)
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261031090300_soft_delete.sql supabase/tests/16_soft_delete.test.sql src scripts tests e2e/grade.spec.ts docs/SETUP-HOSTED.md
git commit -m "Soft delete: deleted_at on materials, exams, calendar entries, feedback and unfinished sessions; the app never deletes a row; files are kept"
```

---

### Task 6: Hard deletes are refused (tables and accounts)

**Files:**
- Create: `supabase/migrations/20261031090400_no_hard_deletes.sql`
- Modify: `supabase/tests/01_ownership.test.sql:141-144`, `supabase/tests/16_soft_delete.test.sql` (add the guard assertions), `e2e/fixture.ts:80-84`, `e2e/global-setup.ts:64`, `e2e/auth.spec.ts:42`, `e2e/upload.spec.ts:326`, `scripts/check-isolation.ts:181-182`, `scripts/check-evidence.ts:327`

**Interfaces:**
- Produces: `private.forbid_delete()`. Any `DELETE` on a student-data table or on `auth.users` raises `Orca never deletes <table> rows; set deleted_at instead` (SQLSTATE `P0001`), whoever runs it, including the service role, the Supabase dashboard and the Auth admin API.

- [ ] **Step 1: Write the failing assertions**

In `supabase/tests/16_soft_delete.test.sql`, bump `plan(6)` to `plan(9)` and add before `finish()`:

```sql
select set_config('role', 'postgres', true);
select throws_ok(format($$delete from public.exams where id = %L$$, :'exam'), 'P0001', null, 'even the owner''s SQL cannot hard-delete an exam');
select throws_ok(format($$delete from public.evidence_events where owner_id = %L$$, :'A'), 'P0001', null, 'or evidence');
select throws_ok(format($$delete from auth.users where id = %L$$, :'A'), 'P0001', null, 'or an account');
```

In `supabase/tests/01_ownership.test.sql`, replace lines 141-144 (the "Deleting an account removes everything" block) with:

```sql
-- Accounts are never hard-deleted (2026-10-27): deleting one is refused, and their data stays.
select throws_ok(format($$delete from auth.users where id = %L$$, :'A'), 'P0001', null, 'deleting an account is refused');
select isnt((select count(*) from public.courses where owner_id = :'A'), 0::bigint, 'and A''s courses are still there');
```

Keep that file's `plan(n)` count right (two assertions out, two in). Run `npm run locked -- npm run test:db` → FAIL (the deletes succeed).

- [ ] **Step 2: Write the migration** `supabase/migrations/20261031090400_no_hard_deletes.sql`

```sql
-- No hard deletes (2026-10-27 plan, owner's rule): every student-data table, and auth.users,
-- refuses DELETE for everyone, the service role and the dashboard included. Deleting is
-- `deleted_at` (Task 5) or, for an account, POST /api/account/delete (soft delete + ban).
-- rate_limits is left out on purpose: hit_rate_limit prunes its own expired windows.
create function private.forbid_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Orca never deletes % rows; set deleted_at instead', TG_TABLE_NAME using errcode = 'P0001';
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'courses', 'materials', 'material_pages', 'pipeline_runs', 'topics', 'objectives', 'relations',
    'questions', 'session_results', 'calendar_events', 'evidence_events', 'objective_state', 'security_events',
    'model_usage', 'exams', 'question_feedback', 'session_progress', 'activity_events', 'audit_log'
  ] loop
    execute format('create trigger forbid_delete before delete on public.%I for each row execute function private.forbid_delete()', t);
    execute format('revoke delete on public.%I from anon, authenticated', t);
  end loop;
end;
$$;

-- Accounts: GoTrue's delete (dashboard "Delete user", auth.admin.deleteUser) fails here.
create trigger forbid_delete before delete on auth.users for each row execute function private.forbid_delete();

drop policy if exists "own feedback: remove" on public.question_feedback;
-- Drop every other delete policy too:
--   select tablename, policyname from pg_policies where cmd = 'DELETE' and schemaname = 'public';
-- one `drop policy "<name>" on public.<table>;` per row.
```

Before writing it, check the table list against `grep -ho "create table public\.[a-z_]*" supabase/migrations/*.sql | sort -u`, and check that `objective_state` maintenance never deletes rows: `grep -n "delete" supabase/migrations/20261005170500_snapshots.sql` (it marks rows `stale`; no output from the grep means it's safe). Also check whether the **Storage** "remove" policy (`20261005170400_storage.sql`) lets the browser delete its own files. If so, drop it here and note that Storage objects are kept (assumption 2).

- [ ] **Step 3: Stop the tests from deleting accounts**

The local stack is reset before every locked run, and CI starts a fresh one, so test accounts can simply stay. On a hosted run of `check:isolation` they stay too, flagged `test` (Task 1).
- `e2e/fixture.ts`: delete the teardown after `await use(…)` (the Storage remove and `deleteUser`), and replace it with the comment `// Accounts are never deleted (they're marked test); the stack is reset before each run.`
- `e2e/global-setup.ts:64`, `e2e/auth.spec.ts:42`, `e2e/upload.spec.ts:326`: remove the `deleteUser` calls (and the now-unneeded `finally` / cleanup arrays).
- `scripts/check-isolation.ts:181-182` and `scripts/check-evidence.ts:327`: remove the Storage `DELETE` and the `/auth/v1/admin/users/<id>` `DELETE` calls; keep `app.stop()`.

- [ ] **Step 4: Run checks**

Run: `npm run locked -- npm run test:db && npm run locked -- npm run check:isolation && npm run locked -- npm run check:evidence && npm run locked -- npx playwright test e2e/auth.spec.ts e2e/upload.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261031090400_no_hard_deletes.sql supabase/tests e2e scripts
git commit -m "Refuse hard deletes on every student-data table and on auth.users; tests keep their (test-flagged) accounts"
```

---

### Task 7: Account soft delete

**Files:**
- Create: `src/app/api/account/delete/route.ts`
- Modify: `src/components/settings/Account.tsx` (a "Delete account" control with a confirm step, beside Sign out)
- Test: `e2e/account-delete.spec.ts`

**Interfaces:**
- Consumes: `profiles.deleted_at` (Task 1), `recordServerActivity` (Task 2)
- Produces: `POST /api/account/delete` with body `{ confirm: "delete" }` → 200 `{ deleted: true }`; it sets `profiles.deleted_at`, bans the auth user (`ban_duration: "876000h"`, about 100 years) and records `account_deleted`.

- [ ] **Step 1: Write the failing spec** `e2e/account-delete.spec.ts`

```ts
import { createClient } from "@supabase/supabase-js";
import { admin, expect, test } from "./fixture";

test("deleting an account marks it deleted, keeps its data, and stops sign-in", async ({ page, student }) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: "Delete account" }).click();
  await page.getByRole("button", { name: "Yes, delete my account" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  const { data: profile } = await admin().from("profiles").select("deleted_at").eq("owner_id", student.id).single();
  expect(profile?.deleted_at).not.toBeNull();
  const fresh = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const again = await fresh.auth.signInWithPassword({ email: student.email, password: student.password });
  expect(again.error).not.toBeNull();
  const { count } = await admin().from("activity_events").select("id", { count: "exact", head: true }).eq("owner_id", student.id).eq("name", "account_deleted");
  expect(count).toBe(1);
});
```

Run: `npm run locked -- npx playwright test e2e/account-delete.spec.ts` → FAIL (no button).

- [ ] **Step 2: Write the route**

```ts
import { z } from "zod";
import { recordServerActivity } from "@/lib/server/activity";
import { forStudent, reply } from "@/lib/server/student";

/** POST { confirm: "delete" } → 200: the account is marked deleted (nothing is removed) and banned from signing in. */
export const runtime = "nodejs";

const Body = z.object({ confirm: z.literal("delete") });

export async function POST(request: Request) {
  return forStudent(request, async (student, db) => {
    if (!Body.safeParse(await request.json().catch(() => null)).success) return reply(400, { error: "Confirm to delete your account." });
    const { error } = await db.from("profiles").update({ deleted_at: new Date().toISOString() }).eq("owner_id", student.id).is("deleted_at", null);
    if (error) return reply(500, { error: "Orca couldn't delete your account." });
    const banned = await db.auth.admin.updateUserById(student.id, { ban_duration: "876000h" });
    if (banned.error) return reply(500, { error: "Orca couldn't delete your account." });
    await recordServerActivity(db, student.id, "account_deleted");
    return reply(200, { deleted: true });
  });
}
```

- [ ] **Step 3: The Settings control**

In `src/components/settings/Account.tsx`, next to the Sign out form: a ghost button "Delete account". It reveals the confirm text "Your account is closed and you're signed out. Your courses and answers are kept, and the owner can restore it." and a button "Yes, delete my account". That button posts `{ confirm: "delete" }` to `/api/account/delete` and, on 200, calls the existing `signOut` server action (it redirects to `/sign-in`). Use the existing UI primitives in `src/components/ui/` and the existing error display pattern of that card. Copy is the owner's call; flag it in the brief.

- [ ] **Step 4: Run checks and commit**

Run: `npx next typegen && npx tsc --noEmit && npx eslint src/app/api/account src/components/settings/Account.tsx && npm run locked -- npx playwright test e2e/account-delete.spec.ts` → PASS.

```bash
git add src/app/api/account src/components/settings/Account.tsx e2e/account-delete.spec.ts
git commit -m "Delete account: soft delete and ban (nothing removed), recorded as account_deleted"
```

---

### Task 8: Owner's views, adoption SQL and docs

**Files:**
- Create: `supabase/migrations/20261031090500_admin_views.sql`
- Modify: `docs/SETUP-HOSTED.md` §7, `docs/BACKEND-ROADMAP.md`, `docs/TO-DISCUSS.md`, `CLAUDE.md`
- Test: add to `supabase/tests/13_accounts.test.sql`

**Interfaces:**
- Produces: `private.user_overview` (one row per account: email, kind, created, confirmed, last sign-in, last seen, deleted, banned, courses, uploads, answers, active days) and `private.daily_actives` (day, students active by answers, by any activity). Readable only from the SQL editor (`private` isn't exposed to the API).

- [ ] **Step 1: Write the views**

```sql
-- The owner's monitoring views (2026-10-27 plan), read in the Supabase SQL editor. `private` isn't
-- exposed through the API, so students can't reach them.
create view private.user_overview as
select u.id, u.email, p.account_kind, u.created_at as signed_up_at, u.email_confirmed_at, u.last_sign_in_at,
  p.last_seen_at, p.deleted_at, u.banned_until,
  (select count(*) from public.courses c where c.owner_id = u.id) as courses,
  (select count(*) from public.materials m where m.owner_id = u.id and m.deleted_at is null and m.status = 'ready') as uploads_ready,
  (select count(*) from public.evidence_events e where e.owner_id = u.id and e.kind = 'answer') as answers,
  (select count(distinct (e.at at time zone p.timezone)::date) from public.evidence_events e where e.owner_id = u.id) as days_answering,
  (select max(e.at) from public.evidence_events e where e.owner_id = u.id) as last_answer_at
from auth.users u join public.profiles p on p.owner_id = u.id;

create view private.daily_actives as
with students as (select owner_id, timezone from public.profiles where account_kind = 'student' and deleted_at is null)
select d.day,
  count(distinct d.owner_id) filter (where d.src = 'answer') as answering,
  count(distinct d.owner_id) as active
from (
  select e.owner_id, (e.at at time zone s.timezone)::date as day, 'answer' as src from public.evidence_events e join students s using (owner_id)
  union all
  select a.owner_id, (a.at at time zone s.timezone)::date, 'activity' from public.activity_events a join students s using (owner_id)
) d group by d.day order by d.day;

revoke all on private.user_overview, private.daily_actives from public, anon, authenticated;
```

Add to `13_accounts.test.sql` (and bump its plan): `select is((select account_kind from private.user_overview where id = :'T'), 'test', 'user_overview shows the kind');`. Run `npm run locked -- npm run test:db` → PASS.

- [ ] **Step 2: `docs/SETUP-HOSTED.md` §7 — add "Adoption and activity"**

Add these queries, each with a one-line comment above it:

```sql
-- Mark the team's own accounts (run once on production; repeat for new teammates).
update public.profiles set account_kind = 'team'
where owner_id in (select id from auth.users where email in ('<owner email>', '<teammate email>'));

-- Everyone, newest first (filter account_kind = 'student' for real students).
select * from private.user_overview order by signed_up_at desc;

-- Daily and weekly actives (real students only).
select * from private.daily_actives order by day desc limit 30;
select date_trunc('week', day) as week, max(active) as peak_day, sum(active) as student_days from private.daily_actives group by 1 order by 1 desc;

-- Activation funnel: signed up → confirmed → made a course → an upload ready → answered.
select count(*) as signed_up, count(email_confirmed_at) as confirmed, count(*) filter (where courses > 0) as made_course,
  count(*) filter (where uploads_ready > 0) as upload_ready, count(*) filter (where answers > 0) as answered
from private.user_overview where account_kind = 'student' and deleted_at is null;

-- Feature use, last 30 days: views per screen and how many students opened it.
select route, count(*) as views, count(distinct owner_id) as students
from public.activity_events a join public.profiles p using (owner_id)
where a.name = 'page_view' and p.account_kind = 'student' and a.at > now() - interval '30 days'
group by route order by students desc;

-- Sessions: started vs finished vs left, by mode.
select props ->> 'mode' as mode, name, count(*) from public.activity_events
where name like 'session_%' and at > now() - interval '30 days' group by 1, 2 order by 1, 2;

-- One student's edit history.
select at, table_name, op, changed from public.audit_log where owner_id = '<uuid>' order by at desc limit 100;

-- Restore a deleted account.
update public.profiles set deleted_at = null where owner_id = '<uuid>';
-- …then Authentication → Users → the user → Unban (or auth.admin.updateUserById(id, { ban_duration: "none" })).
```

- [ ] **Step 3: Record the decisions**

`docs/BACKEND-ROADMAP.md`, in its decisions list: "2026-10-27 — Monitoring and no hard deletes". Cover:
- `activity_events` and `audit_log` are first-party Postgres tables (no analytics vendor, no new dependency). They're needed because evidence shows only answers, not visits, feature use or edits.
- `account_kind` separates students from team and test accounts.
- Soft delete everywhere: `deleted_at`; a `forbid_delete` trigger on every student table and on `auth.users`; accounts are soft-deleted and banned.
- Exceptions: `rate_limits` pruning.

`docs/TO-DISCUSS.md`: add the six assumptions from the top of this plan as open items under a "Monitoring and soft delete (2026-10-27)" heading. Erasure requests and the privacy notice go first.

`CLAUDE.md`:
- Stack paragraph: add `activity_events`, `audit_log`, `profiles.account_kind/last_seen_at/deleted_at`, `deleted_at` on the five tables, and "no table allows DELETE".
- "What exists": add `src/lib/activity/` and `POST /api/activity`.
- Environment gotchas: add "tests never delete accounts; test accounts carry `app_metadata.account_kind = 'test'`".

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261031090500_admin_views.sql supabase/tests/13_accounts.test.sql src/lib/supabase/database.types.ts docs CLAUDE.md
git commit -m "Owner's monitoring views (user_overview, daily_actives), adoption SQL, and the decisions recorded"
```

---

### Task 9: Merge gate

- [ ] Run, through the stack lock:

```bash
npm test
npm run locked -- npm run test:db
npm run locked -- npm run test:e2e
npm run locked -- npm run check:isolation
npm run locked -- npm run check:evidence
npx tsc --noEmit && npm run lint && npm run build
```

Expected: all PASS. Read a failing run's trace before changing a test (CLAUDE.md).

- [ ] Push `phase-4` (fast-forward only) and open the PR to `main`. Merging it runs the Deploy workflow, which pushes the six migrations to production before deploying (the order matters: Task 1's column grants and Task 6's guards must land with the code that stops deleting). Note in the PR that the owner then runs the "mark the team's accounts" SQL from `docs/SETUP-HOSTED.md` §7.
