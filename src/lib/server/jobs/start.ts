/**
 * Starting jobs from routes (Phase 4 plan, decision 8). A route that verified the student creates
 * the job's run row (queued) and hands the job off:
 *
 * - `ORCA_JOBS=inline` (local dev, tests, CI): the job runs in this server process after the
 *   response is sent (`after()`), so the browser follows it like any other.
 * - `ORCA_JOBS=trigger` (production): the job is sent to Trigger.dev (`src/trigger/jobs.ts`); its
 *   Trigger.dev run id is kept on the row.
 *
 * Either way the browser follows `pipeline_runs` through Realtime. Unset, ORCA_JOBS is inline in
 * development and an error in production, so a deploy can't silently run long jobs inside requests.
 */
import { after } from "next/server";
import { tasks } from "@trigger.dev/sdk";
import type { processMaterialTask, topUpTask } from "@/trigger/jobs";
import type { OrcaSupabase } from "@/lib/supabase/server";
import { serverModel } from "@/lib/server/model";
import { type MaterialJob, type TopUpJob, runMaterialJob, runTopUpJob } from "./run";

export type JobsMode = "inline" | "trigger";

export function jobsMode(): JobsMode {
  const mode = process.env.ORCA_JOBS;
  if (mode === "inline" || mode === "trigger") return mode;
  if (!mode && process.env.NODE_ENV !== "production") return "inline";
  throw new Error(`ORCA_JOBS must be "inline" or "trigger" (it is ${mode ? `"${mode}"` : "unset"}); see .env.example.`);
}

/** What happened to the questions for an upload. */
export type Generation =
  /** A job is building them (just started, or already running): follow this run. */
  | { state: "started" | "running"; runId: string }
  /** The material's questions were built before. */
  | { state: "built"; runId: string }
  /** The server has no model key: the file is stored and read, nothing is generated. */
  | { state: "no-model" }
  /** Orca found no text in the file, so there's nothing to build from. */
  | { state: "no-text" };

type Dispatch = { kind: "material"; job: MaterialJob } | { kind: "top-up"; job: TopUpJob };

async function dispatch(db: OrcaSupabase, d: Dispatch): Promise<void> {
  if (jobsMode() === "inline") {
    after(() => (d.kind === "material" ? runMaterialJob(d.job) : runTopUpJob(d.job)).then(() => undefined));
    return;
  }
  try {
    const handle =
      d.kind === "material"
        ? await tasks.trigger<typeof processMaterialTask>("process-material", d.job)
        : await tasks.trigger<typeof topUpTask>("top-up", d.job);
    const { error } = await db.from("pipeline_runs").update({ job_id: handle.id }).eq("owner_id", d.job.ownerId).eq("id", d.job.runId);
    if (error) throw new Error(error.message);
  } catch (e) {
    const message = `Orca couldn't start the job: ${e instanceof Error ? e.message : String(e)}`;
    await db.from("pipeline_runs").update({ status: "failed", error: message }).eq("owner_id", d.job.ownerId).eq("id", d.job.runId).in("status", ["queued"]);
    throw new Error(message);
  }
}

const UNIQUE_VIOLATION = "23505";

/**
 * Build questions for a material that was read (or recognised as one the course has): start a job
 * unless one is running or the material's questions were already built.
 */
export async function startUploadJob(db: OrcaSupabase, ownerId: string, materialId: string): Promise<Generation> {
  const { data: runs, error } = await db
    .from("pipeline_runs")
    .select("id, status")
    .eq("owner_id", ownerId)
    .eq("material_id", materialId)
    .eq("kind", "upload")
    .order("at", { ascending: false });
  if (error) throw new Error(`Couldn't read the material's runs: ${error.message}`);
  const live = runs.find((r) => r.status === "queued" || r.status === "waiting" || r.status === "running");
  if (live) return { state: "running", runId: live.id };
  const built = runs.find((r) => r.status === "done");
  if (built) return { state: "built", runId: built.id };
  // A failed run is tried again: uploading the file again is how a student retries.

  const model = serverModel();
  if (!model) return { state: "no-model" };
  const { data: material, error: readError } = await db.from("materials").select("id, course_id, status").eq("owner_id", ownerId).eq("id", materialId).maybeSingle();
  if (readError) throw new Error(`Couldn't read the material: ${readError.message}`);
  if (!material || material.status !== "ready") throw new Error("This material hasn't been read yet.");
  const { count, error: pagesError } = await db.from("material_pages").select("n", { count: "exact", head: true }).eq("owner_id", ownerId).eq("material_id", materialId);
  if (pagesError) throw new Error(`Couldn't read the material's pages: ${pagesError.message}`);
  if (!count) return { state: "no-text" };

  const runId = crypto.randomUUID();
  const inserted = await db.from("pipeline_runs").insert({
    id: runId,
    owner_id: ownerId,
    course_id: material.course_id,
    material_id: materialId,
    kind: "upload",
    at: new Date().toISOString(),
    model,
    status: "queued",
  });
  if (inserted.error?.code === UNIQUE_VIOLATION) return startUploadJob(db, ownerId, materialId); // another request started it
  if (inserted.error) throw new Error(`Couldn't record the job: ${inserted.error.message}`);
  await dispatch(db, { kind: "material", job: { ownerId, runId, materialId } });
  return { state: "started", runId };
}

export type TopUpStart = { state: "started"; runId: string } | { state: "busy" } | { state: "no-model" } | { state: "no-session" };

/** Top up the stock after a finished session (it must be the student's, in that course). */
export async function startTopUpJob(db: OrcaSupabase, ownerId: string, req: { courseId: string; sessionId: string; objectiveIds: string[] }): Promise<TopUpStart> {
  const model = serverModel();
  if (!model) return { state: "no-model" };
  const { data: session, error } = await db
    .from("session_results")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("course_id", req.courseId)
    .eq("session_id", req.sessionId)
    .limit(1);
  if (error) throw new Error(`Couldn't read the session: ${error.message}`);
  if (!session.length) return { state: "no-session" };
  const runId = crypto.randomUUID();
  const inserted = await db.from("pipeline_runs").insert({
    id: runId,
    owner_id: ownerId,
    course_id: req.courseId,
    material_id: null,
    kind: "top-up",
    at: new Date().toISOString(),
    model,
    status: "queued",
  });
  if (inserted.error?.code === UNIQUE_VIOLATION) return { state: "busy" };
  if (inserted.error) throw new Error(`Couldn't record the job: ${inserted.error.message}`);
  await dispatch(db, { kind: "top-up", job: { ownerId, runId, objectiveIds: req.objectiveIds } });
  return { state: "started", runId };
}
