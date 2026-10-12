/**
 * Objective and topic weights (roadmap "Weight signals and formula"). Claude records facts per
 * upload (coverage, emphasis, which topics are used in which); this turns them into a number. A weight changes
 * priority only, never what counts as mastered. Constants are provisional (docs/TO-DISCUSS.md).
 */
import type { MaterialType, Objective, Relation, Topic, WeightKey, Weights } from "../data.ts";

export const WEIGHT_RULES = {
  /** Coverage factor = floor + span × (1 − e^(−s / scale)), s = summed place values. */
  coverageFloor: 0.75,
  coverageSpan: 0.75,
  coverageScale: 1.5,
  /** Builds-on factor = 1 + step × min(n, cap), n = other topics its topic is used in. */
  buildsOnStep: 0.1,
  buildsOnCap: 5,
  /** "This will be on the exam." */
  tested: 1.5,
  min: 0.5,
  max: 2,
} as const;

/** Which Settings slider a material type feeds; null = neutral (no slider). */
export function sliderFor(type: MaterialType): WeightKey | null {
  switch (type) {
    case "Lecture":
    case "Syllabus":
      return "lectures";
    case "Homework":
      return "homework";
    case "Practice problems":
      return "practiceProblems";
    case "Past exam":
    case "Practice exam":
      return "practiceExams";
    case "Other":
      return null;
  }
}

/** One covering place's value: its type's slider relative to the course's average slider. */
export function placeValue(type: MaterialType, weights: Weights): number {
  const key = sliderFor(type);
  const values = Object.values(weights);
  const mean = values.reduce((a, b) => a + b, 0) / (values.length || 1);
  if (key === null || mean <= 0) return 1;
  const slider = weights[key];
  if (slider === undefined) throw new Error(`No "${key}" weight set for this course`);
  return slider / mean;
}

function coverageFactor(o: Objective, weights: Weights): number {
  if (o.origin === "inferred") return 1;
  const s = o.signals.reduce((sum, sig) => sum + sig.places.length * placeValue(sig.materialType, weights), 0);
  return WEIGHT_RULES.coverageFloor + WEIGHT_RULES.coverageSpan * (1 - Math.exp(-s / WEIGHT_RULES.coverageScale));
}

/** The latest explicit statement wins. */
function emphasisOf(o: Objective): "tested" | "skipped" | null {
  for (let i = o.signals.length - 1; i >= 0; i--) {
    const e = o.signals[i].emphasis;
    if (e) return e.kind;
  }
  return null;
}

/**
 * Weight of one objective. `buildsOn` = how many other live topics its topic is used in. "Skipped" ("you
 * won't be tested on this") is 0 and not clamped: no priority at all.
 */
export function objectiveWeight(o: Objective, buildsOn: number, weights: Weights): number {
  const emphasis = emphasisOf(o);
  if (emphasis === "skipped") return 0;
  const raw =
    coverageFactor(o, weights) *
    (1 + WEIGHT_RULES.buildsOnStep * Math.min(buildsOn, WEIGHT_RULES.buildsOnCap)) *
    (emphasis === "tested" ? WEIGHT_RULES.tested : 1);
  return Math.min(WEIGHT_RULES.max, Math.max(WEIGHT_RULES.min, raw));
}

const live = (o: Objective | undefined): o is Objective => !!o && o.review !== "archived";

/** A topic's survivor (following merges); null for an unknown id. */
export function survivingTopic(id: string, byId: ReadonlyMap<string, Topic>): Topic | null {
  let t = byId.get(id);
  for (let i = 0; i < 50 && t?.mergedInto; i++) t = byId.get(t.mergedInto);
  return t ?? null;
}

/**
 * For every live topic, the other live topics it is used in (its `used-in` relations, through
 * merges, rejected ones left out). The Concept Atlas sizes a topic's node by this; weights use it.
 */
export function topicUses(topics: readonly Topic[], relations: readonly Relation[]): Map<string, Set<string>> {
  const byId = new Map(topics.map((t) => [t.id, t]));
  const out = new Map<string, Set<string>>();
  for (const t of topics) if (t.review !== "archived") out.set(t.id, new Set());
  for (const r of relations) {
    if (r.type !== "used-in" || r.review === "archived") continue;
    const from = survivingTopic(r.from, byId);
    const to = survivingTopic(r.to, byId);
    if (!from || !to || from.id === to.id || from.review === "archived" || to.review === "archived") continue;
    out.get(from.id)!.add(to.id);
  }
  return out;
}

/** Weights of every live objective in a course; an objective counts the topics its topic is used in. */
export function courseObjectiveWeights(objectives: Readonly<Record<string, Objective>>, topics: readonly Topic[], relations: readonly Relation[], weights: Weights): Map<string, number> {
  const uses = topicUses(topics, relations);
  const out = new Map<string, number>();
  for (const o of Object.values(objectives)) if (live(o)) out.set(o.id, objectiveWeight(o, uses.get(o.topicId)?.size ?? 0, weights));
  return out;
}

/** Mean weight of a topic's live objectives; null when it has none (shown as "no objectives yet", never as 1.0). */
export function topicWeight(topicId: string, objectives: Readonly<Record<string, Objective>>, objectiveWeights: ReadonlyMap<string, number>): number | null {
  const ws = Object.values(objectives)
    .filter((o) => o.topicId === topicId && live(o))
    .map((o) => {
      const w = objectiveWeights.get(o.id);
      if (w === undefined) throw new Error(`No weight computed for objective ${o.id}`);
      return w;
    });
  return ws.length ? ws.reduce((a, b) => a + b, 0) / ws.length : null;
}
