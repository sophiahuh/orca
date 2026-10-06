/**
 * Topping up the question stock after a session (docs/MASTERY-PLAN.md §4): objectives with fewer
 * than 3 questions the student hasn't seen get new ones, written from the material that teaches
 * them like an upload's. Also the targets for a deep review's questions (`deepTargets`). Model
 * calls are injected; nothing here touches the store.
 */
import type { Material, MaterialPages, Objective, PipelineRun, QuizQuestion, Topic } from "../data.ts";
import { locatorPages } from "../course/study.ts";
import { QUESTIONS_PER_OBJECTIVE } from "./questions.ts";
import { DEEP_RULES } from "../deep-review.ts";
import { type RunDeps, type WriteTarget, writeQuestions } from "./run.ts";

export const TOP_UP_RULES = {
  /** Top up when an objective has fewer unseen questions than this... */
  minUnseen: 3,
  /** ...back up to this many unseen. */
  stock: QUESTIONS_PER_OBJECTIVE,
  /** Pages either side of an anchored page sent along for context. */
  neighbours: 1,
  /** With no anchored pages, the whole material is sent only if it is at most this long. */
  wholeMaterialMaxPages: 60,
} as const;

export interface TopUpInput {
  course: { id: string; name: string; short: string; topics: Topic[] };
  objectives: Readonly<Record<string, Objective>>;
  bank: Readonly<Record<string, QuizQuestion[]>>;
  materials: readonly Material[];
  materialPages: Readonly<Record<string, MaterialPages>>;
  /** Objectives to consider (the ones a session asked about). */
  objectiveIds: readonly string[];
  /** Every question the student has answered. */
  answered: ReadonlySet<string>;
  runId: string;
  model: string;
  /** ISO time. */
  now: string;
}

export interface TopUpSkip {
  objectiveId: string;
  reason: string;
}

export interface TopUpPlan {
  /** topicId → new questions. */
  questions: Record<string, QuizQuestion[]>;
  /**
   * The top-up's one run record: every material it wrote from (named when there was exactly one),
   * every objective it tried, and what was left out, including objectives it couldn't write for.
   */
  run: PipelineRun;
  /** Objectives that needed questions but couldn't get them, and why. */
  skipped: TopUpSkip[];
}

/** How a skipped objective reads in the run's left-out list (the end card shows the first one). */
export const SKIPPED_PREFIX = "skipped: ";

function survivorId(id: string, objectives: Readonly<Record<string, Objective>>) {
  let current = id;
  for (let i = 0; i < 50 && objectives[current]?.mergedInto; i++) current = objectives[current].mergedInto!;
  return current;
}

/** The materials an objective is taught in, most coverage first, then the upload that created it. */
function materialsFor(o: Objective): string[] {
  const bySignal = [...o.signals].sort((a, b) => b.places.length - a.places.length).map((s) => s.materialId);
  return [...new Set([...bySignal, ...(o.materialId ? [o.materialId] : [])])];
}

/**
 * The pages to write an objective's questions from: the places its uploads anchored it to in this
 * material (plus a page either side), else its topic's slide range when the topic came from this
 * material, else the whole material when it is short. Null when none applies (a long material
 * with no anchors): the caller says so rather than sending a whole book.
 */
export function pagesFor(o: Objective, topic: Topic | undefined, material: Material, pages: MaterialPages): MaterialPages | null {
  const wanted = new Set<number>();
  for (const s of o.signals) {
    if (s.materialId !== material.id) continue;
    for (const place of s.places) for (const n of locatorPages(place.locator)) for (let d = -TOP_UP_RULES.neighbours; d <= TOP_UP_RULES.neighbours; d++) wanted.add(n + d);
  }
  if (wanted.size === 0 && topic?.source && topic.source.filename === material.filename) {
    for (let n = topic.source.slideStart; n <= topic.source.slideEnd; n++) wanted.add(n);
  }
  if (wanted.size === 0) return pages.length <= TOP_UP_RULES.wholeMaterialMaxPages ? pages : null;
  const picked = pages.filter((p) => wanted.has(p.n));
  return picked.length ? picked : null;
}

/** The material to write an objective's questions from and its pages there, or why there's none. */
function sourceFor(o: Objective, input: Pick<TopUpInput, "course" | "materials" | "materialPages">): { material: Material; pages: MaterialPages } | { reason: string } {
  const sources = materialsFor(o);
  const source = sources.find((m) => input.materialPages[m] && input.materials.some((x) => x.id === m));
  if (!source) return { reason: sources.length ? "its material's text isn't stored (it was added without its file); upload the file again" : "no course material to write from" };
  const material = input.materials.find((m) => m.id === source)!;
  const topic = input.course.topics.find((t) => t.id === o.topicId);
  const pages = pagesFor(o, topic, material, input.materialPages[source]);
  if (!pages) return { reason: `Orca doesn't know where in ${material.filename} it's taught, and the file is too long to send whole` };
  return { material, pages };
}

/** Which objectives need questions, grouped by the material to write them from. */
export function topUpTargets(input: Omit<TopUpInput, "runId" | "model" | "now">): {
  byMaterial: Map<string, WriteTarget[]>;
  /** materialId → only the pages the targets are taught on, in page order. */
  pages: Map<string, MaterialPages>;
  skipped: TopUpSkip[];
} {
  const all = Object.values(input.bank).flat();
  const byMaterial = new Map<string, WriteTarget[]>();
  const pageSets = new Map<string, Set<number>>();
  const skipped: TopUpSkip[] = [];
  for (const id of new Set(input.objectiveIds.map((id) => survivorId(id, input.objectives)))) {
    const o = input.objectives[id];
    if (!o || o.review === "archived") continue;
    // The quick-review stock: deep-review questions are written when a deep review starts.
    const existing = all.filter((q) => !q.deep && q.objectiveId !== undefined && survivorId(q.objectiveId, input.objectives) === id);
    const unseen = existing.filter((q) => !input.answered.has(q.id)).length;
    if (unseen >= TOP_UP_RULES.minUnseen) continue;
    const found = sourceFor(o, input);
    if ("reason" in found) {
      skipped.push({ objectiveId: id, reason: found.reason });
      continue;
    }
    const source = found.material.id;
    const pages = found.pages;
    const list = byMaterial.get(source) ?? [];
    list.push({ objective: o, existing, need: TOP_UP_RULES.stock - unseen });
    byMaterial.set(source, list);
    const set = pageSets.get(source) ?? new Set<number>();
    for (const p of pages) set.add(p.n);
    pageSets.set(source, set);
  }
  const pages = new Map([...pageSets].map(([m, set]) => [m, input.materialPages[m].filter((p) => set.has(p.n))]));
  return { byMaterial, pages, skipped };
}

export async function runTopUp(input: TopUpInput, deps: Pick<RunDeps, "call" | "newId" | "onProgress">): Promise<TopUpPlan> {
  const { byMaterial, pages, skipped } = topUpTargets(input);
  const questions: Record<string, QuizQuestion[]> = {};
  const dropped: PipelineRun["dropped"] = [];
  const attached: string[] = [];
  const topics = new Map(input.course.topics.map((t) => [t.id, t]));
  // Questions written from one material count as "already in the course" for the next.
  const bank: Record<string, QuizQuestion[]> = { ...input.bank };
  for (const [materialId, targets] of byMaterial) {
    const material = input.materials.find((m) => m.id === materialId)!;
    attached.push(...targets.map((t) => t.objective.id));
    let written: Awaited<ReturnType<typeof writeQuestions>>;
    try {
      written = await writeQuestions({ course: input.course, material, pages: pages.get(materialId)!, topics, targets, bank }, deps);
    } catch (e) {
      for (const t of targets) skipped.push({ objectiveId: t.objective.id, reason: `couldn't write questions: ${e instanceof Error ? e.message : String(e)}` });
      continue;
    }
    for (const [topicId, qs] of Object.entries(written.questions)) {
      questions[topicId] = [...(questions[topicId] ?? []), ...qs];
      bank[topicId] = [...(bank[topicId] ?? []), ...qs];
    }
    dropped.push(...written.dropped);
  }
  for (const s of skipped) dropped.push({ prompt: `Objective "${input.objectives[s.objectiveId]?.name ?? s.objectiveId}"`, reason: `${SKIPPED_PREFIX}${s.reason}` });
  const used = [...byMaterial.keys()];
  const run: PipelineRun = {
    id: input.runId,
    kind: "top-up",
    courseId: input.course.id,
    materialId: used.length === 1 ? used[0] : null,
    at: input.now,
    model: input.model,
    status: "done",
    topicsCreated: [],
    objectivesCreated: [],
    objectivesAttached: [...new Set(attached)],
    questionsAdded: Object.values(questions).flat().length,
    dropped,
  };
  return { questions, run, skipped };
}

/* ── Deep review: harder questions written when it starts ─────────────── */

export interface DeepInput extends Pick<TopUpInput, "course" | "objectives" | "bank" | "materials" | "materialPages"> {
  /** The objectives to cover, most urgent first. */
  objectiveIds: readonly string[];
  /** Questions to write in all. */
  count: number;
}

/**
 * Write a deep review's questions: `count` of them spread over the objectives in priority order
 * (one each down the list, then round again, at most `maxPerObjective` each), each from the pages
 * its objective is taught on, marked `deep`. Objectives with nothing to write from are skipped.
 */
export async function runDeepReview(input: DeepInput, deps: Pick<RunDeps, "call" | "newId">): Promise<{ questions: Record<string, QuizQuestion[]>; dropped: PipelineRun["dropped"]; skipped: TopUpSkip[] }> {
  const all = Object.values(input.bank).flat();
  const skipped: TopUpSkip[] = [];
  const writable: Array<{ o: Objective; material: Material; pages: MaterialPages }> = [];
  for (const id of new Set(input.objectiveIds.map((id) => survivorId(id, input.objectives)))) {
    const o = input.objectives[id];
    if (!o || o.review === "archived") continue;
    const found = sourceFor(o, input);
    if ("reason" in found) skipped.push({ objectiveId: id, reason: found.reason });
    else writable.push({ o, ...found });
  }
  const need = new Map<string, number>();
  for (let assigned = 0, round = 0; assigned < input.count && round < DEEP_RULES.maxPerObjective; round++) {
    for (const w of writable) {
      if (assigned >= input.count) break;
      need.set(w.o.id, (need.get(w.o.id) ?? 0) + 1);
      assigned++;
    }
  }
  const byMaterial = new Map<string, { material: Material; targets: WriteTarget[]; pages: Set<number> }>();
  for (const w of writable) {
    const n = need.get(w.o.id);
    if (!n) continue;
    const group = byMaterial.get(w.material.id) ?? { material: w.material, targets: [], pages: new Set<number>() };
    group.targets.push({ objective: w.o, existing: all.filter((q) => q.objectiveId === w.o.id), need: n });
    for (const p of w.pages) group.pages.add(p.n);
    byMaterial.set(w.material.id, group);
  }
  const topics = new Map(input.course.topics.map((t) => [t.id, t]));
  const questions: Record<string, QuizQuestion[]> = {};
  const dropped: PipelineRun["dropped"] = [];
  const written = await Promise.all(
    [...byMaterial.values()].map(({ material, targets, pages }) =>
      writeQuestions({ course: input.course, material, pages: input.materialPages[material.id].filter((p) => pages.has(p.n)), topics, targets, bank: input.bank, deep: true }, deps),
    ),
  );
  for (const w of written) {
    for (const [topicId, qs] of Object.entries(w.questions)) questions[topicId] = [...(questions[topicId] ?? []), ...qs];
    dropped.push(...w.dropped);
  }
  return { questions, dropped, skipped };
}

/**
 * Dive questions written earlier and never answered, for these objectives (merged ones followed),
 * picked the way a dive is ordered: one per objective in priority order, then round again, at most
 * `maxPerObjective` each and `count` in all. A dive asks these before any new ones are written.
 */
export function unansweredDeepQuestions(
  input: Pick<DeepInput, "objectives" | "bank" | "objectiveIds" | "count">,
  answered: ReadonlySet<string>,
): Array<{ topicId: string; question: QuizQuestion }> {
  const byObjective = new Map<string, Array<{ topicId: string; question: QuizQuestion }>>();
  for (const [topicId, questions] of Object.entries(input.bank)) {
    for (const question of questions) {
      if (!question.deep || !question.objectiveId || answered.has(question.id)) continue;
      const id = survivorId(question.objectiveId, input.objectives);
      byObjective.set(id, [...(byObjective.get(id) ?? []), { topicId, question }]);
    }
  }
  const order = [...new Set(input.objectiveIds.map((id) => survivorId(id, input.objectives)))].filter((id) => input.objectives[id] && input.objectives[id].review !== "archived");
  const picked: Array<{ topicId: string; question: QuizQuestion }> = [];
  for (let round = 0; round < DEEP_RULES.maxPerObjective && picked.length < input.count; round++) {
    for (const id of order) {
      if (picked.length >= input.count) break;
      const next = byObjective.get(id)?.[round];
      if (next) picked.push(next);
    }
  }
  return picked;
}
