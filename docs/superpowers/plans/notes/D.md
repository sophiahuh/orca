# D: learner-data findings, snapshots and the store (2026-10-06, cloud container)

## Status

Done on `phase-4`, one commit after C's. Redone from scratch (the teammate's run of D stopped at
its session limit before anything was committed). The learner-evidence skill's rules were kept:
nothing stores mastery; every change to the fold's inputs is on the snapshot path or the store.

### Snapshots (`src/lib/mastery/snapshots.ts`, `objective-state.ts`, `/api/evidence`, `/api/state`)

- **A newer `rules_version` is never overwritten.** `isNewer(snapshot)` (rules version above this
  server's). On read (`readCourseState`) such a snapshot is computed from the log under this
  server's rules and returned with `saved: false`, listed in a new `newer` array, and the stored
  row is left alone. On write (`recordEvent`) it is refused with `NewerRulesError`, which
  `/api/evidence` answers as 503 "Orca is being updated; the answer wasn't recorded. Try again in
  a moment." The browser then rolls the answer back and shows "Couldn't save: …", as for any failed
  save. Why refuse rather than extend: extending with older rules would mix two folds in one
  accumulator; rebuilding and saving would overwrite the newer fold, which is the bug. A rolling
  deploy lasts seconds, so a refused save is the smaller harm.
- **The 409 says what caused it.** `VersionConflictError` carries `reason: "concurrent" |
  "structure"`: after a lost write the snapshot is read again, and a stale mark means the
  structure moved (a merge, re-tag, archive or timezone change marks snapshots stale); a changed
  attribution between the two structure reads is also "structure". The route's message names the
  cause and the body carries `reason`.
- **Same-millisecond events fold in one order.** `replayObjective` sorts by time, then by id, so
  every rebuild agrees. A snapshot is now extended only when the new event is strictly later than
  the snapshot's last event; an event in the same millisecond is folded from the log. No
  `RULES_VERSION` bump: `applyAnswer`/`applyConfusion` are unchanged, the server's log read already
  ordered by `(at, id)`, and the only path that could have folded two same-millisecond events the
  other way (extend) now rebuilds. There are no hosted snapshots yet (Phase 4 isn't deployed).
- **`dayKeyIn` caches one `Intl.DateTimeFormat` per timezone** for the process and reads year,
  month and day from one `formatToParts` call (it formatted each timestamp three times). An
  unknown timezone still throws before anything is cached.
- **The 503 missing-env path has a test** (`tests/server/evidence-route.test.ts`): the route module
  itself is loaded under Node with the Supabase variables removed and answers 503 naming them. To
  load a route module under plain Node, `npm test` now imports `tests/support/register.mjs`, a
  resolver that maps `@/x` to `src/x`, extensionless relative imports inside `src` to their files,
  and Next's bare subpaths (`next/headers`, …) to their files. Pure modules don't need it and
  keep their Node-loadable imports.

### The store (`src/lib/store.tsx`, Settings, `Slider`)

- **A quiz's score isn't saved when one of its answers failed to save.** `recordEvidence` marks the
  session failed if its save fails; `recordQuiz`'s save (which runs after the answers' saves, the
  queue being in order) then refuses with "Couldn't save: some answers in this quiz couldn't be
  saved, so its score wasn't recorded", and the optimistic result is dropped, so streak and agenda
  don't count it. If the quiz finishes while the store is still reloading after the failure, the
  score is refused by the rule below instead; either way nothing is saved. (`e2e/store.spec.ts`'s
  failed-answer test now expects no finished session.)
- **Actions during the reload after a failed save are refused with their own message**: "Orca is
  reloading your data after a save that failed; that change wasn't saved. Try it again in a
  moment." Before, such a save was queued behind the reload and then cancelled by the epoch
  check with no trace (the plan's finding). The optimistic update still goes with the reload, as it
  did. e2e: the reload is slowed with a route delay and an answer given meanwhile.
- **Reloading mid-session** (e2e): the answers already given stay recorded, the session page
  assembles a fresh set from what's recorded, finishing it saves one result whose total is the new
  set's size, and the two runs are two session ids; nothing is counted twice. No code change was
  needed: the session is assembled once per page load from recorded evidence.
- **Reflection confusion is idempotent.** `src/lib/mastery/ids.ts`: `confusionEventId(materialId,
  objectiveId)` is a deterministic UUID (FNV-1a based, version-4 shaped), so a retried reflection
  sends the same ids; the server's primary key refuses the ones already recorded and
  `/api/evidence` answers 409 with `duplicate: true`, which the store treats as done. No migration
  needed (the plan's block 2026100523xxxx is unused). e2e: the second of two confusion saves fails
  once; saving again records the other and leaves two events, not three.
- **Weight sliders save on release.** `Slider` gains `onCommit` (pointer up, key up, blur);
  Settings keeps a draft while dragging and calls `setWeights` once with the final value, and not
  at all if nothing moved. e2e (`e2e/settings.spec.ts`): a real drag makes one PATCH.
- **The scheduling e2e can't straddle midnight**: a `beforeEach` in `e2e/scheduling.spec.ts` waits
  for the new day when less than 90 s remain before midnight in the process's timezone (the
  fixture signs students up with it), extending that test's timeout by the wait.
- `my_data` returning the whole evidence log is left alone (Watch).

## Proof (final run, all green)

See the commit message for counts.

## Judgement calls

- Refuse-on-write for newer snapshots (above), rather than read-only extension.
- No `RULES_VERSION` bump for the same-millisecond order (above).
- The duplicate 409 is told apart by a `duplicate: true` field in the body rather than a new
  status, so other 409s (version conflicts) keep failing the save.
- `tests/support/hooks.mjs` is test infrastructure only; nothing in `src` depends on it.
