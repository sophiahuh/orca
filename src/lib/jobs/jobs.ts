/**
 * The two jobs (Phase 4 plan, decision 8): `processMaterial` builds a course's topics, objectives
 * and questions from an upload's stored pages, and `topUp` writes more questions after a session.
 * Both wrap the pure pipeline (`runUpload`, `runTopUp`) with an injected step caller and a
 * `JobStore` that is already scoped to one student, so they run the same inline (inside a route) or
 * on Trigger.dev, and are tested with a fake caller and an in-memory store.
 *
 * A job's run row is created (queued) by whoever started it. The job claims it (running), writes
 * its progress there as it goes, and finishes it in the same save as the structure it built (done),
 * or records why it failed (failed). The browser follows the row through Realtime. Pages come from
 * `material_pages` only: the stored file is never read again here.
 */
import type { Course, Material, MaterialPages, PipelineRun } from "../data.ts";
import { laidOut } from "../course/layout.ts";
import { applyUploadPlan } from "../pipeline/apply.ts";
import { type CallStep, type Progress, runUpload } from "../pipeline/run.ts";
import { runTopUp } from "../pipeline/topup.ts";
import { type StructureRows, type StructureState, structureRows } from "../supabase/app-rows.ts";

export interface LoadedCourse {
  course: Pick<Course, "id" | "name" | "short" | "topics">;
  structure: StructureState;
}

/** Everything a job reads and writes, for one student (every method is scoped to them). */
export interface JobStore {
  run(runId: string): Promise<PipelineRun | null>;
  /** Move a queued (or waiting) run to running. False when it isn't queued: another worker has it, or it's finished. */
  claim(runId: string, progress: Progress): Promise<boolean>;
  progress(runId: string, progress: Progress): Promise<void>;
  /** Mark a run that is still in flight failed; a finished run is left as it is. */
  fail(runId: string, error: string): Promise<void>;
  course(courseId: string): Promise<LoadedCourse | null>;
  /** The course's materials that were read (status ready). */
  materials(courseId: string): Promise<Material[]>;
  /** Stored pages per material; a material with none is left out. */
  pages(materialIds: readonly string[]): Promise<Record<string, MaterialPages>>;
  /** Every question the student has answered in the course. */
  answered(courseId: string): Promise<Set<string>>;
  /** save_structure for the course: the rows that changed and the finished run, in one transaction. */
  save(courseId: string, rows: StructureRows): Promise<void>;
}

export interface JobDeps {
  store: JobStore;
  call: CallStep;
  newId: () => string;
  /** Render one slide of a material as an image for a figure question; null when it can't be. */
  renderFigure?: (material: Material, slide: number) => Promise<string | null>;
}

export type JobOutcome = { status: "done"; run: PipelineRun } | { status: "failed"; error: string } | { status: "skipped"; reason: string };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Progress writes, one at a time and all finished before the run is saved, so a late one can't land on a finished run. */
function progressWriter(store: JobStore, runId: string) {
  let chain = Promise.resolve();
  return {
    write(p: Progress) {
      chain = chain.then(() => store.progress(runId, p)).catch(() => undefined); // progress is a nicety; the outcome isn't
    },
    flushed: () => chain,
  };
}

/** Claim the run and check it is the job it should be; null when there's nothing to do. */
async function begin(store: JobStore, runId: string, kind: NonNullable<PipelineRun["kind"]>, first: Progress): Promise<{ run: PipelineRun } | { outcome: JobOutcome }> {
  const run = await store.run(runId);
  if (!run) return { outcome: { status: "skipped", reason: `No run ${runId}` } };
  if ((run.kind ?? "upload") !== kind) throw new Error(`Run ${runId} is a ${run.kind} run, not a ${kind}`);
  if (!(await store.claim(runId, first))) return { outcome: { status: "skipped", reason: `Run ${runId} isn't queued (it's ${run.status})` } };
  return { run };
}

async function failed(store: JobStore, runId: string, prefix: string, e: unknown): Promise<JobOutcome> {
  const error = `${prefix}: ${message(e)}`;
  await store.fail(runId, error);
  return { status: "failed", error };
}

/** Build a course's structure and questions from one upload's stored pages. */
export async function processMaterial(deps: JobDeps, job: { runId: string; materialId: string }): Promise<JobOutcome> {
  const { store } = deps;
  const begun = await begin(store, job.runId, "upload", { stage: "mapping" });
  if ("outcome" in begun) return begun.outcome;
  const { run } = begun;
  const progress = progressWriter(store, run.id);
  try {
    if (run.materialId !== job.materialId) throw new Error(`run ${run.id} is for another material`);
    const material = (await store.materials(run.courseId)).find((m) => m.id === job.materialId);
    if (!material) throw new Error("the material isn't in the course any more, or hasn't been read");
    const pages = (await store.pages([material.id]))[material.id];
    if (!pages?.length) throw new Error("Orca found no text in this file to build from");
    const loaded = await store.course(run.courseId);
    if (!loaded) throw new Error("the course is gone");
    const before = loaded.structure;
    const plan = await runUpload(
      {
        course: { ...loaded.course, topics: before.topics },
        objectives: before.objectives,
        bank: before.bank,
        relations: before.relations,
        material,
        pages,
        ...(material.hiddenText ? { hiddenText: material.hiddenText } : {}),
        runId: run.id,
        model: run.model,
        now: run.at,
      },
      {
        call: deps.call,
        newId: deps.newId,
        renderFigure: deps.renderFigure ? (n) => deps.renderFigure!(material, n) : undefined,
        onProgress: progress.write,
      },
    );
    const merged = applyUploadPlan(before, plan);
    const after: StructureState = { ...merged, topics: laidOut(merged.topics) };
    await progress.flushed();
    await store.save(run.courseId, structureRows(before, after, [plan.run]));
    return { status: "done", run: plan.run };
  } catch (e) {
    await progress.flushed();
    return failed(store, run.id, "Orca couldn't build this upload", e);
  }
}

/** Write more questions for a finished session's objectives (docs/MASTERY-PLAN.md §4). */
export async function topUp(deps: JobDeps, job: { runId: string; objectiveIds: readonly string[] }): Promise<JobOutcome> {
  const { store } = deps;
  const begun = await begin(store, job.runId, "top-up", { stage: "writing", objectives: 0 });
  if ("outcome" in begun) return begun.outcome;
  const { run } = begun;
  const progress = progressWriter(store, run.id);
  try {
    const loaded = await store.course(run.courseId);
    if (!loaded) throw new Error("the course is gone");
    const before = loaded.structure;
    const materials = await store.materials(run.courseId);
    const [materialPages, answered] = await Promise.all([store.pages(materials.map((m) => m.id)), store.answered(run.courseId)]);
    // Only this course's objectives: ids from the request that aren't in it are ignored.
    const objectiveIds = job.objectiveIds.filter((id) => before.objectives[id]);
    const plan = await runTopUp(
      {
        course: { ...loaded.course, topics: before.topics },
        objectives: before.objectives,
        bank: before.bank,
        materials,
        materialPages,
        objectiveIds,
        answered,
        runId: run.id,
        model: run.model,
        now: run.at,
      },
      { call: deps.call, newId: deps.newId, onProgress: progress.write },
    );
    const bank = { ...before.bank };
    for (const [topicId, qs] of Object.entries(plan.questions)) bank[topicId] = [...(bank[topicId] ?? []), ...qs];
    await progress.flushed();
    await store.save(run.courseId, structureRows(before, { ...before, bank }, [plan.run]));
    return { status: "done", run: plan.run };
  } catch (e) {
    await progress.flushed();
    return failed(store, run.id, "Orca couldn't write new questions", e);
  }
}
