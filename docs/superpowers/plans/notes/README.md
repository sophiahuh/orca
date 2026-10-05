# Phase 4 parallel work: the rules

How the agents of `../2026-10-05-orca-phase4-execution.md` (Waves 1–2) share one repository and
one local stack. Each workstream writes its status, differences from the plan and judgement calls
to `notes/<workstream>.md` (W0, A, B, C, D, E, F, I, R); only 9b folds them into CLAUDE.md, the
plans, the roadmap and TO-DISCUSS.

## Branches and merge order

- Each Wave 1 workstream works in its own git worktree on branch `p4-<ws>` from `phase-4` (after
  Wave 0), commits there, and doesn't push or merge.
- Integration (I) merges in this order, smallest and least shared first, rebasing each branch on
  the result and rerunning `db:reset` and `db:types` after each:

  **F → E → C → D → B → A**

## The shared stack

One Docker Supabase (ports 543xx) and the fixed ports 3100 (e2e `next dev`) and 3101 (the fake
Anthropic API) serve every agent on this machine. Anything that resets or writes the database, or
binds those ports, goes through the lock:

```sh
npm run locked -- npm run test:e2e        # or test:db, check:isolation, check:evidence
npm run locked -- npm run db:types        # after a migration change: reset happens first
```

`scripts/stack-lock.sh` takes an `mkdir` lock (`/tmp/orca-supabase-stack.lock`), waits up to
`ORCA_LOCK_TIMEOUT` seconds (default 3600) saying who holds it, takes over a lock whose holder
died, cds to your worktree's root, runs `npm run db:reset` there (so the stack has your
migrations), runs the command, and releases the lock however the command ends. Never run
`db:reset`, `test:db`, `test:e2e` or `check:*` outside it. `tsc`, lint and `npm test` (unit) run
freely. Don't leave a `next dev` running on 3100 or 3101 after the lock is released.

Use Node ≥ 22 (`.nvmrc`); a shell's default `node` may be older and fail `npm test` with "bad
option: --experimental-strip-types".

## Migration timestamps

Each workstream adds migrations only inside its own block, so files never collide and apply in a
fixed order after the merge:

| Workstream | Block | Example |
|---|---|---|
| A (7b injection defences) | `2026100521xxxx` | `20261005210000_security_events.sql` |
| B (7c cost guard) | `2026100522xxxx` | `20261005220000_model_usage.sql` |
| D (learner-data findings) | `2026100523xxxx` | `20261005230000_snapshot_rules_version.sql` |
| E (auth and upload findings) | `2026100524xxxx` | `20261005240000_upload_cleanup.sql` |

C and F add no migrations. After changing one: (under the lock) `db:reset`, then `npm run
db:types`. Never hand-edit or hand-merge `src/lib/supabase/database.types.ts`: regenerate it after
a rebase.

## Shared files and who owns what

- **`e2e/fake-anthropic.ts`:** A owns how it parses prompts (step detection, the generate prompt's
  objective lines). Others only add **optional** `Scenario` fields (B: an error type for the
  spend-limit 429; C: a `grade` outcome) and never change parsing. Step detection is by each
  step's system-prompt first line, so A keeps those first lines unchanged.
- **`src/lib/limits.ts`:** B owns it. A keeps its own limits in `src/lib/untrusted/`; others may
  import its constants but don't edit it.
- **The review page** (`src/app/course/[slug]/review/page.tsx`): A edits the done block (the
  "text aimed at an AI" warning); B edits the waiting and progress block (the daily limit).
- **`src/components/quiz/QuizRunner.tsx`:** C edits the grade fetch; D edits the score save. C
  merges first.
- **`src/lib/server/model.ts` and `src/lib/llm-server.ts`:** the `ModelCtx` signature is fixed
  (W0): `stepCaller(ctx)` with `ctx: { ownerId, kind: "upload" | "top-up" | "reflect" | "grade",
  runId? }` required, and `completeJson(…, { ctx })`. B owns everything inside them; A and C only
  call them.
- **`src/lib/untrusted/encode.ts`** (W0): `untrustedBlock(source, payload)` and
  `UNTRUSTED_POLICY`. A and C call it and don't edit it.
- **The two `run.ts` files:** `src/lib/pipeline/run.ts` is A's; `src/lib/server/jobs/run.ts` is
  B's.
- **Docs** (CLAUDE.md, both Phase 4 plans, `docs/BACKEND-ROADMAP.md`, `docs/TO-DISCUSS.md`): only
  9b edits them. Everyone else writes `notes/<ws>.md`.
