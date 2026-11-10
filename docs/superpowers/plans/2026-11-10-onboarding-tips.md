# Onboarding Tips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status (2026-11-10):** built on branch `onboarding`; not merged. As built, the geometry is the generic `src/lib/anchor-geometry.ts` (tests in `tests/anchor-geometry.test.ts`), and the bubble, spotlight, key caps and inline confirm are reusable `src/components/ui/` pieces (`AnchoredBubble`, `Spotlight` with `data-part` `spotlight-dim`/`spotlight-ring`, `Kbd`, `InlineConfirm`, `Button size="xs"`) with `useElementBox` in `src/hooks/`; `TipBubble` composes them. Otherwise as below. Branch `onboarding` (off `main`), worked in the worktree `.claude/worktrees/onboarding`.

**Goal:** New students get skippable pop-up tips, spoken by the orca, that point at the next thing to do (create a course, write Notes for Orca, upload, flag hard slides, and so on) while the rest of the screen is slightly desaturated.

**Architecture:** There is no linear tour. A catalogue of tips (pure module) says, for each tip, which page it belongs to and which element it points at; a single client component mounted once in `providers.tsx` polls the page, and when unseen tips have their targets on screen it shows them one at a time. Which tips were seen, and whether the student skipped them all, is one jsonb column on `profiles`, so it follows the account.

**Tech Stack:** Next.js 16 (App Router), React 19, Tailwind v4, `motion`, Supabase (Postgres + RLS), zod, `node:test`, pgTAP, Playwright.

## Decisions (owner, 2026-11-09/10)

- Tips are contextual, not one tour: each shows the first time its feature is on screen.
- A tip has an **X** in its corner, a **Back** button showing the `←` key and a **Next** button showing the `→` key. The arrow keys do the same; Esc is the X.
- **"Skip all tips"** asks inline ("Skip all tips? They won't come back. Skip · Keep going"). Skipped tips never come back: there is no switch to turn them on again.
- Progress is saved **per account**.
- The orca mascot speaks the tips (first person).
- **No** warm-up tip. **No** Notes for Orca box on `/new-course`: the tip sends the student to the course's settings instead.
- Pointed out: Add Course, Canvas import (on `/new-course`), the island and its looks, the course's settings and Notes for Orca, uploading, the handwritten-marks hint, the upload toast, "Which slides were hard?", rejecting topics and objectives, the path (weak spots), the Atlas (and hovering an edge), Edit Exams, "This topic is hard", "Don't know", thumbs down, the quick review, Dive in.
- Shown later, only after the student has finished one session: a pointer to Settings, and there the account's Notes for Orca, marker notes, Canvas and the Claude connector.

## Assumptions to confirm (also recorded in `docs/TO-DISCUSS.md`, Task 7)

1. **X dismisses that one tip for good** and the next tip on the same page follows (the same as Next). "Skip all tips" is the way out of all of them.
2. **Existing accounts get the tips too** (the column defaults to nothing seen). They are contextual, so an existing student sees each once, or skips them in two clicks.
3. **A tip the student ignores** (they leave the page without touching it or its target) shows again on the next visit. Clicking the thing it points at counts as seen.
4. **No "Getting started" checklist** in this version: the later features are covered by the Settings tips.
5. The Canvas tip does not promise exams pulled from Canvas (not built yet).

## Global Constraints

- Work on branch `onboarding`; never commit to `main`. Commit as the machine's git user (never pass `-c user.name/user.email`).
- No new dependency (no tour or positioning library).
- Colors are design tokens only (`prussian`, `wisteria`, `wisteria-deep`, `alice`, `alice-deep`, `parchment`, `bad-text`); pixel values inline are fine.
- Animation presets come from `src/lib/motion.ts` (`popIn`); never inline a transition.
- Pure modules (`src/lib/onboarding/*.ts`) load under plain Node: relative imports ending in `.ts`, `import type`, no TS parameter properties, no `@/` alias.
- `data-part` attributes are test hooks: add the new ones named here, never rename an existing one.
- `react/no-danger` is an error. Tests never call a real model.
- Node: `export PATH=$HOME/.nvm/versions/node/v24.20.0/bin:$PATH` before any `npm`/`npx` command.
- Per commit (Fix mode): `npx tsc --noEmit`, `npx eslint <changed files>`, and the one unit test file for the change. Anything touching the local database or ports 3100/3101 goes through `npm run locked -- …`.
- The new migration is `20261110090000_onboarding_tips.sql` (newest on `main` is `20261108100000`; if a newer one has landed, renumber after it).
- Tip copy: the orca speaks in the first person, at most two or three short sentences (the unit test caps a body at 220 characters).

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261110090000_onboarding_tips.sql` (new) | `profiles.onboarding` jsonb |
| `supabase/tests/19_onboarding.test.sql` (new) | default, own update, shape check, isolation |
| `src/lib/onboarding/state.ts` (new, pure) | `OnboardingState`, its zod schema, `withSeen`, `onboardingFromProfile` |
| `src/lib/onboarding/tips.ts` (new, pure) | the tip catalogue `TIPS` and `eligibleTips` |
| `src/lib/onboarding/place.ts` (new, pure) | geometry: `placeBubble`, `spotlightClip` |
| `src/components/onboarding/active-tip.ts` (new) | which tip is showing, for components that react to it (the toast) |
| `src/components/onboarding/Spotlight.tsx` (new) | the desaturating layer and the ring around the target |
| `src/components/onboarding/TipBubble.tsx` (new) | the orca's speech bubble: text, X, Back/Next with key caps, skip confirm |
| `src/components/onboarding/OnboardingTips.tsx` (new) | the engine: finds tips, tracks the target, keys, seen/skip |
| `src/lib/supabase/app-rows.ts`, `src/lib/store.tsx` | load `onboarding`; `markTipsSeen`, `skipTips` |
| `src/app/providers.tsx` | mount `<OnboardingTips />` |
| `src/app/page.tsx`, `src/components/layout/NavBar.tsx`, `src/app/course/[slug]/page.tsx`, `src/app/add-material/page.tsx`, `src/components/layout/UploadToasts.tsx` | new `data-part` anchors; the toast stays up while its tip points at it |
| `tests/onboarding/{state,tips,place}.test.ts` (new) | unit tests |
| `e2e/fixture.ts`, `e2e/onboarding.spec.ts` (new) | tips off for test students by default; the browser test |

---

### Task 1: Saved state (migration, pure state module, store)

**Files:**
- Create: `supabase/migrations/20261110090000_onboarding_tips.sql`, `supabase/tests/19_onboarding.test.sql`, `src/lib/onboarding/state.ts`, `tests/onboarding/state.test.ts`
- Modify: `src/lib/supabase/app-rows.ts` (`LoadedState` ~line 438, `loadedState` ~line 506), `src/lib/store.tsx` (state ~line 99–148, actions ~line 193 and ~815, the context value ~line 944), `tests/supabase/app-rows.test.ts:57`, `src/lib/supabase/database.types.ts` (regenerated)

**Interfaces:**
- Produces: `OnboardingState = { seen: string[]; skipped: boolean }`; `NEW_ONBOARDING`, `TIPS_OFF`; `withSeen(state, ids): OnboardingState`; `onboardingFromProfile(value: unknown): OnboardingState`; on `useOrca()`: `onboarding: OnboardingState`, `markTipsSeen(ids: readonly string[]): void`, `skipTips(): void`.

- [ ] **Step 1: Write the failing unit test** — `tests/onboarding/state.test.ts`

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { NEW_ONBOARDING, TIPS_OFF, onboardingFromProfile, withSeen } from "../../src/lib/onboarding/state.ts";

test("a seen tip is added once, in the order seen", () => {
  const a = withSeen(NEW_ONBOARDING, ["add-course"]);
  assert.deepEqual(a, { seen: ["add-course"], skipped: false });
  assert.deepEqual(withSeen(a, ["island", "add-course"]).seen, ["add-course", "island"]);
});

test("nothing new returns the same object, so callers can tell there is nothing to save", () => {
  const a = withSeen(NEW_ONBOARDING, ["add-course"]);
  assert.equal(withSeen(a, ["add-course"]), a);
  assert.equal(withSeen(a, []), a);
});

test("a profile's value is read as stored; a malformed one throws", () => {
  assert.deepEqual(onboardingFromProfile({ seen: ["x"], skipped: true }), { seen: ["x"], skipped: true });
  assert.throws(() => onboardingFromProfile({ seen: "all" }));
  assert.throws(() => onboardingFromProfile(null));
});

test("a database from before the column has the tips off", () => {
  assert.deepEqual(onboardingFromProfile(undefined), TIPS_OFF);
  assert.equal(TIPS_OFF.skipped, true);
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `TZ=UTC node --experimental-strip-types --import ./tests/support/register.mjs --test tests/onboarding/state.test.ts`
Expected: FAIL, `Cannot find module … src/lib/onboarding/state.ts`.

- [ ] **Step 3: Write `src/lib/onboarding/state.ts`**

```ts
/**
 * What an account has done with the onboarding tips (profiles.onboarding): the ids of the tips it
 * has seen, and whether it skipped them all. Skipped tips never come back (owner, 2026-11-10). Pure.
 */
import { z } from "zod";

export const OnboardingSchema = z.object({ seen: z.array(z.string()), skipped: z.boolean() });
export type OnboardingState = z.infer<typeof OnboardingSchema>;

/** A new account: nothing seen. */
export const NEW_ONBOARDING: OnboardingState = { seen: [], skipped: false };
/** No tips at all: before the student's data is loaded, and on a database without the column. */
export const TIPS_OFF: OnboardingState = { seen: [], skipped: true };

/** The state with these tips seen too. The same object when none of them is new. */
export function withSeen(state: OnboardingState, ids: readonly string[]): OnboardingState {
  const fresh = ids.filter((id, i) => !state.seen.includes(id) && ids.indexOf(id) === i);
  return fresh.length ? { ...state, seen: [...state.seen, ...fresh] } : state;
}

/**
 * The profile row's value. A database from before the column (a hosted project whose migrations
 * are pushed by hand) sends none: the tips stay off there, since seeing one couldn't be saved.
 */
export function onboardingFromProfile(value: unknown): OnboardingState {
  if (value === undefined) return TIPS_OFF;
  return OnboardingSchema.parse(value);
}
```

- [ ] **Step 4: Run it, expect pass**

Run: the command from Step 2. Expected: 4 tests pass.

- [ ] **Step 5: Write the migration** — `supabase/migrations/20261110090000_onboarding_tips.sql`

```sql
-- Onboarding tips (2026-11-10): which tips the student has seen and whether they skipped them all.
-- Kept on the account so another device doesn't replay them. The browser writes it under the
-- profile's own update policy, as it does the avatar. my_data() sends the whole profile row, so it
-- needs no change.
alter table public.profiles
  add column onboarding jsonb not null default '{"seen":[],"skipped":false}'::jsonb
  check (
    jsonb_typeof(onboarding) = 'object'
    and jsonb_typeof(onboarding -> 'seen') = 'array'
    and jsonb_typeof(onboarding -> 'skipped') = 'boolean'
    and pg_column_size(onboarding) < 4000
  );
```

- [ ] **Step 6: Write the database test** — `supabase/tests/19_onboarding.test.sql`

```sql
-- Onboarding tips (2026-11-10): profiles.onboarding starts empty, its owner can save it, a
-- malformed value is refused, and nobody else can change it.
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

\set A aaaaaaaa-0000-4000-8000-000000000191
\set B bbbbbbbb-0000-4000-8000-000000000191

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  select set_config('role', 'authenticated', true);
$$;

insert into auth.users (id, email) values (:'A', 'a19@example.com'), (:'B', 'b19@example.com');

select is((select onboarding from public.profiles where owner_id = :'A'), '{"seen":[],"skipped":false}'::jsonb,
  'a new profile has seen no tips and skipped none');

select pg_temp.act_as(:'A');
select lives_ok($$update public.profiles set onboarding = '{"seen":["add-course"],"skipped":true}'$$, 'A saves their own tips');
select throws_ok($$update public.profiles set onboarding = '{"seen":"all"}'$$, '23514', null, 'a malformed value is refused');

select pg_temp.act_as(:'B');
update public.profiles set onboarding = '{"seen":[],"skipped":false}' where owner_id = :'A';
reset role;
select is((select onboarding from public.profiles where owner_id = :'A'), '{"seen":["add-course"],"skipped":true}'::jsonb,
  'B can''t change A''s tips');

select * from finish();
rollback;
```

- [ ] **Step 7: Apply, test, regenerate types** (local stack must be up: `npm run db:start`)

Run: `npm run locked -- npm run test:db` — expected: all files pass, including `19_onboarding.test.sql .. ok`.
Run: `npm run locked -- npm run db:types` — expected: `src/lib/supabase/database.types.ts` gains `onboarding: Json` on `profiles` (Row, and optional on Insert/Update).

- [ ] **Step 8: Load it** — `src/lib/supabase/app-rows.ts`

Add beside the other imports (they are relative with `.ts`):

```ts
import { type OnboardingState, onboardingFromProfile } from "../onboarding/state.ts";
```

In `interface LoadedState`, after `onboarded: boolean;`:

```ts
  /** The onboarding tips: which were seen, and whether they were all skipped. */
  onboarding: OnboardingState;
```

In `loadedState`'s returned object, after `onboarded: d.profile.onboarded,`:

```ts
    onboarding: onboardingFromProfile((d.profile as { onboarding?: unknown }).onboarding),
```

In `tests/supabase/app-rows.test.ts:57`, add `onboarding: { seen: ["add-course"], skipped: false },` to the `profile` object (after `marker_notes: null,`), and in that same test, after `const s = loadedState(data);` (line 71), add:

```ts
  assert.deepEqual(s.onboarding, { seen: ["add-course"], skipped: false });
```

Run: `TZ=UTC node --experimental-strip-types --import ./tests/support/register.mjs --test tests/supabase/app-rows.test.ts` — expected: pass.

- [ ] **Step 9: Store state and actions** — `src/lib/store.tsx`

Imports: beside `import type { Json } from "./supabase/database.types";` (line 77), add `import { type OnboardingState, TIPS_OFF, withSeen } from "./onboarding/state";`.

In the state interface, after `onboarded: boolean;` (~line 103):

```ts
  /** The onboarding tips (off until the student's data is in). */
  onboarding: OnboardingState;
```

In the initial state, after `onboarded: false,` (~line 146): `onboarding: TIPS_OFF,`. The loaded state is spread into the store's state, so `onboarding` arrives with the rest (check with `grep -n "markerNotes" src/lib/store.tsx`: it is only declared and defaulted, never copied by hand).

In `interface OrcaActions`, after `setOnboarded: (v: boolean) => void;` (~line 193):

```ts
  /** These onboarding tips were seen (or dismissed): they don't show again. */
  markTipsSeen: (ids: readonly string[]) => void;
  /** "Skip all tips": none shows again, on any device. */
  skipTips: () => void;
```

After the `setOnboarded` callback (~line 826):

```ts
  // The tips' state is one value: each save sends it whole as it is by then (saves run in order,
  // so the last one holds every change).
  const changeOnboarding = useCallback(
    (change: (o: OnboardingState) => OnboardingState) => {
      setState((s) => {
        const onboarding = change(s.onboarding);
        return onboarding === s.onboarding ? s : { ...s, onboarding };
      });
      save(async () => {
        const { data } = await browserSupabase().auth.getSession();
        if (!data.session) throw new Error("you're signed out");
        mustChange(await browserSupabase().from("profiles").update({ onboarding: stateRef.current.onboarding as unknown as Json }).eq("owner_id", data.session.user.id).select("owner_id"));
      });
    },
    [save],
  );
  const markTipsSeen = useCallback<OrcaActions["markTipsSeen"]>(
    (ids) => {
      if (withSeen(stateRef.current.onboarding, ids) === stateRef.current.onboarding) return; // nothing new: no save
      changeOnboarding((o) => withSeen(o, ids));
    },
    [changeOnboarding],
  );
  const skipTips = useCallback<OrcaActions["skipTips"]>(() => changeOnboarding((o) => ({ ...o, skipped: true })), [changeOnboarding]);
```

(`Json` is already imported at line 77. `stateRef.current = state` is assigned at ~line 324.)

Add `markTipsSeen, skipTips,` to the context value object (beside `setOnboarded,` ~line 944) and to that `useMemo`'s dependency array.

- [ ] **Step 10: Check and commit**

Run: `npx tsc --noEmit` and `npx eslint src/lib/onboarding src/lib/store.tsx src/lib/supabase/app-rows.ts tests/onboarding` — expected: clean.

```bash
git add supabase/migrations/20261110090000_onboarding_tips.sql supabase/tests/19_onboarding.test.sql src/lib/onboarding/state.ts tests/onboarding/state.test.ts src/lib/supabase/app-rows.ts src/lib/supabase/database.types.ts src/lib/store.tsx tests/supabase/app-rows.test.ts
git commit -m "Onboarding tips: profiles.onboarding (seen tips, skipped), loaded and saved by the store"
```

---

### Task 2: The tip catalogue (pure)

**Files:**
- Create: `src/lib/onboarding/tips.ts`, `tests/onboarding/tips.test.ts`

**Interfaces:**
- Produces: `interface Tip { id; route: RegExp; target: string; title; body; when?; after? }`, `interface TipContext { pathname: string; courses: number; sessions: number }`, `TIPS: readonly Tip[]`, `eligibleTips(ctx, seen: ReadonlySet<string>, present: (selector: string) => boolean, tips?): Tip[]`.
- The `target` selectors name `data-part`s that exist today, plus six added in Task 5: `add-course`, `course-settings-link`, `uncharted-add`, `weak-count`, `drop-target`, `material-type`.

- [ ] **Step 1: Write the failing test** — `tests/onboarding/tips.test.ts`

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { TIPS, type Tip, eligibleTips } from "../../src/lib/onboarding/tips.ts";

const everything = () => true;
/** Every target on the page except the upload toast (whose tip can show anywhere). */
const noToast = (s: string) => s !== '[data-part="upload-toast"]';
const ids = (tips: Tip[]) => tips.map((t) => t.id);
const none = new Set<string>();

test("ids are unique, and a tip only waits for one listed before it", () => {
  assert.equal(new Set(TIPS.map((t) => t.id)).size, TIPS.length);
  TIPS.forEach((t, i) => {
    if (t.after) assert.ok(TIPS.slice(0, i).some((p) => p.id === t.after), `${t.id} waits for ${t.after}, which isn't before it`);
  });
});

test("copy stays short: a title, and a body of at most 220 characters", () => {
  for (const t of TIPS) {
    assert.ok(t.title.length > 0 && t.title.length <= 40, `${t.id}: title`);
    assert.ok(t.body.length > 0 && t.body.length <= 220, `${t.id}: body is ${t.body.length} characters`);
  }
});

test("a student with no course is pointed at Add Course; with one, at the island", () => {
  assert.deepEqual(ids(eligibleTips({ pathname: "/", courses: 0, sessions: 0 }, none, (s) => noToast(s) && !s.includes("data-todo"))), ["add-course"]);
  assert.deepEqual(ids(eligibleTips({ pathname: "/", courses: 1, sessions: 0 }, none, noToast)), ["island", "quick-review"]);
});

test("a tip shows only where its target is on the page", () => {
  const ctx = { pathname: "/course/logic", courses: 1, sessions: 0 };
  const found = eligibleTips(ctx, none, (s) => s === '[data-part="course-settings-link"]' || s === '[data-part="uncharted-add"]');
  assert.deepEqual(ids(found), ["course-settings", "uncharted-add"]);
});

test("seen tips are left out", () => {
  const ctx = { pathname: "/course/logic", courses: 1, sessions: 0 };
  const found = eligibleTips(ctx, new Set(["course-settings", "weak-count"]), everything);
  assert.ok(!ids(found).includes("course-settings") && !ids(found).includes("weak-count"));
});

test("a tip that waits for another shows after it: later in the same run, or once it was seen", () => {
  const ctx = { pathname: "/course/logic", courses: 1, sessions: 0 };
  const noQuick = (s: string) => s !== 'aside [data-todo="quick"]';
  assert.ok(!ids(eligibleTips(ctx, none, noQuick)).includes("dive"), "no quick review yet: Dive in waits");
  const all = ids(eligibleTips(ctx, none, everything));
  assert.ok(all.indexOf("dive") > all.indexOf("quick-review"), "in one run, Dive in follows the quick review");
  assert.ok(ids(eligibleTips(ctx, new Set(["quick-review"]), noQuick)).includes("dive"));
});

test("the Settings tips wait until the student has finished a session", () => {
  assert.deepEqual(eligibleTips({ pathname: "/settings", courses: 1, sessions: 0 }, none, noToast), []);
  assert.deepEqual(ids(eligibleTips({ pathname: "/settings", courses: 1, sessions: 1 }, none, noToast)), ["settings-notes", "settings-markers", "settings-canvas", "settings-claude"]);
  assert.ok(ids(eligibleTips({ pathname: "/", courses: 1, sessions: 1 }, none, noToast)).includes("more-settings"));
});

test("the toast's tip can show on any signed-in page", () => {
  const only = (s: string) => s === '[data-part="upload-toast"]';
  for (const pathname of ["/", "/calendar", "/course/logic/atlas", "/session/logic"]) {
    assert.deepEqual(ids(eligibleTips({ pathname, courses: 1, sessions: 0 }, none, only)), ["upload-toast"]);
  }
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `TZ=UTC node --experimental-strip-types --import ./tests/support/register.mjs --test tests/onboarding/tips.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `src/lib/onboarding/tips.ts`**

```ts
/**
 * The onboarding tips (owner, 2026-11-10): what the orca points out to a new student, and when.
 * There is no fixed tour. A tip belongs to a page (`route`) and to an element on it (`target`, a CSS
 * selector); it shows the first time that element is on screen, in the order listed here. Pure.
 */

/** What a tip's conditions can read about the student. */
export interface TipContext {
  pathname: string;
  /** How many courses they have. */
  courses: number;
  /** How many sessions they have finished. */
  sessions: number;
}

export interface Tip {
  id: string;
  /** The pages it can show on, tested against the pathname. */
  route: RegExp;
  /** The element it points at; the tip waits until one is visible. */
  target: string;
  title: string;
  /** The orca speaking, first person. */
  body: string;
  /** A condition on the student's data. */
  when?: (ctx: TipContext) => boolean;
  /** Shows only after this tip: once it was seen, or later in the same run of tips. */
  after?: string;
}

const ANY = /^\//;
const MAP = /^\/$/;
const NEW_COURSE = /^\/new-course$/;
const COURSE = /^\/course\/[^/]+$/;
const COURSE_SETTINGS = /^\/course\/[^/]+\/settings$/;
const ADD_MATERIAL = /^\/add-material$/;
const REVIEW = /^\/course\/[^/]+\/review$/;
const ATLAS = /^\/course\/[^/]+\/atlas$/;
const COURSE_OR_ATLAS = /^\/course\/[^/]+(\/atlas)?$/;
const SESSION = /^\/session\/[^/]+$/;
const SETTINGS = /^\/settings$/;
/** The pages with the sidebar: the map and a course's trail. */
const WITH_SIDEBAR = /^\/(course\/[^/]+)?$/;

/** The later features wait until the student has finished one session. */
const settledIn = (ctx: TipContext) => ctx.sessions >= 1;

export const TIPS: readonly Tip[] = [
  /* ── Getting a course in ── */
  { id: "add-course", route: MAP, target: '[data-part="add-course"]', when: (c) => c.courses === 0, title: "Start with a class", body: "Hi, I'm Orca. Every class you take becomes an island here. Add your first one." },
  { id: "canvas-import", route: NEW_COURSE, target: '[data-part="import-from-canvas"]', title: "On CourseWorks?", body: "Connect Canvas and I'll bring in the class's files and due dates, so you don't upload them one by one." },
  { id: "island", route: MAP, target: '[data-part="island-spot"]', when: (c) => c.courses >= 1, title: "Your island", body: "This is your class. It starts bare and grows greener as you master your weak spots. Open it." },
  { id: "course-settings", route: COURSE, target: '[data-part="course-settings-link"]', title: "Tell me about this class", body: "Open this class's settings and tell me how its exams work. I read your notes every time I write topics and questions." },
  { id: "notes-for-orca", route: COURSE_SETTINGS, target: '[data-part="notes-for-orca"]', title: "Notes for Orca", body: "What kinds of questions does your teacher ask on exams? What does the class stress, and what can I skip? Write it here before you upload, and I'll shape your topics and questions around it." },
  { id: "uncharted-add", route: COURSE, target: '[data-part="uncharted-add"]', title: "Add your material", body: "Give me your lecture slides, notes, homework or past exams. I'll map the class into topics." },
  { id: "drop-files", route: ADD_MATERIAL, target: '[data-part="drop-target"]', title: "Drop your files here", body: "Several files or a whole folder at once is fine. Reading takes a few minutes, so you can leave this page. I'll tell you when it's done." },
  { id: "handwritten", route: ADD_MATERIAL, target: '[data-part="material-type"][data-type="Handwritten notes"]', title: "Mark what confused you", body: "If you star or circle what lost you in your notes, I can make those your weak spots. Tell me how you mark things in Settings." },

  /* ── After the first upload ── */
  { id: "upload-toast", route: ANY, target: '[data-part="upload-toast"]', title: "Your upload is ready", body: "Click this to open it and tell me which slides were hard." },
  { id: "hard-slides", route: REVIEW, target: '[data-part="hard-slides"]', title: "Which slides were hard?", body: "Tap the slides that lost you. Those become your weak spots, and weak spots are what I bring back for review." },
  { id: "reject", route: REVIEW, target: '[data-part="new-topic"]', title: "Not relevant? Reject it", body: "These are the topics I found. Reject a topic, or a single objective, if it isn't really part of the class, and I'll stop asking about it." },

  /* ── The course page ── */
  { id: "weak-count", route: COURSE, target: '[data-part="weak-count"]', title: "Your path", body: "The path shows your weak spots: topics where you flagged or missed something. Master them and this count goes up. \"Show all topics\" brings back the rest." },
  { id: "atlas-switch", route: COURSE, target: '[data-part="atlas-switch"]', after: "weak-count", title: "The Atlas", body: "The Atlas shows how the concepts in this class connect to each other." },
  { id: "edit-exams", route: COURSE, target: '[data-part="edit-exams"]', after: "weak-count", title: "Add your exams", body: "Tell me when your exams are and what they cover. I'll plan review for the week before and put them on your calendar." },
  { id: "flag-topic", route: COURSE_OR_ATLAS, target: '[data-part="dive-start"]', title: "Dive, or flag it", body: "Start a dive for harder questions on this topic. If the whole topic is shaky, flag it below and it joins your weak spots." },
  { id: "atlas-edges", route: ATLAS, target: '[data-part="topic"]', title: "How topics connect", body: "Each circle is a topic, bigger when more topics build on it. Hover a line between two to see how they're related." },

  /* ── In a session ── */
  { id: "dont-know", route: SESSION, target: '[data-part="dont-know"]', title: "Not sure?", body: "Don't guess. \"Don't know\" shows you the solution and makes this a weak spot, so I bring it back." },
  { id: "thumbs-down", route: SESSION, target: '[aria-label="Flag as a bad question"]', title: "Bad question?", body: "A thumbs down swaps it for another and tells me what was wrong, so I write better ones." },

  /* ── Reviews ── */
  { id: "quick-review", route: WITH_SIDEBAR, target: 'aside [data-todo="quick"]', title: "Your quick review", body: "A few minutes on the weak spots that are due. I space them out so they stick, on the days you set for the class." },
  { id: "dive", route: COURSE, target: '[data-part="start-deep"]', after: "quick-review", title: "Dive in", body: "For when you have more time: a longer session of harder questions, written fresh when you start." },

  /* ── Later: Settings ── */
  { id: "more-settings", route: WITH_SIDEBAR, target: '[data-part="avatar-settings"]', when: settledIn, title: "There's more in Settings", body: "Connect Canvas or Claude, tell me how you mark your notes, and set question preferences for every class." },
  { id: "settings-notes", route: SETTINGS, target: '[data-part="notes-for-orca"]', when: settledIn, title: "For all your classes", body: "Preferences here apply to every class, like the kinds of questions you want. A class's own notes win when they disagree." },
  { id: "settings-markers", route: SETTINGS, target: '[data-part="marker-notes"]', when: settledIn, title: "Your marks", body: "Tell me how you mark confusion in handwritten notes, like a star or a question mark, and I'll flag those passages as weak spots." },
  { id: "settings-canvas", route: SETTINGS, target: '[data-part="canvas-connection"]', when: settledIn, title: "Canvas", body: "Connect once, then import a class's files and assignment dates instead of uploading them." },
  { id: "settings-claude", route: SETTINGS, target: '[data-part="claude-connector"]', when: settledIn, title: "Study with Claude", body: "Connect Claude and it can quiz you with my questions in a chat. I grade your answers and keep score." },
];

/**
 * The unseen tips this page can show now, in order: on the page (`route`), their condition met,
 * their target present, and anything they wait for seen or earlier in this same list.
 */
export function eligibleTips(ctx: TipContext, seen: ReadonlySet<string>, present: (selector: string) => boolean, tips: readonly Tip[] = TIPS): Tip[] {
  const out: Tip[] = [];
  const done = new Set(seen);
  for (const tip of tips) {
    if (seen.has(tip.id) || !tip.route.test(ctx.pathname)) continue;
    if (tip.when && !tip.when(ctx)) continue;
    if (tip.after && !done.has(tip.after)) continue;
    if (!present(tip.target)) continue;
    out.push(tip);
    done.add(tip.id);
  }
  return out;
}
```

- [ ] **Step 4: Run it, expect pass**

Run: the command from Step 2. Expected: 8 tests pass. (If the 220-character test names a tip, shorten that body; don't raise the cap.)

- [ ] **Step 5: Commit**

Run: `npx tsc --noEmit` and `npx eslint src/lib/onboarding tests/onboarding` — clean.

```bash
git add src/lib/onboarding/tips.ts tests/onboarding/tips.test.ts
git commit -m "Onboarding tips: the catalogue (what the orca points out, where and when) and its selection"
```

---

### Task 3: Geometry (pure)

**Files:**
- Create: `src/lib/onboarding/place.ts`, `tests/onboarding/place.test.ts`

**Interfaces:**
- Produces: `Box { left; top; width; height }`, `Size { width; height }`, `Side`, constants `GAP = 14`, `MARGIN = 12`, `PAD = 6`; `placeBubble(target: Box, bubble: Size, viewport: Size): { left: number; top: number; side: Side }`; `spotlightClip(target: Box, pad?: number): string`.

- [ ] **Step 1: Write the failing test** — `tests/onboarding/place.test.ts`

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { GAP, MARGIN, placeBubble, spotlightClip } from "../../src/lib/onboarding/place.ts";

const viewport = { width: 1194, height: 834 };
const bubble = { width: 340, height: 160 };

test("the bubble goes below its target, centred on it, when there is room", () => {
  const p = placeBubble({ left: 400, top: 100, width: 100, height: 40 }, bubble, viewport);
  assert.deepEqual(p, { side: "below", left: 400 + 50 - 170, top: 100 + 40 + GAP });
});

test("near the right edge it stays on screen", () => {
  const p = placeBubble({ left: 1050, top: 28, width: 120, height: 44 }, bubble, viewport);
  assert.equal(p.side, "below");
  assert.equal(p.left, viewport.width - bubble.width - MARGIN);
});

test("at the bottom of the screen it goes above", () => {
  const p = placeBubble({ left: 900, top: 770, width: 48, height: 48 }, bubble, viewport);
  assert.equal(p.side, "above");
  assert.equal(p.top, 770 - GAP - bubble.height);
});

test("beside a target as tall as the screen it goes to the side with room", () => {
  const p = placeBubble({ left: 854, top: 0, width: 340, height: 834 }, bubble, viewport);
  assert.equal(p.side, "left");
  assert.equal(p.left, 854 - GAP - bubble.width);
});

test("with no room anywhere it is clamped onto the screen", () => {
  const p = placeBubble({ left: 0, top: 0, width: 1194, height: 834 }, bubble, viewport);
  assert.ok(p.left >= MARGIN && p.left + bubble.width <= viewport.width - MARGIN);
  assert.ok(p.top >= MARGIN && p.top + bubble.height <= viewport.height - MARGIN);
});

test("the spotlight is the whole screen with a padded hole at the target", () => {
  assert.equal(
    spotlightClip({ left: 100.4, top: 50, width: 80, height: 30 }, 6),
    "polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, 94px 44px, 94px 86px, 186px 86px, 186px 44px, 94px 44px)",
  );
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `TZ=UTC node --experimental-strip-types --import ./tests/support/register.mjs --test tests/onboarding/place.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `src/lib/onboarding/place.ts`**

```ts
/** Where an onboarding tip's bubble and spotlight go, from the target's box on screen. Pure. */

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface Size {
  width: number;
  height: number;
}
export type Side = "below" | "above" | "right" | "left";

/** Between the target and the bubble. */
export const GAP = 14;
/** Between the bubble and the edge of the screen. */
export const MARGIN = 12;
/** How far the spotlight reaches past the target. */
export const PAD = 6;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/**
 * The bubble's top-left corner: below the target when it fits, else above, right, left; centred on
 * the target along the other axis and kept on screen. With no room on any side it sits below,
 * clamped onto the screen (over the target, which then fills the screen anyway).
 */
export function placeBubble(target: Box, bubble: Size, viewport: Size): { left: number; top: number; side: Side } {
  const maxLeft = viewport.width - bubble.width - MARGIN;
  const maxTop = viewport.height - bubble.height - MARGIN;
  const x = clamp(target.left + target.width / 2 - bubble.width / 2, MARGIN, maxLeft);
  const y = clamp(target.top + target.height / 2 - bubble.height / 2, MARGIN, maxTop);
  const options: Array<{ side: Side; left: number; top: number }> = [
    { side: "below", left: x, top: target.top + target.height + GAP },
    { side: "above", left: x, top: target.top - GAP - bubble.height },
    { side: "right", left: target.left + target.width + GAP, top: y },
    { side: "left", left: target.left - GAP - bubble.width, top: y },
  ];
  const fits = (o: { left: number; top: number }) => o.left >= MARGIN && o.top >= MARGIN && o.left <= maxLeft && o.top <= maxTop;
  return options.find(fits) ?? { side: "below", left: x, top: clamp(target.top + target.height + GAP, MARGIN, maxTop) };
}

/** A CSS clip-path covering the whole screen except the target (padded): the layer that mutes everything else. */
export function spotlightClip(target: Box, pad: number = PAD): string {
  const l = Math.round(target.left - pad);
  const t = Math.round(target.top - pad);
  const r = Math.round(target.left + target.width + pad);
  const b = Math.round(target.top + target.height + pad);
  return `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${l}px ${t}px, ${l}px ${b}px, ${r}px ${b}px, ${r}px ${t}px, ${l}px ${t}px)`;
}
```

- [ ] **Step 4: Run it, expect pass**

Run: the command from Step 2. Expected: 6 tests pass.

- [ ] **Step 5: Commit**

Run: `npx tsc --noEmit` and `npx eslint src/lib/onboarding tests/onboarding` — clean.

```bash
git add src/lib/onboarding/place.ts tests/onboarding/place.test.ts
git commit -m "Onboarding tips: where the bubble and the spotlight go"
```

---

### Task 4: The components (spotlight, bubble, engine) and mounting

**Files:**
- Create: `src/components/onboarding/active-tip.ts`, `src/components/onboarding/Spotlight.tsx`, `src/components/onboarding/TipBubble.tsx`, `src/components/onboarding/OnboardingTips.tsx`
- Modify: `src/app/providers.tsx` (the `Loaded` component)

**Interfaces:**
- Consumes: `useOrca()`'s `onboarding`, `courses`, `results`, `markTipsSeen`, `skipTips` (Task 1); `TIPS`, `eligibleTips`, `Tip` (Task 2); `Box`, `Size`, `PAD`, `placeBubble`, `spotlightClip` (Task 3); `popIn` from `@/lib/motion`; `OrcaLogo`, `IconClose`, `isPublicPath`.
- Produces: `<OnboardingTips />`; `useActiveTip(): string | null`; DOM hooks `data-part="orca-tip"` with `data-tip="<id>"`, `tip-dim`, `tip-ring`, `tip-dismiss`, `tip-back`, `tip-next`, `tip-count`, `tip-skip`, `tip-skip-confirm`, `tip-skip-yes`, `tip-skip-no`.

Behaviour, in full:
- Nothing renders when `onboarding.skipped`, or on the account screens (`isPublicPath`).
- Every 400 ms, with no tip up, the engine asks `eligibleTips` which unseen tips have a visible target on this page. If any, they become a **run** (their ids, frozen) and the first one shows.
- While a tip is up, the same timer (and scroll and resize) keeps the spotlight on its target. If the target leaves the page, the run ends and that tip stays unseen.
- **Next** (the button, `→`, or clicking the target itself), and **X** / Esc: the tip is marked seen and the run's next tip whose target is still visible shows; after the last, the run ends. **Back** (the button or `←`): the previous tip of the run shows again.
- A navigation ends the run (the run remembers its pathname).
- Keys are left alone while the student is typing or in a control that uses arrows.
- The layer that mutes the page never takes clicks: the app stays usable under it.

- [ ] **Step 1: Write `src/components/onboarding/active-tip.ts`**

```ts
"use client";

import { useSyncExternalStore } from "react";

/**
 * Which onboarding tip is showing, for the few components that behave differently while they're
 * pointed at (the upload toast stays up). The tips' engine sets it; nothing else does.
 */
let current: string | null = null;
const listeners = new Set<() => void>();

export function setActiveTip(id: string | null) {
  if (id === current) return;
  current = id;
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function useActiveTip(): string | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}
```

- [ ] **Step 2: Write `src/components/onboarding/Spotlight.tsx`**

```tsx
"use client";

import { type Box, PAD, spotlightClip } from "@/lib/onboarding/place";

/**
 * Mutes everything but a tip's target: a full-screen layer that lowers saturation behind it, with a
 * hole at the target, and a ring around the hole. It never takes clicks, so the app stays usable.
 * Above the app's modals and toasts (z-50), below the tip's bubble.
 */
export function Spotlight({ target }: { target: Box }) {
  return (
    <>
      <div aria-hidden data-part="tip-dim" className="pointer-events-none fixed inset-0 z-[60] bg-prussian/10 backdrop-saturate-[.35]" style={{ clipPath: spotlightClip(target) }} />
      <div
        aria-hidden
        data-part="tip-ring"
        className="pointer-events-none fixed z-[60] rounded-[16px] ring-[3px] ring-wisteria"
        style={{ left: target.left - PAD, top: target.top - PAD, width: target.width + 2 * PAD, height: target.height + 2 * PAD }}
      />
    </>
  );
}
```

- [ ] **Step 3: Write `src/components/onboarding/TipBubble.tsx`**

```tsx
"use client";

import { type Ref, useState } from "react";
import { motion } from "motion/react";
import { OrcaLogo } from "@/components/brand/OrcaLogo";
import { IconClose } from "@/components/icons";
import { cn } from "@/lib/cn";
import { popIn } from "@/lib/motion";
import type { Tip } from "@/lib/onboarding/tips";

const KEY = "rounded-[6px] border-2 px-[5px] text-[12px] font-bold leading-[16px]";

/** Back and Next: each shows the arrow key that does the same. */
function KeyButton({ label, arrow, primary = false, onClick, part }: { label: string; arrow: "←" | "→"; primary?: boolean; onClick: () => void; part: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-part={part}
      aria-keyshortcuts={arrow === "←" ? "ArrowLeft" : "ArrowRight"}
      className={cn(
        "pressable inline-flex items-center gap-[6px] rounded-pill px-[12px] py-[6px] text-[13px] font-bold lip-2",
        primary ? "bg-wisteria text-parchment lip-wisteria" : "bg-parchment text-prussian ring-2 ring-inset ring-alice-deep lip-alice",
      )}
    >
      {arrow === "←" && <kbd className={cn(KEY, "border-alice-deep bg-alice text-prussian")}>←</kbd>}
      {label}
      {arrow === "→" && <kbd className={cn(KEY, primary ? "border-parchment/60 text-parchment" : "border-alice-deep bg-alice text-prussian")}>→</kbd>}
    </button>
  );
}

/**
 * One onboarding tip, spoken by the orca: a title and a line or two, an X to dismiss it, Back and
 * Next (with their arrow keys), and "Skip all tips", which asks before turning every tip off for good.
 */
export function TipBubble({
  tip,
  index,
  total,
  left,
  top,
  boxRef,
  onBack,
  onNext,
  onDismiss,
  onSkip,
}: {
  tip: Tip;
  /** Its place in the run of tips on this page. */
  index: number;
  total: number;
  left: number;
  top: number;
  boxRef: Ref<HTMLDivElement>;
  onBack: () => void;
  onNext: () => void;
  onDismiss: () => void;
  onSkip: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const last = index === total - 1;
  return (
    <motion.div
      ref={boxRef}
      variants={popIn}
      initial="hidden"
      animate="show"
      exit="exit"
      role="dialog"
      aria-label={tip.title}
      data-part="orca-tip"
      data-tip={tip.id}
      className="fixed z-[61] w-[340px] max-w-[calc(100vw-24px)]"
      style={{ left, top }}
    >
      <div className="relative rounded-[20px] border-2 border-alice-deep bg-parchment px-[16px] pb-[14px] pt-[16px] lip-4 lip-alice">
        <button type="button" onClick={onDismiss} aria-label="Dismiss tip" data-part="tip-dismiss" className="absolute right-[10px] top-[10px] rounded-full p-[4px] text-prussian/70 hover:text-prussian">
          <IconClose size={16} />
        </button>
        <div className="flex items-start gap-[12px] pr-[22px]">
          <OrcaLogo width={46} shadow={false} className="mt-[2px] shrink-0" />
          <div className="flex min-w-0 flex-col gap-[4px]" aria-live="polite">
            <p className="text-[16px] font-bold leading-tight text-prussian">{tip.title}</p>
            <p className="text-[14px] leading-[1.4] text-prussian">{tip.body}</p>
          </div>
        </div>
        <div className="mt-[12px] flex min-h-[32px] items-center justify-between gap-[10px]">
          {confirming ? (
            <span className="flex flex-wrap items-center gap-[10px] text-[13px] font-semibold text-prussian" data-part="tip-skip-confirm">
              Skip all tips? They won&apos;t come back.
              <button type="button" onClick={onSkip} className="font-bold text-bad-text" data-part="tip-skip-yes">
                Skip
              </button>
              <button type="button" onClick={() => setConfirming(false)} className="font-bold text-wisteria-deep" data-part="tip-skip-no">
                Keep going
              </button>
            </span>
          ) : (
            <>
              <button type="button" onClick={() => setConfirming(true)} className="text-[13px] font-semibold text-wisteria-deep underline underline-offset-2" data-part="tip-skip">
                Skip all tips
              </button>
              <span className="flex items-center gap-[8px]">
                {total > 1 && (
                  <span className="text-[12px] font-semibold text-wisteria-deep" data-part="tip-count">
                    {index + 1} of {total}
                  </span>
                )}
                {index > 0 && <KeyButton label="Back" arrow="←" onClick={onBack} part="tip-back" />}
                <KeyButton label={last ? "Got it" : "Next"} arrow="→" primary onClick={onNext} part="tip-next" />
              </span>
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
}
```

- [ ] **Step 4: Write `src/components/onboarding/OnboardingTips.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence } from "motion/react";
import { usePathname } from "next/navigation";
import { isPublicPath } from "@/lib/auth/paths";
import { type Box, type Size, placeBubble } from "@/lib/onboarding/place";
import { TIPS, eligibleTips } from "@/lib/onboarding/tips";
import { useOrca } from "@/lib/store";
import { setActiveTip } from "./active-tip";
import { Spotlight } from "./Spotlight";
import { TipBubble } from "./TipBubble";

/** How often the page is checked for a tip to show, and a showing tip's target is followed. */
const POLL_MS = 400;
/** Controls that use the arrow keys or Esc themselves: the tips leave the keys to them. */
const KEYS_BUSY = 'input, textarea, select, [contenteditable="true"], [role="textbox"], [role="radio"], [role="slider"], [role="listbox"], [role="option"], [role="combobox"]';

const byId = new Map(TIPS.map((t) => [t.id, t]));

/** The first element matching the selector that is actually drawn. */
function visible(selector: string): Element | null {
  for (const el of document.querySelectorAll(selector)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

function boxOf(el: Element): Box {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

const sameBox = (a: Box, b: Box) => Math.abs(a.left - b.left) < 0.5 && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;

/** The tips on this page being shown one after another: their ids, fixed when the first one opened. */
interface Run {
  pathname: string;
  ids: string[];
  index: number;
}

/**
 * The onboarding tips (owner, 2026-11-10; src/lib/onboarding/tips.ts lists them). Mounted once for
 * the whole app: it watches the page, and when unseen tips have their targets on screen it shows
 * them one at a time, the orca speaking, with everything but the target muted. Seen and skipped are
 * saved on the account. A tip whose target leaves the page waits for another time.
 */
export function OnboardingTips() {
  const { onboarding, courses, results, markTipsSeen, skipTips } = useOrca();
  const pathname = usePathname();
  const [stored, setRun] = useState<Run | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [size, setSize] = useState<Size>({ width: 340, height: 160 });
  const off = onboarding.skipped || isPublicPath(pathname);
  // A run belongs to the page it started on: leaving the page ends it.
  const run = !off && stored && stored.pathname === pathname ? stored : null;
  const tip = run ? (byId.get(run.ids[run.index]) ?? null) : null;
  const seen = useMemo(() => new Set(onboarding.seen), [onboarding.seen]);
  const sessions = results.length;
  const courseCount = courses.length;

  // Look for tips to show; follow the showing tip's target.
  useEffect(() => {
    if (off) return;
    const follow = () => {
      if (!tip) return false;
      const el = visible(tip.target);
      if (!el) {
        // Its target is gone (a toast that closed, a modal shut): the tip stays unseen for next time.
        setRun(null);
        setBox(null);
        return true;
      }
      const next = boxOf(el);
      setBox((b) => (b && sameBox(b, next) ? b : next));
      return true;
    };
    const tick = () => {
      if (follow()) return;
      const found = eligibleTips({ pathname, courses: courseCount, sessions }, seen, (selector) => visible(selector) !== null);
      if (!found.length) return;
      visible(found[0].target)?.scrollIntoView({ block: "nearest", inline: "nearest" });
      setRun({ pathname, ids: found.map((t) => t.id), index: 0 });
    };
    const timer = window.setInterval(tick, POLL_MS);
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [off, tip, pathname, courseCount, sessions, seen]);

  /** To the run's nearest tip in that direction whose target is still on the page. */
  const move = useCallback(
    (step: 1 | -1) => {
      if (!run) return;
      let i = run.index + step;
      while (i >= 0 && i < run.ids.length && !visible(byId.get(run.ids[i])?.target ?? "")) i += step;
      if (i < 0) return; // nothing before it: Back does nothing
      setBox(null);
      setRun(i < run.ids.length ? { ...run, index: i } : null);
    },
    [run],
  );
  /** Next, the X, Esc, and a click on the target: this tip is done with, for good. */
  const next = useCallback(() => {
    if (!tip) return;
    markTipsSeen([tip.id]);
    move(1);
  }, [tip, markTipsSeen, move]);
  const back = useCallback(() => move(-1), [move]);

  // ← and → move through the tips, Esc dismisses one; doing what a tip points at counts as seeing it.
  useEffect(() => {
    if (!tip) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof Element && e.target.closest(KEYS_BUSY)) return;
      if (e.key === "ArrowRight" || e.key === "Escape") next();
      else if (e.key === "ArrowLeft") back();
      else return;
      // The tip took the key: a modal under it doesn't also close on Esc.
      e.preventDefault();
      e.stopPropagation();
    };
    const onClick = (e: MouseEvent) => {
      const el = visible(tip.target);
      if (el && e.target instanceof Node && el.contains(e.target)) next();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("click", onClick, true);
    };
  }, [tip, next, back]);

  const showing = tip && box ? tip.id : null;
  useEffect(() => {
    setActiveTip(showing);
    return () => setActiveTip(null);
  }, [showing]);

  // The bubble's real size, for placing it (a ref callback: React 19 runs its cleanup).
  const measure = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const read = () => setSize((s) => (s.width === el.offsetWidth && s.height === el.offsetHeight ? s : { width: el.offsetWidth, height: el.offsetHeight }));
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (!run || !tip || !box) return null;
  const place = placeBubble(box, size, { width: window.innerWidth, height: window.innerHeight });
  return (
    <>
      <Spotlight target={box} />
      <AnimatePresence mode="wait">
        <TipBubble key={tip.id} tip={tip} index={run.index} total={run.ids.length} left={place.left} top={place.top} boxRef={measure} onBack={back} onNext={next} onDismiss={next} onSkip={skipTips} />
      </AnimatePresence>
    </>
  );
}
```

Notes for the implementer:
- `box` is null until the first poll after a tip is chosen, so `window` is only read in the browser.
- If ESLint's `react-hooks` rules object to something here, fix the code; the only existing disable in the repo is `react-hooks/set-state-in-effect` at `src/lib/store.tsx:385`, and nothing above sets state synchronously inside an effect (only in timers, listeners and the observer).

- [ ] **Step 5: Mount it** — `src/app/providers.tsx`

Add the import: `import { OnboardingTips } from "@/components/onboarding/OnboardingTips";`

In `Loaded`, inside the existing `{status === "ready" && ( … )}` block, after the `<Suspense>` holding `<UploadToasts />`:

```tsx
      {status === "ready" && (
        <>
          <Suspense fallback={null}>
            <UploadToasts />
          </Suspense>
          <OnboardingTips />
        </>
      )}
```

- [ ] **Step 6: Check and commit**

Run: `npx tsc --noEmit` and `npx eslint src/components/onboarding src/app/providers.tsx` — clean.

```bash
git add src/components/onboarding src/app/providers.tsx
git commit -m "Onboarding tips: the orca's bubble, the spotlight and the engine that shows them"
```

(The tips point at anchors that Task 5 adds; the browser check comes after it.)

---

### Task 5: Anchors on the screens, and the toast that waits

**Files:**
- Modify: `src/app/page.tsx:29-35`, `src/components/layout/NavBar.tsx:35`, `src/app/course/[slug]/page.tsx` (the uncharted `Button` ~line 76 and the weak-spots line ~line 120), `src/app/add-material/page.tsx` (the drop `Card` ~line 375 and the type section ~line 478), `src/components/layout/UploadToasts.tsx:141-149`

**Interfaces:**
- Consumes: `useActiveTip()` (Task 4).
- Produces: `data-part="add-course"`, `"course-settings-link"`, `"uncharted-add"`, `"weak-count"` (only when the course has topics), `"drop-target"`, `"material-type"` with `data-type={type}`.

- [ ] **Step 1: `src/app/page.tsx`** — on the Add Course `<Link href="/new-course" …>` add `data-part="add-course"`.

- [ ] **Step 2: `src/components/layout/NavBar.tsx`** — on the course-settings `<Link key={href} href={`/course/${course.slug}/settings`} …>` add `data-part="course-settings-link"`.

- [ ] **Step 3: `src/app/course/[slug]/page.tsx`**

The uncharted state's button becomes:

```tsx
          <Button size="sm" onClick={() => router.push(`/add-material?course=${course.slug}`)} data-part="uncharted-add">
            Add material
          </Button>
```

The weak-spots line (the tip about the path only makes sense once there are topics):

```tsx
          <motion.p variants={fadeUp} className="text-[15px] font-medium text-wisteria-deep" data-part={topics.length > 0 ? "weak-count" : undefined}>
            {weak ? `${held} of ${weak} weak spots mastered` : "No weak spots flagged yet"}
          </motion.p>
```

- [ ] **Step 4: `src/app/add-material/page.tsx`**

On the drop target `<Card radius={20} lip={6} role="button" tabIndex={0} aria-label="Choose a file" …>` add `data-part="drop-target"`.

The type section's opening tag becomes:

```tsx
          <motion.section variants={fadeUp} className="flex flex-col gap-[14px]" data-part="material-type" data-type={type}>
```

- [ ] **Step 5: `src/components/layout/UploadToasts.tsx`** — the toast stays up while the tip points at it

Add the import: `import { useActiveTip } from "@/components/onboarding/active-tip";`

In `UploadToast`, replace the timer effect:

```tsx
  // Up for TOAST_MS from its last new upload, paused while the pointer is on it or the onboarding tip points at it.
  const pointedAt = useActiveTip() === "upload-toast";
  useEffect(() => {
    if (hovered || pointedAt) return;
    const timer = window.setTimeout(() => onDismiss(courseId), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [hovered, pointedAt, version, courseId, onDismiss]);
```

- [ ] **Step 6: Check and commit**

Run: `npx tsc --noEmit` and `npx eslint src/app/page.tsx src/components/layout/NavBar.tsx "src/app/course/[slug]/page.tsx" src/app/add-material/page.tsx src/components/layout/UploadToasts.tsx` — clean.

```bash
git add src/app/page.tsx src/components/layout/NavBar.tsx "src/app/course/[slug]/page.tsx" src/app/add-material/page.tsx src/components/layout/UploadToasts.tsx
git commit -m "Onboarding tips: anchors for the tips; the upload toast stays up while its tip points at it"
```

---

### Task 6: Browser tests

**Files:**
- Modify: `e2e/fixture.ts:67-90` (the `test` fixture)
- Create: `e2e/onboarding.spec.ts`

**Interfaces:**
- Consumes: the DOM hooks from Task 4, `stored(page, student).onboarding` (Task 1).
- Produces: fixture option `tips` (default `false`): test students have the tips skipped unless a spec says `test.use({ tips: true })`. Without this every existing spec would get bubbles over the things it clicks.

- [ ] **Step 1: The fixture option** — `e2e/fixture.ts`

Change the `extend` type and add the option, and turn the tips off right after the account is created:

```ts
export const test = base.extend<{ student: Student; tips: boolean }>({
  /** Onboarding tips are off for test students (a bubble would sit over what a spec clicks); `test.use({ tips: true })` leaves them on. */
  tips: [false, { option: true }],
  student: [
    async ({ context, baseURL, tips }, use) => {
      await fakeModel(); // the fake API's default answers; a test sets its own scenario after this
      const email = `e2e-${crypto.randomUUID()}@example.test`;
      const password = "e2e-password-1";
      const { data, error } = await admin().auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { timezone: TIMEZONE } });
      if (error || !data.user) throw new Error(`Couldn't create the test student: ${error?.message}`);
      if (!tips) {
        const skipped = await admin().from("profiles").update({ onboarding: { seen: [], skipped: true } }).eq("owner_id", data.user.id).select("owner_id");
        if (skipped.error || skipped.data.length !== 1) throw new Error(`Couldn't turn the test student's tips off: ${skipped.error?.message ?? "no profile row"}`);
      }
      // …the rest of the fixture is unchanged (signIn, the student's own client, use, cleanup)
```

- [ ] **Step 2: Write the spec** — `e2e/onboarding.spec.ts`

```ts
import type { Page } from "@playwright/test";
import { expect, test, FIXTURE_STATE, seedState, stored } from "./fixture";

/** Onboarding tips: the orca points at what to do next; arrows move through them; skipped or seen, they stay gone. */
test.use({ tips: true });

const SLUG = FIXTURE_STATE.courses[0].slug;
const tip = (page: Page) => page.locator("[data-part=orca-tip]");
/** Longer than two of the engine's checks (400 ms each): time enough for a tip to have shown. */
const WOULD_HAVE_SHOWN_MS = 1200;

test("a new student is pointed at Add Course, with the rest of the page muted; doing it moves on", async ({ page, student }) => {
  await page.goto("/");
  await expect(tip(page)).toHaveAttribute("data-tip", "add-course");
  await expect(tip(page)).toContainText("Add your first one");
  await expect(page.locator("[data-part=tip-dim]")).toBeVisible();
  await expect(page.locator("[data-part=tip-ring]")).toBeVisible();
  // The muted page still works: the button the tip points at is clicked through it.
  await page.locator("[data-part=add-course]").click();
  await expect(page).toHaveURL(/\/new-course$/);
  await expect(tip(page)).toHaveAttribute("data-tip", "canvas-import");
  expect((await stored(page, student)).onboarding).toEqual({ seen: ["add-course"], skipped: false });
});

test("the arrow keys move through a page's tips and back; seen tips don't return", async ({ page, student }) => {
  await seedState(student, FIXTURE_STATE);
  await page.goto(`/course/${SLUG}`);
  await expect(tip(page)).toHaveAttribute("data-tip", "course-settings");
  await expect(page.locator("[data-part=tip-count]")).toContainText("1 of");
  await expect(page.locator("[data-part=tip-back]")).toHaveCount(0);
  await expect(page.locator("[data-part=tip-next] kbd")).toHaveText("→");

  await page.keyboard.press("ArrowRight");
  await expect(tip(page)).toHaveAttribute("data-tip", "weak-count");
  await expect(page.locator("[data-part=tip-back] kbd")).toHaveText("←");
  await page.keyboard.press("ArrowLeft");
  await expect(tip(page)).toHaveAttribute("data-tip", "course-settings");
  await page.locator("[data-part=tip-next]").click();
  await expect(tip(page)).toHaveAttribute("data-tip", "weak-count");
  // The X dismisses just this tip; the next one follows.
  await page.locator("[data-part=tip-dismiss]").click();
  await expect(tip(page)).toHaveAttribute("data-tip", "atlas-switch");

  // Through the rest of this page's tips.
  for (let i = 0; i < 8 && (await tip(page).count()) > 0; i++) {
    const id = await tip(page).getAttribute("data-tip");
    await page.keyboard.press("ArrowRight");
    await expect(tip(page)).not.toHaveAttribute("data-tip", id!);
  }
  await expect(tip(page)).toHaveCount(0);
  const seen = (await stored(page, student)).onboarding.seen;
  expect(seen).toEqual(expect.arrayContaining(["course-settings", "weak-count", "atlas-switch", "edit-exams"]));

  await page.reload();
  await expect(page.locator("[data-part=weak-count]")).toBeVisible();
  await page.waitForTimeout(WOULD_HAVE_SHOWN_MS);
  await expect(tip(page)).toHaveCount(0);
});

test("the arrow keys are left alone while typing", async ({ page, student }) => {
  await seedState(student, FIXTURE_STATE);
  await page.goto(`/course/${SLUG}`);
  await expect(tip(page)).toHaveAttribute("data-tip", "course-settings");
  await page.getByRole("textbox", { name: "Course name" }).click();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
  await expect(tip(page)).toHaveAttribute("data-tip", "course-settings");
});

test("Skip all tips asks first, then no tip shows again", async ({ page, student }) => {
  await page.goto("/");
  await expect(tip(page)).toHaveAttribute("data-tip", "add-course");
  await page.locator("[data-part=tip-skip]").click();
  await expect(page.locator("[data-part=tip-skip-confirm]")).toContainText("They won't come back");
  await page.locator("[data-part=tip-skip-no]").click();
  await expect(tip(page)).toHaveAttribute("data-tip", "add-course");

  await page.locator("[data-part=tip-skip]").click();
  await page.locator("[data-part=tip-skip-yes]").click();
  await expect(tip(page)).toHaveCount(0);
  await expect(page.locator("[data-part=tip-dim]")).toHaveCount(0);
  expect((await stored(page, student)).onboarding.skipped).toBe(true);

  await page.goto("/new-course");
  await expect(page.getByRole("heading", { name: /What are you/ })).toBeVisible();
  await page.waitForTimeout(WOULD_HAVE_SHOWN_MS);
  await expect(tip(page)).toHaveCount(0);
});
```

- [ ] **Step 3: Run the new spec**

Run: `npm run locked -- npx playwright test e2e/onboarding.spec.ts`
Expected: 4 passed. (If the owner's `npm run dev` holds the directory, see CLAUDE.md "Environment gotchas" before starting a second server; don't touch `next.config.ts` while a hosted upload is running.)

If a step fails, open the trace (`npx playwright show-trace test-results/…/trace.zip`) and fix the component, not the expectation. Two things to look at first: the bubble's position when the target sits in the sidebar (Task 3's `placeBubble`), and the `course-settings` tip coming before `weak-count` (catalogue order in Task 2).

- [ ] **Step 4: Run the specs the tips could disturb**

Run: `npm run locked -- npx playwright test e2e/auth.spec.ts e2e/navigation.spec.ts e2e/upload.spec.ts e2e/settings.spec.ts`
Expected: all pass. `auth.spec.ts` makes its accounts through the real sign-up, so those students have the tips on: they see `add-course` on the map and nothing on `/settings` (the Settings tips wait for a finished session). If one of its clicks lands on the bubble, dismiss the tips in that spec before the click with the real flow:

```ts
await page.locator("[data-part=tip-skip]").click();
await page.locator("[data-part=tip-skip-yes]").click();
```

- [ ] **Step 5: Look at it** (the owner's eyes, or screenshots on the local stack; never seed test data on a hosted project)

With the local stack and a fresh account, walk: map → Add Course → create → island → course page → gear → Notes for Orca → Add material. Check on each: the target is ringed and in full colour, the rest is muted but clickable, the bubble never covers its target, the orca sits in the bubble, Back/Next show `←`/`→`.

- [ ] **Step 6: Commit**

```bash
git add e2e/fixture.ts e2e/onboarding.spec.ts
git commit -m "Onboarding tips: browser tests; test students have the tips off unless a spec turns them on"
```

---

### Task 7: Docs and the merge gate

**Files:**
- Modify: `CLAUDE.md` ("Where things stand" and the `src/components/` line of "What exists"), `docs/TO-DISCUSS.md`, this plan's status line

- [ ] **Step 1: `CLAUDE.md`** — add to "Where things stand", after the "Courses can be deleted" bullet:

```markdown
- **Onboarding tips** (2026-11-10, plan `docs/superpowers/plans/2026-11-10-onboarding-tips.md`): the orca points
  out what to do next in pop-up tips, one feature at a time, the first time each is on screen (no fixed tour).
  `src/lib/onboarding/tips.ts` lists them (page, the `data-part` each points at, copy); `OnboardingTips`
  (`src/components/onboarding/`, mounted in `providers.tsx`) shows them with the rest of the page muted. X or
  Next (`→`) marks one seen, `←` goes back, "Skip all tips" turns them off for good (no way back on). Saved on the
  account: `profiles.onboarding` (`{ seen, skipped }`, migration `20261110090000`). e2e students have them off
  unless a spec says `test.use({ tips: true })`. A new feature worth pointing out gets a tip there.
```

In "What exists", add `onboarding/` (OnboardingTips, TipBubble, Spotlight) to the `src/components/` list.

- [ ] **Step 2: `docs/TO-DISCUSS.md`** — add a section "Onboarding tips (2026-11-10): assumed" with the five assumptions from the top of this plan, word for word, in the file's existing format.

- [ ] **Step 3: Set this plan's status line** to `built on branch onboarding, <date>; not merged`.

- [ ] **Step 4: The merge gate** (once, before the pull request)

```bash
npm test
npm run locked -- npm run test:db
npm run locked -- npm run test:e2e
npm run locked -- npm run check:isolation
npm run locked -- npm run check:evidence
```

Expected: all green. The Deploy workflow pushes the migration to production when the PR merges; the development project `mtztzsxgcopohlokragm` needs it by hand (until then the tips are simply off there, see `onboardingFromProfile`).

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/TO-DISCUSS.md docs/superpowers/plans/2026-11-10-onboarding-tips.md
git commit -m "Docs: onboarding tips (what exists, what was assumed)"
```

---

## Self-review

- **Spec coverage:** pop-ups pointing at the next thing (Tasks 2, 4); muted surroundings (Spotlight, Task 4); X in the corner, `←`/`→` shown on Back/Next, Esc (TipBubble and the engine, Task 4); skip with an inline confirm, never coming back (Tasks 1, 4, 6); saved per account (Task 1); the orca speaks (TipBubble); every feature the owner listed has a tip, including hovering an Atlas edge, "This topic is hard", "Don't know", thumbs down and the island's looks; no warm-up tip; no Notes box on `/new-course`; the later features wait for a finished session (Task 2).
- **Types:** `OnboardingState`, `markTipsSeen(ids)`, `skipTips()`, `Tip`, `TipContext`, `eligibleTips`, `Box`, `Size`, `placeBubble`, `spotlightClip`, `useActiveTip`/`setActiveTip` are named the same wherever they appear.
- **Known limits:** the spotlight's hole is a rectangle (the ring is rounded); a tip whose target is larger than the screen sits over it; tips aren't laid out for phones (the app ships as a laptop site).
