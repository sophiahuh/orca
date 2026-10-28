/**
 * Starting jobs from routes (Phase 4 plan, decision 8). The decisions (what runs, what's already
 * built, dead runs, a failed hand-off) are in `src/lib/jobs/start.ts`; this wires in the server's
 * model and where the job runs:
 *
 * - `ORCA_JOBS=inline` (local dev, tests, CI; allowed in production only on a host that keeps the
 *   function alive until `after()` settles, as Vercel does): the job runs in this server process
 *   after the response is sent (`after()`), so the browser follows it like any other. A job the
 *   finishing job starts (`resumeNext`) is awaited by it, so it is inside the same `after()`.
 * - `ORCA_JOBS=trigger` (production): the job is sent to Trigger.dev (`src/trigger/jobs.ts`); its
 *   Trigger.dev run id is kept on the row.
 *
 * Either way the browser follows `pipeline_runs` through Realtime. Unset, ORCA_JOBS is inline in
 * development and an error in production, so a deploy can't silently run long jobs inside requests.
 * The mode is checked before any run row is written, so a bad setting leaves nothing queued.
 */
import { after } from "next/server";
import { tasks } from "@trigger.dev/sdk";
import type { deepReviewTask, processMaterialTask, topUpTask } from "@/trigger/jobs";
import * as core from "@/lib/jobs/start";
import type { Dispatch, Generation, StartDeps, TopUpStart } from "@/lib/jobs/start";
import type { OrcaSupabase } from "@/lib/supabase/server";
import { serverModel } from "@/lib/server/model";
import { checkBudget } from "@/lib/server/usage";
import { runDeepReviewJob, runMaterialJob, runTopUpJob } from "./run";

export type { DeepReviewStart, Generation, TopUpStart } from "@/lib/jobs/start";

export type JobsMode = "inline" | "trigger";

export function jobsMode(): JobsMode {
  const mode = process.env.ORCA_JOBS;
  if (mode === "inline" || mode === "trigger") return mode;
  if (!mode && process.env.NODE_ENV !== "production") return "inline";
  throw new Error(`ORCA_JOBS must be "inline" or "trigger" (it is ${mode ? `"${mode}"` : "unset"}); see .env.example.`);
}

function deps(db: OrcaSupabase, run: "after-response" | "now" = "after-response"): StartDeps {
  const mode = jobsMode();
  return {
    db,
    model: serverModel(),
    budget: (ownerId, pages) => checkBudget(db, ownerId, pages),
    async dispatch(d: Dispatch) {
      if (mode === "inline") {
        const work = () => (d.kind === "material" ? runMaterialJob(d.job) : d.kind === "top-up" ? runTopUpJob(d.job) : runDeepReviewJob(d.job)).then(() => undefined);
        // From a route: after its response. From a finishing job (already after a response): right
        // away, and awaited, so the enclosing after() covers the chained job too.
        if (run === "after-response") after(work);
        else await work();
        return;
      }
      const handle =
        d.kind === "material"
          ? await tasks.trigger<typeof processMaterialTask>("process-material", d.job)
          : d.kind === "top-up"
            ? await tasks.trigger<typeof topUpTask>("top-up", d.job)
            : await tasks.trigger<typeof deepReviewTask>("deep-review", d.job);
      const { error } = await db.from("pipeline_runs").update({ job_id: handle.id }).eq("owner_id", d.job.ownerId).eq("id", d.job.runId);
      if (error) throw new Error(error.message);
    },
  };
}

/** See `startUploadJob` in src/lib/jobs/start.ts. */
export function startUploadJob(db: OrcaSupabase, ownerId: string, materialId: string): Promise<Generation> {
  return core.startUploadJob(deps(db), ownerId, materialId);
}

/** See `startTopUpJob` in src/lib/jobs/start.ts. */
export function startTopUpJob(db: OrcaSupabase, ownerId: string, req: { courseId: string; sessionId: string; objectiveIds: string[] }): Promise<TopUpStart> {
  return core.startTopUpJob(deps(db), ownerId, req);
}

/** See `startDeepReviewJob` in src/lib/jobs/start.ts. */
export function startDeepReviewJob(db: OrcaSupabase, ownerId: string, req: { courseId: string; minutes: number; objectiveIds: string[] }): Promise<import("@/lib/jobs/start").DeepReviewStart> {
  return core.startDeepReviewJob(deps(db), ownerId, req);
}

/**
 * Start the student's next queued or resumable waiting job (see `resumeNext`). Called by a job
 * that just finished (`src/lib/server/jobs/run.ts`), so the next one runs at once, not after a
 * response that already went out.
 */
export function resumeNext(db: OrcaSupabase, ownerId: string): Promise<Dispatch | null> {
  return core.resumeNext(deps(db, "now"), ownerId);
}

/**
 * Check the student's runs from a route (POST /api/runs/check): a run past its job's limit
 * (`DEAD_RUN_MS`, judged by the server's clock) is marked failed, and their next queued or resumable
 * job starts after the response.
 */
export function checkRuns(db: OrcaSupabase, ownerId: string): Promise<Dispatch | null> {
  return core.resumeNext(deps(db, "after-response"), ownerId);
}

/**
 * Pause the student's queued uploads, or resume paused ones and start the next job after the
 * response if nothing of theirs is running (POST /api/runs/pause). Returns how many runs changed.
 */
export async function pauseRuns(db: OrcaSupabase, ownerId: string, target: core.PauseTarget, paused: boolean): Promise<number> {
  const changed = await core.pauseUploadRuns(deps(db, "after-response"), ownerId, target, paused);
  if (!paused && changed > 0) await core.resumeNext(deps(db, "after-response"), ownerId);
  return changed;
}

/** Every student with a live run (queued, waiting or running: a running one may have died), for the scheduled sweeps. */
export async function ownersWithPendingRuns(db: OrcaSupabase): Promise<string[]> {
  const { data, error } = await db.from("pipeline_runs").select("owner_id").in("status", ["queued", "waiting", "running"]);
  if (error) throw new Error(`Couldn't read the pending runs: ${error.message}`);
  return [...new Set(data.map((r) => r.owner_id))];
}
