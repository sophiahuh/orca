# F: CI with Supabase (Task 9a)

## Status

Done on `phase-4` (2026-10-05, cloud container), as one commit with E's work following it in the
merge order. Redone from scratch: the earlier `p4-F` branch (commit `de988de`) was never pushed
from the teammate's machine and is lost.

- `.github/workflows/ci.yml`: two jobs.
  - `checks` (unchanged in substance): `npm ci`, `next typegen`, `tsc`, lint, unit tests, build.
  - `stack`: the whole local proof on a GitHub runner. `npm ci`; a guard step that fails the job
    if `ANTHROPIC_API_KEY` is set to anything but the fake key, or `ANTHROPIC_BASE_URL` points off
    the machine; Chromium from a cache keyed on `package-lock.json` (system packages always
    installed); `npx supabase start -x studio,imgproxy` (the CLI is a devDependency; GitHub's
    Ubuntu runners have Docker); then `npm run test:db`, `check:isolation`, `check:evidence`,
    `test:e2e` with `ORCA_JOBS=inline` and `CI=true`. On failure it uploads `test-results/`
    (Playwright traces) and `docker logs` of every `supabase_*` container plus `supabase status`.
    `supabase stop --no-backup` runs always.
  - Runs on pushes to `main`, `backend-implementation` and `phase-*`, and on pull requests.
    Concurrency cancels an older run of the same ref.
- `playwright.config.ts` (CI only): `forbidOnly`, one retry, and the `github` reporter beside
  `list`. Locally nothing changes (`reuseExistingServer` was already `!CI`).

## Proof

GitHub Actions can't run from here. What was checked:

- The YAML parses (Python `yaml.safe_load`); `actionlint` isn't installed.
- The `stack` job's command sequence ran here under the lock against the Docker stack, on the
  same tree: `test:db` 145, `check:isolation` 43, `check:evidence` 44, `test:e2e` 36 (see the
  final counts in the commit message). `-x studio,imgproxy` are valid names for this CLI
  (`supabase start --help` lists them); the status output the checks parse doesn't need either.
- The first real run happens on the push of `phase-4`; expect the Supabase image pulls to take
  several minutes on a cold runner.

## Judgement calls

- **The stack job runs the checks in sequence, not as separate jobs**, so the stack starts once
  (image pulls are the slow part) and the four checks share it, as they do locally.
- **The model-key guard is a shell step, not only a Playwright check**: `check:isolation` and
  `check:evidence` don't go through Playwright's config, and the guard should refuse a key before
  anything starts. The e2e suite's own guard (`e2e/global-setup.ts`) still runs after it.
- **Secrets aren't referenced anywhere in the workflow.** Nothing in CI needs one: the local
  stack prints its own keys, and the model is fake. If a hosted check is ever added to CI it
  should be a separate, manually triggered workflow.
- **The scheduling e2e runs on the real clock** (noted in the Phase 4 plan): a CI run that
  straddles midnight UTC in the runner's zone can fail until D's fix lands. Not F's to fix.
