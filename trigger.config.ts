/**
 * Trigger.dev (Phase 4 plan, decision 8): the tasks in `src/trigger/` run uploads and top-ups in
 * production (`ORCA_JOBS=trigger`). No project exists yet; Task 10 creates it, sets
 * TRIGGER_PROJECT_REF and the task environment (Supabase URL and secret key, the model key: OPENAI_API_KEY or ANTHROPIC_API_KEY, and ORCA_MODEL_PROVIDER if set), and
 * deploys with `npx trigger.dev deploy`. Locally and in tests, `ORCA_JOBS=inline` runs the same jobs
 * inside the route instead.
 *
 * The CLI evaluates this file before it reads any env file, so `.env.local` and `.env` are loaded
 * here with Node's own loader (it never overwrites a variable already set, so the shell wins, then
 * `.env.local`, then `.env`, as in Next.js). A missing file is skipped.
 */
import { existsSync } from "node:fs";
import { defineConfig } from "@trigger.dev/sdk";

for (const file of [".env.local", ".env"]) if (existsSync(file)) process.loadEnvFile(file);

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
