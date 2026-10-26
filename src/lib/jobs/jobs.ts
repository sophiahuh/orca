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
import type { Course, FlaggedQuestion, Material, MaterialPages, PipelineRun } from "../data.ts";
import { laidOut } from "../course/layout.ts";
import { applyUploadPlan } from "../pipeline/apply.ts";
import { type CallStep, type Progress, runUpload } from "../pipeline/run.ts";
import { describeFigures, transcribePages } from "../pipeline/transcribe.ts";
import { runDeepReview, runTopUp, SKIPPED_PREFIX, unansweredDeepQuestions } from "../pipeline/topup.ts";
import { deepQuestionCount } from "../deep-review.ts";
import { type StructureRows, type StructureState, structureRows } from "../supabase/app-rows.ts";
import type { BudgetVerdict } from "./budget.ts";

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
  /**
   * Whether the student may put `pages` more pages (0 for a top-up) through the model now: their
   * daily budgets and Orca's ceiling (decision 10; src/lib/jobs/budget.ts decides).
   */
  budget(pages: number): Promise<BudgetVerdict>;
  /** Put a claimed run back to `waiting` with why: it resumes when the budget allows (start.ts's sweep). */
  wait(runId: string, verdict: Extract<BudgetVerdict, { ok: false }>): Promise<void>;
  course(courseId: string): Promise<LoadedCourse | null>;
  /** The course's materials that were read (status ready). */
  materials(courseId: string): Promise<Material[]>;
  /** Stored pages per material; a material with none is left out. */
  pages(materialIds: readonly string[]): Promise<Record<string, MaterialPages>>;
  /** Store pages read from their images: transcribed (`vision`) or with their figures described (`figure`). */
  savePages(materialId: string, pages: ReadonlyArray<{ n: number; text: string }>, source: "vision" | "figure"): Promise<void>;
  /** Every question the student has answered in the course, or given a thumbs down (used either way). */
  answered(courseId: string): Promise<Set<string>>;
  /** The course's thumbs-down questions, newest first, cleaned for question writing. */
  flagged(courseId: string): Promise<FlaggedQuestion[]>;
  /** save_structure for the course: the rows that changed and the finished run, in one transaction. */
  save(courseId: string, rows: StructureRows): Promise<void>;
}

export interface JobDeps {
  store: JobStore;
  call: CallStep;
  newId: () => string;
  /** Render one slide of a material as an image for a figure question; null when it can't be. */
  renderFigure?: (material: Material, slide: number) => Promise<string | null>;
  /** Render one page of a material whole, for reading a handwritten or scanned page; null when it can't be. */
  renderPage?: (material: Material, page: number) => Promise<string | null>;
}

export type JobOutcome =
  | { status: "done"; run: PipelineRun }
  | { status: "failed"; error: string }
  | { status: "skipped"; reason: string }
  /** Held by a daily budget; the run is `waiting` and will be resumed. */
  | { status: "waiting"; reason: string };

/** What a waiting run's progress says: `{ stage: "waiting", reason, message }`. */
export interface WaitingProgress {
  stage: "waiting";
  reason: string;
  message: string;
}

/** Check the budget just after claiming; over it, the run goes back to waiting and nothing is called. */
async function heldByBudget(store: JobStore, runId: string, pages: number): Promise<JobOutcome | null> {
  const verdict = await store.budget(pages);
  if (verdict.ok) return null;
  await store.wait(runId, verdict);
  return { status: "waiting", reason: verdict.reason };
}

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
    const materials = await store.materials(run.courseId);
    const material = materials.find((m) => m.id === job.materialId);
    if (!material) throw new Error("the material isn't in the course any more, or hasn't been read");
    let pages = (await store.pages([material.id]))[material.id];
    if (!pages?.length) throw new Error("Orca found no text in this file to build from");
    const held = await heldByBudget(store, run.id, pages.length);
    if (held) return held;
    const loaded = await store.course(run.courseId);
    if (!loaded) throw new Error("the course is gone");
    let kept: Array<{ n: number; reason: string }> = [];
    // Pages read from their images first, and the new text stored (top-ups and dives read it too):
    // handwritten or scanned pages written out, then typed slides' figures described. A page that
    // can't be read keeps the file's own text.
    const course = { name: loaded.course.name, short: loaded.course.short };
    const passes = [
      { marked: "needs-vision", done: "vision", run: transcribePages },
      { marked: "needs-figure", done: "figure", run: describeFigures },
    ] as const;
    for (const pass of passes) {
      const count = pages.filter((p) => p.source === pass.marked).length;
      if (!count || !deps.renderPage) continue;
      progress.write(pass.done === "vision" ? { stage: "transcribing", pages: count } : { stage: "figures-reading", slides: count });
      const render = deps.renderPage;
      const out = await pass.run({ course, material, pages }, { call: deps.call, render: (n) => render(material, n) });
      kept = [...kept, ...out.kept];
      if (out.read.length) {
        await store.savePages(material.id, out.read, pass.done);
        const read = new Map(out.read.map((p) => [p.n, p.text]));
        pages = pages.map((p) => (read.has(p.n) ? { n: p.n, text: read.get(p.n)!, source: pass.done } : p));
      }
    }
    if (kept.length || pages.some((p) => p.source === "vision" || p.source === "figure")) progress.write({ stage: "mapping" });
    const before = loaded.structure;
    const plan = await runUpload(
      {
        course: { ...loaded.course, topics: before.topics },
        objectives: before.objectives,
        bank: before.bank,
        relations: before.relations,
        material,
        materials: materials.map((m) => ({ id: m.id, filename: m.filename })),
        pages,
        ...(material.hiddenText ? { hiddenText: material.hiddenText } : {}),
        flagged: await store.flagged(run.courseId),
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
    // Pages that couldn't be read from their images are listed with what was left out.
    for (const k of kept) plan.run.dropped.push({ prompt: `Page ${k.n}`, reason: `kept the file's own text: ${k.reason}` });
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
    // A top-up's pages aren't counted (its calls are bounded by the token budget it's checked against).
    const held = await heldByBudget(store, run.id, 0);
    if (held) return held;
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
        flagged: await store.flagged(run.courseId),
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

/** Write a durable Dive In's harder questions, then atomically save its questions and completed run. */
export async function deepReview(deps: JobDeps, job: { runId: string; objectiveIds: readonly string[]; minutes: number }): Promise<JobOutcome> {
  const { store } = deps;
  const begun = await begin(store, job.runId, "deep-review", { stage: "writing", objectives: job.objectiveIds.length });
  if ("outcome" in begun) return begun.outcome;
  const { run } = begun;
  try {
    if (run.deepMinutes !== job.minutes) throw new Error("the Dive In's saved duration doesn't match its job");
    const loaded = await store.course(run.courseId);
    if (!loaded) throw new Error("the course is gone");
    const before = loaded.structure;
    const objectiveIds = job.objectiveIds.filter((id) => before.objectives[id]);
    if (!objectiveIds.length) throw new Error("none of this Dive In's objectives are still in the course");
    const count = deepQuestionCount(job.minutes);
    // Dive questions written before and never answered are asked first; only the rest are written.
    const reused = unansweredDeepQuestions({ objectives: before.objectives, bank: before.bank, objectiveIds, count }, await store.answered(run.courseId));
    const toWrite = count - reused.length;
    let plan: Awaited<ReturnType<typeof runDeepReview>> = { questions: {}, dropped: [], skipped: [] };
    if (toWrite > 0) {
      const held = await heldByBudget(store, run.id, 0);
      if (held) return held;
      const materials = await store.materials(run.courseId);
      const materialPages = await store.pages(materials.map((m) => m.id));
      plan = await runDeepReview(
        { course: { ...loaded.course, topics: before.topics }, objectives: before.objectives, bank: before.bank, materials, materialPages, objectiveIds, count: toWrite, flagged: await store.flagged(run.courseId) },
        { call: deps.call, newId: deps.newId },
      );
    }
    const written = Object.entries(plan.questions).flatMap(([topicId, questions]) => questions.map((question) => ({ topicId, question })));
    const added = [...reused, ...written];
    if (!added.length) {
      const why = plan.skipped[0]?.reason ?? plan.dropped[0]?.reason ?? "the model wrote no usable questions";
      throw new Error(why);
    }
    const bank = { ...before.bank };
    for (const [topicId, questions] of Object.entries(plan.questions)) bank[topicId] = [...(bank[topicId] ?? []), ...questions];
    // One question per urgent objective before another round, matching the original Dive In order.
    const priority = new Map(job.objectiveIds.map((id, index) => [id, index]));
    const seen = new Map<string, number>();
    const orderedIds = added
      .map(({ question }) => {
        const objectiveId = question.objectiveId!;
        const round = seen.get(objectiveId) ?? 0;
        seen.set(objectiveId, round + 1);
        return { id: question.id, round, priority: priority.get(objectiveId) ?? priority.size };
      })
      .sort((a, b) => a.round - b.round || a.priority - b.priority)
      .map((question) => question.id);
    const finished: PipelineRun = {
      id: run.id,
      kind: "deep-review",
      courseId: run.courseId,
      materialId: null,
      at: run.at,
      model: run.model,
      deepMinutes: job.minutes,
      status: "done",
      topicsCreated: [],
      objectivesCreated: [],
      objectivesAttached: [...new Set(objectiveIds)],
      questionsAdded: written.length,
      questionIds: orderedIds,
      dropped: [...plan.dropped, ...plan.skipped.map((s) => ({ prompt: `Objective \"${before.objectives[s.objectiveId]?.name ?? s.objectiveId}\"`, reason: `${SKIPPED_PREFIX}${s.reason}` }))],
    };
    await store.save(run.courseId, structureRows(before, { ...before, bank }, [finished]));
    return { status: "done", run: finished };
  } catch (e) {
    return failed(store, run.id, "Orca couldn't prepare this Dive In", e);
  }
}
