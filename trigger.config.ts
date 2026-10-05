/**
 * Trigger.dev (Phase 4 plan, decision 8): the tasks in `src/trigger/` run uploads and top-ups in
 * production (`ORCA_JOBS=trigger`). No project exists yet; Task 10 creates it, sets
 * TRIGGER_PROJECT_REF and the task environment (Supabase URL and secret key, ANTHROPIC_API_KEY), and
 * deploys with `npx trigger.dev deploy`. Locally and in tests, `ORCA_JOBS=inline` runs the same jobs
 * inside the route instead.
 */
import { defineConfig } from "@trigger.dev/sdk";

const project = process.env.TRIGGER_PROJECT_REF;
if (!project) throw new Error("Set TRIGGER_PROJECT_REF (the Trigger.dev project, proj_…) to build or deploy Orca's tasks; see docs/SETUP-HOSTED.md.");

export default defineConfig({
  project,
  dirs: ["./src/trigger"],
  runtime: "node",
  // A long upload: extraction, then question writing and checking for every objective.
  maxDuration: 1800,
  retries: { enabledInDev: false, default: { maxAttempts: 1 } },
});
