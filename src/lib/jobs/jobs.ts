import { PipelineDeferred } from "./staged/types.ts";
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
import { type CallStep, type Progress, type RunDeps, runUpload } from "../pipeline/run.ts";
import type { OrcaNotes } from "../pipeline/notes.ts";
import { describeFigures, transcribePages } from "../pipeline/transcribe.ts";
import { runDeepReview, runTopUp, SKIPPED_PREFIX, topUpTargets, unansweredDeepQuestions } from "../pipeline/topup.ts";
import { deepQuestionCount } from "../deep-review.ts";
import { type StructureRows, type StructureState, structureRows } from "../supabase/app-rows.ts";
import { markerFlagId } from "../mastery/ids.ts";
import type { ConfusionEvent } from "../mastery/types.ts";
import type { BudgetVerdict } from "./budget.ts";

export interface LoadedCourse {
  course: Pick<Course, "id" | "name" | "short" | "topics">;
  structure: StructureState;
  /** Notes for Orca (the account's and the course's), cleaned; null when there are none (src/lib/pipeline/notes.ts). */
  notes: OrcaNotes | null;
  /** How the student marks confusion in their notes, screened; null when they haven't said (or it was refused). */
  markers: string | null;
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
  /** Objective ids with a struggle flag (any `confusion` event) in the course, as recorded (merges not followed). */
  flaggedObjectives(courseId: string): Promise<string[]>;
  /** Record struggle flags the job found (marked passages), each with its snapshot; an id already recorded counts as recorded. */
  recordFlags(courseId: string, events: ConfusionEvent[]): Promise<{ recorded: number; failed: Array<{ id: string; message: string }> }>;
  /** Add to a finished run's left-out list (what couldn't be done after its save). */
  noteDropped(runId: string, items: PipelineRun["dropped"]): Promise<void>;
  /** save_structure for the course: the rows that changed and the finished run, in one transaction. */
  save(courseId: string, rows: StructureRows): Promise<void>;
}

export interface JobDeps {
  store: JobStore;
  call: CallStep;
  newId: () => string;
  claimWriting?: RunDeps["claimWriting"];
  /** Render one slide of a material as an image for a figure question; null when it can't be. */
  renderFigure?: (material: Material, slide: number) => Promise<string | null>;
  /** Render one page of a material whole, for reading a handwritten or scanned page; null when it can't be. */
  renderPage?: (material: Material, page: number) => Promise<string | null>;
}

export type JobOutcome =
  /**
   * `followUp`: flagged objectives that still have no quick-review question and weren't in this run
   * (flags recorded while it worked): the runner queues a top-up for them (src/lib/server/jobs/run.ts).
   */
  | { status: "done"; run: PipelineRun; followUp?: string[] }
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
  if (e instanceof PipelineDeferred) {
    await store.wait(runId, { ok: false, reason: "daily-tokens", message: e.message });
    return { status: "waiting", reason: e.reason };
  }
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
      const out = await pass.run({ course, material, pages, ...(pass.done === "vision" ? { markers: loaded.markers } : {}) }, { call: deps.call, render: (n) => render(material, n) });
      kept = [...kept, ...out.kept];
      // A file read only from its images, none of which could be read, leaves nothing to build from:
      // say so (the card offers Try again) rather than finish with 0 topics as if nothing were new.
      if (pass.done === "vision" && !out.read.length && pages.every((p) => p.source === "needs-vision")) {
        throw new Error(`none of its ${pages.length} pages could be read from their images (${out.kept[0]?.reason ?? "no reason given"})`);
      }
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
        notes: loaded.notes,
        markers: loaded.markers,
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
    const followUp = await recordMarkedPassages(store, run, material, plan.flags, after, materials, loaded);
    return { status: "done", run: plan.run, ...(followUp.length ? { followUp } : {}) };
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
    const course = { ...loaded.course, topics: before.topics };
    // Only this course's objectives: ids from the request that aren't in it are ignored.
    const requested = job.objectiveIds.filter((id) => before.objectives[id]);
    // Flagged objectives with no quick-review question yet are written for too, when there's material
    // to write from (a flag whose own top-up was skipped gets its questions here). Ones with nothing to
    // write from are left out quietly: every top-up would list them again.
    const catchUp = (await flaggedWithoutQuestions(store, run.courseId, before)).filter((id) => !requested.includes(id));
    const unwritable = new Set(topUpTargets({ course, objectives: before.objectives, bank: before.bank, materials, materialPages, objectiveIds: catchUp, answered }).skipped.map((s) => s.objectiveId));
    const objectiveIds = [...requested, ...catchUp.filter((id) => !unwritable.has(id))];
    const plan = await runTopUp(
      {
        course,
        objectives: before.objectives,
        bank: before.bank,
        materials,
        materialPages,
        objectiveIds,
        answered,
        flagged: await store.flagged(run.courseId),
        notes: loaded.notes,
        runId: run.id,
        model: run.model,
        now: run.at,
      },
      { call: deps.call, newId: deps.newId, onProgress: progress.write, claimWriting: deps.claimWriting },
    );
    const bank = { ...before.bank };
    for (const [topicId, qs] of Object.entries(plan.questions)) bank[topicId] = [...(bank[topicId] ?? []), ...qs];
    await progress.flushed();
    await store.save(run.courseId, structureRows(before, { ...before, bank }, [plan.run]));
    // Flags recorded while this ran: the next top-up writes for them.
    const followUp = (await flaggedWithoutQuestions(store, run.courseId, { ...before, bank })).filter((id) => !objectiveIds.includes(id) && !unwritable.has(id));
    return { status: "done", run: plan.run, ...(followUp.length ? { followUp } : {}) };
  } catch (e) {
    await progress.flushed();
    return failed(store, run.id, "Orca couldn't write new questions", e);
  }
}

/**
 * Marked passages are struggle flags, recorded once their objectives are saved (an event's objective
 * must exist). The upload is done either way: what still fails after one retry is listed on the run,
 * never silently lost, and the ids are stable, so nothing is recorded twice. Returns the marked
 * objectives still without questions that a top-up could write for (the runner queues one).
 */
async function recordMarkedPassages(
  store: JobStore,
  run: PipelineRun,
  material: Material,
  flags: ReadonlyArray<{ objectiveId: string; page: number; quote: string }>,
  after: StructureState,
  materials: Material[],
  loaded: LoadedCourse,
): Promise<string[]> {
  if (!flags.length) return [];
  const at = new Date().toISOString();
  const events: ConfusionEvent[] = flags.flatMap((f) => {
    const o = after.objectives[f.objectiveId];
    return o ? [{ kind: "confusion", id: markerFlagId(material.id, f.page, f.objectiveId), at, courseId: run.courseId, topicId: o.topicId, objectiveId: f.objectiveId, materialId: material.id, note: f.quote, flagSource: "handwritten-marker", page: f.page }] : [];
  });
  const failedAll = (list: ConfusionEvent[], e: unknown) => ({ recorded: 0, failed: list.map((ev) => ({ id: ev.id, message: e instanceof Error ? e.message : String(e) })) });
  let out = await store.recordFlags(run.courseId, events).catch((e) => failedAll(events, e));
  if (out.failed.length) {
    const again = events.filter((ev) => out.failed.some((f) => f.id === ev.id));
    out = await store.recordFlags(run.courseId, again).catch((e) => failedAll(again, e));
  }
  // The browser may already have refreshed on "done": these show on the upload card at the next load.
  if (out.failed.length) {
    await store
      .noteDropped(run.id, out.failed.map((f) => ({ prompt: "A marked passage", reason: `couldn't be recorded as a struggle flag (${f.message}); flag it with This is hard` })))
      .catch(() => undefined);
  }
  const recorded = new Set(events.filter((ev) => !out.failed.some((f) => f.id === ev.id)).map((ev) => ev.objectiveId));
  const unasked = withoutQuestions([...recorded], after);
  if (!unasked.length) return [];
  const materialPages = await store.pages(materials.map((m) => m.id));
  // Ones a top-up can't write for either (no pages to write from) aren't worth an empty run.
  const unwritable = new Set(
    topUpTargets({ course: { ...loaded.course, topics: after.topics }, objectives: after.objectives, bank: after.bank, materials, materialPages, objectiveIds: unasked, answered: new Set() }).skipped.map((s) => s.objectiveId),
  );
  return unasked.filter((id) => !unwritable.has(id));
}

/** Flagged objectives (as they stand now, after merges) that are live and have no quick-review question. */
async function flaggedWithoutQuestions(store: JobStore, courseId: string, structure: Pick<StructureState, "objectives" | "bank">): Promise<string[]> {
  return withoutQuestions(await store.flaggedObjectives(courseId), structure);
}

/** Of `ids` (followed through merges), the live objectives with no quick-review question. */
function withoutQuestions(ids: readonly string[], structure: Pick<StructureState, "objectives" | "bank">): string[] {
  const survivor = (id: string) => {
    let o = structure.objectives[id];
    for (let i = 0; o?.mergedInto && i < 50; i++) o = structure.objectives[o.mergedInto];
    return o?.id ?? id;
  };
  const asked = new Set(Object.values(structure.bank).flat().filter((q) => !q.deep).map((q) => survivor(q.objectiveId)));
  const flagged = [...new Set(ids.map(survivor))];
  return flagged.filter((id) => structure.objectives[id] && structure.objectives[id].review !== "archived" && !asked.has(id));
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
        { course: { ...loaded.course, topics: before.topics }, objectives: before.objectives, bank: before.bank, materials, materialPages, objectiveIds, count: toWrite, flagged: await store.flagged(run.courseId), notes: loaded.notes },
        { call: deps.call, newId: deps.newId, claimWriting: deps.claimWriting },
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
        const objectiveId = question.objectiveId;
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
