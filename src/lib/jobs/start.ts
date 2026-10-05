/**
 * Starting jobs (Phase 4 plan, decision 8): what a route does once it has verified the student. It
 * creates the job's run row (queued) and hands the job to `dispatch`, which runs it inline or sends
 * it to Trigger.dev (`src/lib/server/jobs/start.ts` wires that up). Loads under plain Node (the
 * database is passed in), so the decisions here are unit-tested with a fake database.
 *
 * A run that is still queued or running long after any job could have finished is dead (its
 * process was stopped, or Trigger.dev never ran it): it is marked failed before anything else, so
 * it can't hold the one-job-in-flight indexes and uploading the file again retries it.
 */
import type { OrcaSupabase } from "../supabase/server.ts";

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

export type Dispatch = { kind: "material"; job: MaterialJob } | { kind: "top-up"; job: TopUpJob };

/**
 * Longest a job may run, in seconds: the Trigger.dev tasks' `maxDuration` (an inline job is cut
 * off sooner, by its route's `maxDuration`).
 */
export const JOB_MAX_SECONDS = { upload: 1800, "top-up": 900 } as const;

/** A queued or running run older than this has died: its job's longest run plus a margin for queueing. */
export const DEAD_RUN_MS = { upload: (JOB_MAX_SECONDS.upload + 600) * 1000, "top-up": (JOB_MAX_SECONDS["top-up"] + 600) * 1000 } as const;

export const DEAD_RUN_ERROR = "Orca's job stopped without finishing. Upload the file again to retry.";
const DEAD_TOP_UP_ERROR = "Orca's job stopped without finishing.";

export interface StartDeps {
  db: OrcaSupabase;
  /** The model the server would use, or null without a key (nothing is generated then). */
  model: string | null;
  /** Hand the job off (inline or Trigger.dev). Throws when it couldn't be started. */
  dispatch: (d: Dispatch) => Promise<void>;
  now?: () => Date;
  newId?: () => string;
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

export type TopUpStart = { state: "started"; runId: string } | { state: "busy" } | { state: "no-model" } | { state: "no-session" };

const UNIQUE_VIOLATION = "23505";

/** Mark the student's dead runs (of one material's uploads, or one course's top-ups) failed. */
async function failDeadRuns(deps: StartDeps, ownerId: string, kind: "upload" | "top-up", scope: { materialId: string } | { courseId: string }): Promise<void> {
  const before = new Date((deps.now?.() ?? new Date()).getTime() - DEAD_RUN_MS[kind]).toISOString();
  let q = deps.db
    .from("pipeline_runs")
    .update({ status: "failed", error: kind === "upload" ? DEAD_RUN_ERROR : DEAD_TOP_UP_ERROR, progress: null })
    .eq("owner_id", ownerId)
    .eq("kind", kind)
    .in("status", ["queued", "running"])
    .lt("at", before);
  q = "materialId" in scope ? q.eq("material_id", scope.materialId) : q.eq("course_id", scope.courseId);
  const { error } = await q;
  if (error) throw new Error(`Couldn't check the job's earlier runs: ${error.message}`);
}

/** Dispatch, or mark the run failed (while it's still queued) and say why. */
async function handOff(deps: StartDeps, d: Dispatch): Promise<void> {
  try {
    await deps.dispatch(d);
  } catch (e) {
    const message = `Orca couldn't start the job: ${e instanceof Error ? e.message : String(e)}`;
    const { error } = await deps.db.from("pipeline_runs").update({ status: "failed", error: message }).eq("owner_id", d.job.ownerId).eq("id", d.job.runId).in("status", ["queued"]);
    throw new Error(error ? `${message} (and the run couldn't be marked failed: ${error.message})` : message);
  }
}

/**
 * Build questions for a material that was read (or recognised as one the course has): start a job
 * unless one is running or the material's questions were already built.
 */
export async function startUploadJob(deps: StartDeps, ownerId: string, materialId: string): Promise<Generation> {
  const { db } = deps;
  await failDeadRuns(deps, ownerId, "upload", { materialId });
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

  const { model } = deps;
  if (!model) return { state: "no-model" };
  const { data: material, error: readError } = await db.from("materials").select("id, course_id, status").eq("owner_id", ownerId).eq("id", materialId).maybeSingle();
  if (readError) throw new Error(`Couldn't read the material: ${readError.message}`);
  if (!material || material.status !== "ready") throw new Error("This material hasn't been read yet.");
  const { count, error: pagesError } = await db.from("material_pages").select("n", { count: "exact", head: true }).eq("owner_id", ownerId).eq("material_id", materialId);
  if (pagesError) throw new Error(`Couldn't read the material's pages: ${pagesError.message}`);
  if (!count) return { state: "no-text" };

  const runId = deps.newId?.() ?? crypto.randomUUID();
  const inserted = await db.from("pipeline_runs").insert({
    id: runId,
    owner_id: ownerId,
    course_id: material.course_id,
    material_id: materialId,
    kind: "upload",
    at: (deps.now?.() ?? new Date()).toISOString(),
    model,
    status: "queued",
  });
  if (inserted.error?.code === UNIQUE_VIOLATION) return startUploadJob(deps, ownerId, materialId); // another request started it
  if (inserted.error) throw new Error(`Couldn't record the job: ${inserted.error.message}`);
  await handOff(deps, { kind: "material", job: { ownerId, runId, materialId } });
  return { state: "started", runId };
}

/** Top up the stock after a finished session (it must be the student's, in that course). */
export async function startTopUpJob(deps: StartDeps, ownerId: string, req: { courseId: string; sessionId: string; objectiveIds: string[] }): Promise<TopUpStart> {
  const { db, model } = deps;
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
  await failDeadRuns(deps, ownerId, "top-up", { courseId: req.courseId });
  const runId = deps.newId?.() ?? crypto.randomUUID();
  const inserted = await db.from("pipeline_runs").insert({
    id: runId,
    owner_id: ownerId,
    course_id: req.courseId,
    material_id: null,
    kind: "top-up",
    at: (deps.now?.() ?? new Date()).toISOString(),
    model,
    status: "queued",
  });
  if (inserted.error?.code === UNIQUE_VIOLATION) return { state: "busy" };
  if (inserted.error) throw new Error(`Couldn't record the job: ${inserted.error.message}`);
  await handOff(deps, { kind: "top-up", job: { ownerId, runId, objectiveIds: req.objectiveIds } });
  return { state: "started", runId };
}
