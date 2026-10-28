/**
 * Starting jobs (Phase 4 plan, decision 8): what a route does once it has verified the student. It
 * creates the job's run row (queued) and hands the job to `dispatch`, which runs it inline or sends
 * it to Trigger.dev (`src/lib/server/jobs/start.ts` wires that up). Loads under plain Node (the
 * database is passed in), so the decisions here are unit-tested with a fake database.
 *
 * A run that has been running longer than any job could (measured from when the job claimed it,
 * `started_at`, not from when it was created: a run may legitimately queue for an hour first) is
 * dead (its process was stopped): every start and every `resumeNext` marks the student's dead runs
 * failed first, so a dead run can't hold the one-job-at-a-time place (decision 10) and uploading
 * the file again retries it. Waiting runs, and queued runs not yet handed to a job, are never dead:
 * `resumeNext` starts the oldest one that may run whenever a job finishes, whenever the student
 * starts a job while nothing of theirs is running (so an orphaned queued run, or a run waiting for
 * yesterday's limit, is picked up in inline mode too), and hourly in trigger mode. A queued run
 * that was handed to a job (`started_at` set by the hand-off) but never claimed within
 * `HANDOFF_MS` never will be (the dispatcher dropped it: no Trigger.dev worker, or the process
 * stopped first), and is failed the same way.
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

export interface DeepReviewJob {
  ownerId: string;
  runId: string;
  objectiveIds: string[];
  minutes: number;
}

export type Dispatch = { kind: "material"; job: MaterialJob } | { kind: "top-up"; job: TopUpJob } | { kind: "deep-review"; job: DeepReviewJob };

/**
 * Longest a job may run, in seconds: the Trigger.dev tasks' `maxDuration` (an inline job is cut
 * off sooner, by its route's `maxDuration`).
 */
export const JOB_MAX_SECONDS = { upload: 1800, "top-up": 900, "deep-review": 660 } as const;

/**
 * A running run claimed longer ago than this has died: its job's longest run plus a margin. A dive
 * is one round of model calls (each capped at 10 minutes) and a student is waiting on it, so its
 * margin is short: 12 minutes in all.
 */
export const DEAD_RUN_MS = {
  upload: (JOB_MAX_SECONDS.upload + 600) * 1000,
  "top-up": (JOB_MAX_SECONDS["top-up"] + 600) * 1000,
  "deep-review": (JOB_MAX_SECONDS["deep-review"] + 60) * 1000,
} as const;

/** A queued run handed to a job longer ago than this, and still not claimed, was dropped. Trigger.dev normally claims within seconds. */
export const HANDOFF_MS = 15 * 60_000;

export const DEAD_RUN_ERROR = "Orca's job stopped without finishing. Upload the file again to retry.";
const DEAD_TOP_UP_ERROR = "Orca's job stopped without finishing.";
const DEAD_DEEP_REVIEW_ERROR = "Orca couldn't finish preparing this Dive In. Try again.";
const DEAD_ERROR = { upload: DEAD_RUN_ERROR, "top-up": DEAD_TOP_UP_ERROR, "deep-review": DEAD_DEEP_REVIEW_ERROR } as const;
export const NEVER_STARTED_ERROR = "Orca's job never started. Upload the file again to retry.";
const NEVER_STARTED = { upload: NEVER_STARTED_ERROR, "top-up": "Orca's job never started.", "deep-review": DEAD_DEEP_REVIEW_ERROR } as const;

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
  /** Held by a daily budget; it resumes when the limit resets. */
  | { state: "waiting"; runId: string }
  /** The material's questions were built before. */
  | { state: "built"; runId: string }
  /** The server has no model key: the file is stored and read, nothing is generated. */
  | { state: "no-model" }
  /** Orca found no text in the file, so there's nothing to build from. */
  | { state: "no-text" };

export type TopUpStart = { state: "started"; runId: string } | { state: "queued"; runId: string } | { state: "busy" } | { state: "no-model" } | { state: "no-session" };
export type DeepReviewStart = { state: "started" | "running" | "queued" | "waiting"; runId: string } | { state: "no-model" } | { state: "no-course" };

const LIVE = ["queued", "waiting", "running"] as const;

const UNIQUE_VIOLATION = "23505";

/** Mark the student's dead runs failed: running (claimed) for longer than their job could run. */
async function failDeadRuns(deps: StartDeps, ownerId: string): Promise<void> {
  const now = (deps.now?.() ?? new Date()).getTime();
  for (const kind of ["upload", "top-up", "deep-review"] as const) {
    const { error } = await deps.db
      .from("pipeline_runs")
      .update({ status: "failed", error: DEAD_ERROR[kind], progress: null })
      .eq("owner_id", ownerId)
      .eq("kind", kind)
      .eq("status", "running")
      .lt("started_at", new Date(now - DEAD_RUN_MS[kind]).toISOString());
    if (error) throw new Error(`Couldn't check the student's earlier runs: ${error.message}`);
    // Handed off but never claimed (a queued run's started_at is when it was handed off; null until then).
    const { error: dropped } = await deps.db
      .from("pipeline_runs")
      .update({ status: "failed", error: NEVER_STARTED[kind], progress: null })
      .eq("owner_id", ownerId)
      .eq("kind", kind)
      .eq("status", "queued")
      .lt("started_at", new Date(now - HANDOFF_MS).toISOString());
    if (dropped) throw new Error(`Couldn't check the student's earlier runs: ${dropped.message}`);
  }
}

/**
 * Whether the student already has a job in flight (queued, waiting or running): a new one queues
 * behind it. Dives don't count: they run beside the queue (`startDeepReviewJob`).
 */
async function hasJobInFlight(deps: StartDeps, ownerId: string): Promise<boolean> {
  const { count, error } = await deps.db.from("pipeline_runs").select("id", { count: "exact", head: true }).eq("owner_id", ownerId).neq("kind", "deep-review").in("status", [...LIVE]);
  if (error) throw new Error(`Couldn't read the student's jobs: ${error.message}`);
  return (count ?? 0) > 0;
}

type LiveRun = { id: string; kind: string; status: string; material_id: string | null; objective_ids: string[] | null; deep_minutes: number | null; started_at?: string | null };

/** Whether a live run may be handed to a job now: a waiting run only once its student's budget allows it. */
async function mayRun(deps: StartDeps, ownerId: string, r: LiveRun): Promise<boolean> {
  if (r.status !== "waiting" || !deps.budget) return true;
  let pages = 0;
  if (r.kind === "upload" && r.material_id) {
    const { count, error } = await deps.db.from("material_pages").select("n", { count: "exact", head: true }).eq("owner_id", ownerId).eq("material_id", r.material_id);
    if (error) throw new Error(`Couldn't count the material's pages: ${error.message}`);
    pages = count ?? 0;
  }
  return (await deps.budget(ownerId, pages)).ok;
}

/** Hand a queued or waiting run to its job: back to queued (a waiting run) so the job can claim it, stamped with when it was handed off (the claim overwrites it). */
async function dispatchRun(deps: StartDeps, ownerId: string, r: LiveRun): Promise<Dispatch> {
  const d: Dispatch =
    r.kind === "upload"
      ? { kind: "material", job: { ownerId, runId: r.id, materialId: r.material_id! } }
      : r.kind === "top-up"
        ? { kind: "top-up", job: { ownerId, runId: r.id, objectiveIds: r.objective_ids ?? [] } }
        : { kind: "deep-review", job: { ownerId, runId: r.id, objectiveIds: r.objective_ids ?? [], minutes: r.deep_minutes! } };
  const handedOff = (deps.now?.() ?? new Date()).toISOString();
  const { error } = await deps.db.from("pipeline_runs").update({ status: "queued", progress: null, started_at: handedOff }).eq("owner_id", ownerId).eq("id", r.id).in("status", ["queued", "waiting"]);
  if (error) throw new Error(`Couldn't queue the run: ${error.message}`);
  await handOff(deps, d);
  return d;
}

/**
 * A new run was queued behind the student's other in-flight runs: if none of them is running (an
 * orphaned queued run, or runs waiting for a limit), start the oldest that may run now, which may
 * be this one. Says whether this run was the one started.
 */
async function startBehind(deps: StartDeps, ownerId: string, runId: string): Promise<boolean> {
  const next = await resumeNext(deps, ownerId);
  return next?.job.runId === runId;
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
  await failDeadRuns(deps, ownerId);
  const { data: runs, error } = await db
    .from("pipeline_runs")
    .select("id, status")
    .eq("owner_id", ownerId)
    .eq("material_id", materialId)
    .eq("kind", "upload")
    .order("at", { ascending: false });
  if (error) throw new Error(`Couldn't read the material's runs: ${error.message}`);
  // A paused run is the material's run: uploading the file again resumes it (back in line by its time).
  const paused = runs.find((r) => r.status === "paused");
  if (paused) {
    const { error: resumed } = await db.from("pipeline_runs").update({ status: "queued", started_at: null }).eq("owner_id", ownerId).eq("id", paused.id).eq("status", "paused");
    if (resumed) throw new Error(`Couldn't resume the run: ${resumed.message}`);
    return { state: (await startBehind(deps, ownerId, paused.id)) ? "started" : "queued", runId: paused.id };
  }
  const live = runs.find((r) => (LIVE as readonly string[]).includes(r.status));
  if (live) {
    if (live.status === "running") return { state: "running", runId: live.id };
    // Queued or waiting: start it now if nothing of the student's is running and it may run (an
    // orphaned run, or one whose limit has reset); otherwise say what it is doing.
    const next = await resumeNext(deps, ownerId);
    return { state: next?.job.runId === live.id ? "started" : live.status === "waiting" ? "waiting" : "queued", runId: live.id };
  }
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
  // One job at a time per student, oldest first: even two uploads started together run in the order
  // they were recorded, so the later one maps its file onto the topics the earlier one made. This
  // run starts now only if nothing of the student's is running and no older run is queued.
  return { state: (await startBehind(deps, ownerId, runId)) ? "started" : "queued", runId };
}

/**
 * Start the student's next job, if nothing of theirs is running: the oldest queued run, or the
 * oldest waiting run whose budget now allows it. Called when a job finishes, when the student
 * starts a job behind others, and by a schedule in trigger mode (for the day change). Dead runs
 * are failed first, so one can't block the student for good. Returns what it started, or null.
 * Dives aren't in the queue (they run beside it): a dive waiting for its budget is handed off here
 * once the budget allows, and so is one never handed off (queued behind a job before 2026-10-26).
 */
export async function resumeNext(deps: StartDeps, ownerId: string): Promise<Dispatch | null> {
  const { db } = deps;
  await failDeadRuns(deps, ownerId);
  const { data: runs, error } = await db
    .from("pipeline_runs")
    .select("id, kind, status, material_id, objective_ids, deep_minutes, started_at")
    .eq("owner_id", ownerId)
    .in("status", [...LIVE])
    .order("at", { ascending: true });
  if (error) throw new Error(`Couldn't read the student's jobs: ${error.message}`);
  for (const r of runs) {
    if (r.kind !== "deep-review" || r.status === "running" || (r.status === "queued" && r.started_at)) continue;
    if (await mayRun(deps, ownerId, r)) await dispatchRun(deps, ownerId, r);
  }
  const queue = runs.filter((r) => r.kind !== "deep-review");
  if (queue.some((r) => r.status === "running")) return null;
  for (const r of queue) {
    if (!(await mayRun(deps, ownerId, r))) continue; // still held; a later one may be a top-up that fits, so keep looking
    return dispatchRun(deps, ownerId, r);
  }
  return null;
}

/** Which uploads to pause or resume: one run, or every one of a course's. */
export type PauseTarget = { runId: string } | { courseId: string };

/**
 * Pause queued uploads (they leave the queue: nothing waits behind them, they are never taken for
 * dead) or resume paused ones (back to queued, in line by their upload time; the caller then runs
 * `resumeNext` so one starts if nothing is running). A run that is already running can't be
 * paused: the job has it. Returns how many runs changed.
 */
export async function pauseUploadRuns(deps: StartDeps, ownerId: string, target: PauseTarget, paused: boolean): Promise<number> {
  let q = deps.db
    .from("pipeline_runs")
    .update(paused ? { status: "paused", started_at: null, progress: null } : { status: "queued", started_at: null })
    .eq("owner_id", ownerId)
    .eq("kind", "upload")
    .eq("status", paused ? "queued" : "paused");
  q = "runId" in target ? q.eq("id", target.runId) : q.eq("course_id", target.courseId);
  const { data, error } = await q.select("id");
  if (error) throw new Error(`Couldn't ${paused ? "pause" : "resume"} the upload${"courseId" in target ? "s" : ""}: ${error.message}`);
  return data.length;
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
  await failDeadRuns(deps, ownerId);
  const runId = deps.newId?.() ?? crypto.randomUUID();
  const queueBehind = await hasJobInFlight(deps, ownerId);
  const at = (deps.now?.() ?? new Date()).toISOString();
  const inserted = await db.from("pipeline_runs").insert({
    id: runId,
    owner_id: ownerId,
    course_id: req.courseId,
    material_id: null,
    kind: "top-up",
    at,
    model,
    status: "queued",
    // Handed off right below unless it queues behind another job (see HANDOFF_MS).
    ...(queueBehind ? {} : { started_at: at }),
    // Kept on the run, so a queued or waiting top-up can start later without the browser.
    objective_ids: req.objectiveIds,
  });
  if (inserted.error?.code === UNIQUE_VIOLATION) return { state: "busy" };
  if (inserted.error) throw new Error(`Couldn't record the job: ${inserted.error.message}`);
  if (queueBehind) return { state: (await startBehind(deps, ownerId, runId)) ? "started" : "queued", runId };
  await handOff(deps, { kind: "top-up", job: { ownerId, runId, objectiveIds: req.objectiveIds } });
  return { state: "started", runId };
}

/**
 * Start a Dive In. Its targets and duration live on the run so the browser may leave safely. It
 * runs beside the student's other job rather than behind it (the student is waiting on it, and an
 * upload can run for half an hour): it reads the course when it starts and only adds questions.
 */
export async function startDeepReviewJob(deps: StartDeps, ownerId: string, req: { courseId: string; minutes: number; objectiveIds: string[] }): Promise<DeepReviewStart> {
  const { db, model } = deps;
  if (!model) return { state: "no-model" };
  const { data: course, error: courseError } = await db.from("courses").select("id").eq("owner_id", ownerId).eq("id", req.courseId).maybeSingle();
  if (courseError) throw new Error(`Couldn't read the course: ${courseError.message}`);
  if (!course) return { state: "no-course" };
  await failDeadRuns(deps, ownerId);
  const { data: prior, error: priorError } = await db
    .from("pipeline_runs")
    .select("id, kind, status, material_id, objective_ids, deep_minutes, started_at")
    .eq("owner_id", ownerId)
    .eq("course_id", req.courseId)
    .eq("kind", "deep-review")
    .in("status", [...LIVE])
    .order("at", { ascending: false })
    .limit(1);
  if (priorError) throw new Error(`Couldn't read the course's Dive In: ${priorError.message}`);
  const live = prior[0];
  if (live) {
    if (live.status === "running") return { state: "running", runId: live.id };
    // Handed off and not claimed yet: its job is on the way (HANDOFF_MS fails it if it never comes).
    if (live.status === "queued" && live.started_at) return { state: "queued", runId: live.id };
    if (!(await mayRun(deps, ownerId, live))) return { state: "waiting", runId: live.id };
    await dispatchRun(deps, ownerId, live);
    return { state: "started", runId: live.id };
  }
  const runId = deps.newId?.() ?? crypto.randomUUID();
  const at = (deps.now?.() ?? new Date()).toISOString();
  const inserted = await db.from("pipeline_runs").insert({
    id: runId,
    owner_id: ownerId,
    course_id: req.courseId,
    material_id: null,
    kind: "deep-review",
    at,
    model,
    status: "queued",
    // Handed off right below (see HANDOFF_MS).
    started_at: at,
    objective_ids: req.objectiveIds,
    deep_minutes: req.minutes,
  });
  if (inserted.error?.code === UNIQUE_VIOLATION) return startDeepReviewJob(deps, ownerId, req);
  if (inserted.error) throw new Error(`Couldn't record the Dive In: ${inserted.error.message}`);
  await handOff(deps, { kind: "deep-review", job: { ownerId, runId, objectiveIds: req.objectiveIds, minutes: req.minutes } });
  return { state: "started", runId };
}
