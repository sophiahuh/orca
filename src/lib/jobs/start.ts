/**
 * Starting jobs (Phase 4 plan, decision 8): what a route does once it has verified the student. It
 * creates the job's run row (queued) and hands the job to `dispatch`, which runs it inline or sends
 * it to Trigger.dev (`src/lib/server/jobs/start.ts` wires that up). Loads under plain Node (the
 * database is passed in), so the decisions here are unit-tested with a fake database.
 *
 * A run that is still running long after any job could have finished is dead (its process was
 * stopped): it is marked failed before anything else, so it can't hold the one-job-in-flight
 * indexes and uploading the file again retries it. Queued and waiting runs are never dead: one job
 * runs at a time per student (decision 10), so a run may legitimately queue behind a long upload,
 * and `resumeNext` starts it when its turn comes.
 */
import type { BudgetVerdict } from "./budget.ts";
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
  /** Whether a waiting run may resume now (its student's budgets; src/lib/server/usage.ts). */
  budget?: (ownerId: string, pages: number) => Promise<BudgetVerdict>;
  now?: () => Date;
  newId?: () => string;
}

/** What happened to the questions for an upload. */
export type Generation =
  /** A job is building them (just started, or already running): follow this run. */
  | { state: "started" | "running"; runId: string }
  /** Queued behind the student's other job (one runs at a time); it starts when that one finishes. */
  | { state: "queued"; runId: string }
  /** The material's questions were built before. */
  | { state: "built"; runId: string }
  /** The server has no model key: the file is stored and read, nothing is generated. */
  | { state: "no-model" }
  /** Orca found no text in the file, so there's nothing to build from. */
  | { state: "no-text" };

export type TopUpStart = { state: "started"; runId: string } | { state: "queued"; runId: string } | { state: "busy" } | { state: "no-model" } | { state: "no-session" };

const UNIQUE_VIOLATION = "23505";

/** Mark the student's dead runs (of one material's uploads, or one course's top-ups) failed: running too long. */
async function failDeadRuns(deps: StartDeps, ownerId: string, kind: "upload" | "top-up", scope: { materialId: string } | { courseId: string }): Promise<void> {
  const before = new Date((deps.now?.() ?? new Date()).getTime() - DEAD_RUN_MS[kind]).toISOString();
  let q = deps.db
    .from("pipeline_runs")
    .update({ status: "failed", error: kind === "upload" ? DEAD_RUN_ERROR : DEAD_TOP_UP_ERROR, progress: null })
    .eq("owner_id", ownerId)
    .eq("kind", kind)
    .in("status", ["running"])
    .lt("at", before);
  q = "materialId" in scope ? q.eq("material_id", scope.materialId) : q.eq("course_id", scope.courseId);
  const { error } = await q;
  if (error) throw new Error(`Couldn't check the job's earlier runs: ${error.message}`);
}

/** Whether the student already has a job in flight (queued, waiting or running): a new one queues behind it. */
async function hasJobInFlight(deps: StartDeps, ownerId: string, except?: string): Promise<boolean> {
  let q = deps.db.from("pipeline_runs").select("id", { count: "exact", head: true }).eq("owner_id", ownerId).in("status", ["queued", "waiting", "running"]);
  if (except) q = q.neq("id", except);
  const { count, error } = await q;
  if (error) throw new Error(`Couldn't read the student's jobs: ${error.message}`);
  return (count ?? 0) > 0;
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
  // Read before the insert, so this run never counts as its own "other job".
  const queueBehind = await hasJobInFlight(deps, ownerId);
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
  // One job at a time per student: behind another, it stays queued and resumeNext starts it later.
  if (queueBehind) return { state: "queued", runId };
  await handOff(deps, { kind: "material", job: { ownerId, runId, materialId } });
  return { state: "started", runId };
}

/**
 * Start the student's next job, if nothing of theirs is running: the oldest queued run, or the
 * oldest waiting run whose budget now allows it. Called when a job finishes (and by a schedule in
 * trigger mode, for the day change). Returns what it started, or null.
 */
export async function resumeNext(deps: StartDeps, ownerId: string): Promise<Dispatch | null> {
  const { db } = deps;
  const { data: runs, error } = await db
    .from("pipeline_runs")
    .select("id, kind, status, material_id, objective_ids")
    .eq("owner_id", ownerId)
    .in("status", ["queued", "waiting", "running"])
    .order("at", { ascending: true });
  if (error) throw new Error(`Couldn't read the student's jobs: ${error.message}`);
  if (runs.some((r) => r.status === "running")) return null;
  for (const r of runs) {
    if (r.status === "waiting" && deps.budget) {
      let pages = 0;
      if (r.kind === "upload" && r.material_id) {
        const { count, error: pagesError } = await db.from("material_pages").select("n", { count: "exact", head: true }).eq("owner_id", ownerId).eq("material_id", r.material_id);
        if (pagesError) throw new Error(`Couldn't count the material's pages: ${pagesError.message}`);
        pages = count ?? 0;
      }
      const verdict = await deps.budget(ownerId, pages);
      if (!verdict.ok) continue; // still held; a later one may be a top-up that fits, so keep looking
    }
    const d: Dispatch =
      r.kind === "upload"
        ? { kind: "material", job: { ownerId, runId: r.id, materialId: r.material_id! } }
        : { kind: "top-up", job: { ownerId, runId: r.id, objectiveIds: r.objective_ids ?? [] } };
    // Back to queued (a waiting run) so the job can claim it; dispatch then runs it.
    const { error: requeue } = await db.from("pipeline_runs").update({ status: "queued", progress: null }).eq("owner_id", ownerId).eq("id", r.id).in("status", ["queued", "waiting"]);
    if (requeue) throw new Error(`Couldn't queue the run: ${requeue.message}`);
    await handOff(deps, d);
    return d;
  }
  return null;
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
  const queueBehind = await hasJobInFlight(deps, ownerId);
  const inserted = await db.from("pipeline_runs").insert({
    id: runId,
    owner_id: ownerId,
    course_id: req.courseId,
    material_id: null,
    kind: "top-up",
    at: (deps.now?.() ?? new Date()).toISOString(),
    model,
    status: "queued",
    // Kept on the run, so a queued or waiting top-up can start later without the browser.
    objective_ids: req.objectiveIds,
  });
  if (inserted.error?.code === UNIQUE_VIOLATION) return { state: "busy" };
  if (inserted.error) throw new Error(`Couldn't record the job: ${inserted.error.message}`);
  if (queueBehind) return { state: "queued", runId };
  await handOff(deps, { kind: "top-up", job: { ownerId, runId, objectiveIds: req.objectiveIds } });
  return { state: "started", runId };
}
