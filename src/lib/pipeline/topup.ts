/**
 * Topping up the question stock after a session (docs/MASTERY-PLAN.md §4): objectives with fewer
 * than 3 questions the student hasn't seen get new ones, written from the material that teaches
 * them and checked like an upload's. Model calls are injected; nothing here touches the store.
 */
import type { Material, MaterialPages, Objective, PipelineRun, QuizQuestion, Topic } from "../data.ts";
import { QUESTIONS_PER_OBJECTIVE } from "./questions.ts";
import { type RunDeps, type WriteTarget, writeQuestions } from "./run.ts";

export const TOP_UP_RULES = {
  /** Top up when an objective has fewer unseen questions than this... */
  minUnseen: 3,
  /** ...back up to this many unseen. */
  stock: QUESTIONS_PER_OBJECTIVE,
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
  /** One record per material written from. */
  runs: PipelineRun[];
  /** Objectives that needed questions but couldn't get them, and why. */
  skipped: TopUpSkip[];
}

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

/** Which objectives need questions, grouped by the material to write them from. */
export function topUpTargets(input: Omit<TopUpInput, "runId" | "model" | "now">): { byMaterial: Map<string, WriteTarget[]>; skipped: TopUpSkip[] } {
  const all = Object.values(input.bank).flat();
  const byMaterial = new Map<string, WriteTarget[]>();
  const skipped: TopUpSkip[] = [];
  for (const id of new Set(input.objectiveIds.map((id) => survivorId(id, input.objectives)))) {
    const o = input.objectives[id];
    if (!o || o.review === "archived") continue;
    const existing = all.filter((q) => q.objectiveId !== undefined && survivorId(q.objectiveId, input.objectives) === id);
    const unseen = existing.filter((q) => !input.answered.has(q.id)).length;
    if (unseen >= TOP_UP_RULES.minUnseen) continue;
    const sources = materialsFor(o);
    const source = sources.find((m) => input.materialPages[m] && input.materials.some((x) => x.id === m));
    if (!source) {
      skipped.push({
        objectiveId: id,
        reason: sources.length ? "its material's text wasn't kept (uploaded before top-ups); upload it again" : "no course material to write from",
      });
      continue;
    }
    const list = byMaterial.get(source) ?? [];
    list.push({ objective: o, existing, need: TOP_UP_RULES.stock - unseen });
    byMaterial.set(source, list);
  }
  return { byMaterial, skipped };
}

export async function runTopUp(input: TopUpInput, deps: Pick<RunDeps, "call" | "newId">): Promise<TopUpPlan> {
  const { byMaterial, skipped } = topUpTargets(input);
  const questions: Record<string, QuizQuestion[]> = {};
  const runs: PipelineRun[] = [];
  const topics = new Map(input.course.topics.map((t) => [t.id, t]));
  // Questions written from one material count as "already in the course" for the next.
  const bank: Record<string, QuizQuestion[]> = { ...input.bank };
  for (const [materialId, targets] of byMaterial) {
    const material = input.materials.find((m) => m.id === materialId)!;
    let written: Awaited<ReturnType<typeof writeQuestions>>;
    try {
      written = await writeQuestions({ course: input.course, material, pages: input.materialPages[materialId], topics, targets, bank }, deps);
    } catch (e) {
      for (const t of targets) skipped.push({ objectiveId: t.objective.id, reason: `couldn't write questions: ${e instanceof Error ? e.message : String(e)}` });
      continue;
    }
    for (const [topicId, qs] of Object.entries(written.questions)) {
      questions[topicId] = [...(questions[topicId] ?? []), ...qs];
      bank[topicId] = [...(bank[topicId] ?? []), ...qs];
    }
    runs.push({
      id: runs.length === 0 ? input.runId : `${input.runId}:${runs.length}`,
      kind: "top-up",
      courseId: input.course.id,
      materialId,
      at: input.now,
      model: input.model,
      topicsCreated: [],
      objectivesCreated: [],
      objectivesAttached: targets.map((t) => t.objective.id),
      questionsAdded: Object.values(written.questions).flat().length,
      dropped: written.dropped,
    });
  }
  return { questions, runs, skipped };
}
