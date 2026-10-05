/**
 * Running a job, wherever it runs: inline inside a route (`ORCA_JOBS=inline`) or in a Trigger.dev
 * task (`src/trigger/`, `ORCA_JOBS=trigger`). Builds the service-role store scoped to the job's
 * student and Orca's step caller, then calls the job. No Next.js imports, so the Trigger.dev worker
 * can load it.
 */
import { type JobOutcome, processMaterial, topUp } from "@/lib/jobs/jobs";
import { figureRenderer } from "@/lib/server/figures";
import { supabaseJobStore } from "@/lib/server/job-store";
import { stepCaller } from "@/lib/server/model";
import { adminClient } from "@/lib/supabase/server";

/** A job's payload. `ownerId` is the student the route verified; every query is scoped to it. */
export interface MaterialJob {
  ownerId: string;
  runId: string;
  materialId: string;
}

export interface TopUpJob {
  ownerId: string;
  runId: string;
  objectiveIds: string[];
}

async function guarded(ownerId: string, runId: string, work: (store: ReturnType<typeof supabaseJobStore>, db: ReturnType<typeof adminClient>) => Promise<JobOutcome>): Promise<JobOutcome> {
  const db = adminClient();
  const store = supabaseJobStore(db, ownerId);
  try {
    return await work(store, db);
  } catch (e) {
    // Something outside the pipeline (the database) failed: the run still says so, never stays "running".
    const error = `Orca's job stopped: ${e instanceof Error ? e.message : String(e)}`;
    await store.fail(runId, error).catch(() => undefined);
    return { status: "failed", error };
  }
}

export function runMaterialJob(job: MaterialJob): Promise<JobOutcome> {
  return guarded(job.ownerId, job.runId, async (store, db) => {
    const call = stepCaller();
    if (!call) throw new Error("the server has no model key");
    return processMaterial({ store, call, newId: () => crypto.randomUUID(), renderFigure: figureRenderer(db, job.ownerId) }, job);
  });
}

export function runTopUpJob(job: TopUpJob): Promise<JobOutcome> {
  return guarded(job.ownerId, job.runId, async (store) => {
    const call = stepCaller();
    if (!call) throw new Error("the server has no model key");
    return topUp({ store, call, newId: () => crypto.randomUUID() }, job);
  });
}
