/**
 * Trigger.dev tasks (`ORCA_JOBS=trigger`, production). Each calls its job and nothing else: the
 * job's logic, its store scoping and its run record are the same as inline mode, which is what the
 * tests run. Not retried, so a failed model run isn't paid for twice; the run row says why it failed
 * and the student can upload again. Deployed in Task 10 (`npx trigger.dev deploy`).
 */
import { task } from "@trigger.dev/sdk";
import { type MaterialJob, type TopUpJob, runMaterialJob, runTopUpJob } from "@/lib/server/jobs/run";

export const processMaterialTask = task({
  id: "process-material",
  retry: { maxAttempts: 1 },
  maxDuration: 1800,
  run: (payload: MaterialJob) => runMaterialJob(payload),
});

export const topUpTask = task({
  id: "top-up",
  retry: { maxAttempts: 1 },
  maxDuration: 900,
  run: (payload: TopUpJob) => runTopUpJob(payload),
});
