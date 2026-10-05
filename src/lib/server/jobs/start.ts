/**
 * Starting jobs from routes (Phase 4 plan, decision 8). The decisions (what runs, what's already
 * built, dead runs, a failed hand-off) are in `src/lib/jobs/start.ts`; this wires in the server's
 * model and where the job runs:
 *
 * - `ORCA_JOBS=inline` (local dev, tests, CI): the job runs in this server process after the
 *   response is sent (`after()`), so the browser follows it like any other.
 * - `ORCA_JOBS=trigger` (production): the job is sent to Trigger.dev (`src/trigger/jobs.ts`); its
 *   Trigger.dev run id is kept on the row.
 *
 * Either way the browser follows `pipeline_runs` through Realtime. Unset, ORCA_JOBS is inline in
 * development and an error in production, so a deploy can't silently run long jobs inside requests.
 * The mode is checked before any run row is written, so a bad setting leaves nothing queued.
 */
import { after } from "next/server";
import { tasks } from "@trigger.dev/sdk";
import type { processMaterialTask, topUpTask } from "@/trigger/jobs";
import * as core from "@/lib/jobs/start";
import type { Dispatch, Generation, StartDeps, TopUpStart } from "@/lib/jobs/start";
import type { OrcaSupabase } from "@/lib/supabase/server";
import { serverModel } from "@/lib/server/model";
import { runMaterialJob, runTopUpJob } from "./run";

export type { Generation, TopUpStart } from "@/lib/jobs/start";

export type JobsMode = "inline" | "trigger";

export function jobsMode(): JobsMode {
  const mode = process.env.ORCA_JOBS;
  if (mode === "inline" || mode === "trigger") return mode;
  if (!mode && process.env.NODE_ENV !== "production") return "inline";
  throw new Error(`ORCA_JOBS must be "inline" or "trigger" (it is ${mode ? `"${mode}"` : "unset"}); see .env.example.`);
}

function deps(db: OrcaSupabase): StartDeps {
  const mode = jobsMode();
  return {
    db,
    model: serverModel(),
    async dispatch(d: Dispatch) {
      if (mode === "inline") {
        after(() => (d.kind === "material" ? runMaterialJob(d.job) : runTopUpJob(d.job)).then(() => undefined));
        return;
      }
      const handle =
        d.kind === "material"
          ? await tasks.trigger<typeof processMaterialTask>("process-material", d.job)
          : await tasks.trigger<typeof topUpTask>("top-up", d.job);
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
