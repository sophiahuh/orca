/**
 * Running a job, wherever it runs: inline inside a route (`ORCA_JOBS=inline`) or in a Trigger.dev
 * task (`src/trigger/`, `ORCA_JOBS=trigger`). Builds the service-role store scoped to the job's
 * student and Orca's step caller, then calls the job, then starts the student's next queued job if
 * there is one (one runs at a time, decision 10). The jobs check the budgets once at their start
 * (and go waiting), so the step caller doesn't guard each call here.
 */
import { deepReview, type JobOutcome, processMaterial, topUp } from "@/lib/jobs/jobs";
import type { DeepReviewJob, MaterialJob, TopUpJob } from "@/lib/jobs/start";
import { figureRenderer, pageRenderer } from "@/lib/server/figures";
import { supabaseJobStore } from "@/lib/server/job-store";
import { stepCaller } from "@/lib/server/model";
import { adminClient } from "@/lib/supabase/server";
import { resumeNext } from "./start";

export type { DeepReviewJob, MaterialJob, TopUpJob } from "@/lib/jobs/start";

async function guarded(ownerId: string, runId: string, work: (store: ReturnType<typeof supabaseJobStore>, db: ReturnType<typeof adminClient>) => Promise<JobOutcome>): Promise<JobOutcome> {
  const db = adminClient();
  const store = supabaseJobStore(db, ownerId);
  let outcome: JobOutcome;
  try {
    outcome = await work(store, db);
  } catch (e) {
    // Something outside the pipeline (the database) failed: the run still says so, never stays "running".
    const error = `Orca's job stopped: ${e instanceof Error ? e.message : String(e)}`;
    await store.fail(runId, error).catch(() => undefined);
    outcome = { status: "failed", error };
  }
  // This job is out of the way (done, failed or waiting): the student's next one may start.
  if (outcome.status !== "skipped") {
    try {
      await resumeNext(db, ownerId);
    } catch (e) {
      console.error(`Couldn't start the next job for ${ownerId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return outcome;
}

export function runMaterialJob(job: MaterialJob): Promise<JobOutcome> {
  return guarded(job.ownerId, job.runId, async (store, db) => {
    const call = stepCaller({ ownerId: job.ownerId, kind: "upload", runId: job.runId }, { guard: "none" });
    if (!call) throw new Error("the server has no model key");
    return processMaterial({ store, call, newId: () => crypto.randomUUID(), renderFigure: figureRenderer(db, job.ownerId), renderPage: pageRenderer(db, job.ownerId) }, job);
  });
}

export function runTopUpJob(job: TopUpJob): Promise<JobOutcome> {
  return guarded(job.ownerId, job.runId, async (store) => {
    const call = stepCaller({ ownerId: job.ownerId, kind: "top-up", runId: job.runId }, { guard: "none" });
    if (!call) throw new Error("the server has no model key");
    return topUp({ store, call, newId: () => crypto.randomUUID() }, job);
  });
}

export function runDeepReviewJob(job: DeepReviewJob): Promise<JobOutcome> {
  return guarded(job.ownerId, job.runId, async (store) => {
    const call = stepCaller({ ownerId: job.ownerId, kind: "deep-review", runId: job.runId }, { guard: "none" });
    if (!call) throw new Error("the server has no model key");
    return deepReview({ store, call, newId: () => crypto.randomUUID() }, job);
  });
}
