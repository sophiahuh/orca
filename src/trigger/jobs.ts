/**
 * Trigger.dev tasks (`ORCA_JOBS=trigger`, production). Each calls its job and nothing else: the
 * job's logic, its store scoping and its run record are the same as inline mode, which is what the
 * tests run. Not retried, so a failed model run isn't paid for twice; the run row says why it failed
 * and the student can upload again. Deployed in Task 10 (`npx trigger.dev deploy`).
 */
import { schedules, task } from "@trigger.dev/sdk";
import { JOB_MAX_SECONDS, type DeepReviewJob, type MaterialJob, type TopUpJob } from "@/lib/jobs/start";
import { runDeepReviewJob, runMaterialJob, runTopUpJob } from "@/lib/server/jobs/run";
import { ownersWithPendingRuns, resumeNext } from "@/lib/server/jobs/start";
import { adminClient } from "@/lib/supabase/server";

export const processMaterialTask = task({
  id: "process-material",
  retry: { maxAttempts: 1 },
  maxDuration: JOB_MAX_SECONDS.upload,
  run: (payload: MaterialJob) => runMaterialJob(payload),
});

export const topUpTask = task({
  id: "top-up",
  retry: { maxAttempts: 1 },
  maxDuration: JOB_MAX_SECONDS["top-up"],
  run: (payload: TopUpJob) => runTopUpJob(payload),
});

export const deepReviewTask = task({
  id: "deep-review",
  retry: { maxAttempts: 1 },
  maxDuration: JOB_MAX_SECONDS["deep-review"],
  run: (payload: DeepReviewJob) => runDeepReviewJob(payload),
});

/**
 * Runs held by a daily budget (`waiting`) resume when the student's day changes, which no job of
 * theirs may be around to notice, and a queued run whose task was lost would otherwise wait for
 * ever: once an hour, try every student with a queued or waiting run (decision 10). Inline mode
 * has no schedule; there such a run resumes when the student next starts or finishes a job.
 */
export const resumeWaitingTask = schedules.task({
  id: "resume-waiting",
  cron: "11 * * * *",
  maxDuration: 300,
  run: async () => {
    const db = adminClient();
    const started: string[] = [];
    for (const ownerId of await ownersWithPendingRuns(db)) {
      const d = await resumeNext(db, ownerId);
      if (d) started.push(d.job.runId);
    }
    return { started };
  },
});
