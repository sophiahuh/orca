/**
 * Objective and topic weights (roadmap "Weight signals and formula"). Claude records facts per
 * upload (coverage, emphasis, which topics are used in which); this turns them into a number. A weight changes
 * priority only, never what counts as mastered. Constants are provisional (docs/TO-DISCUSS.md).
 * Every covering place counts 1 whatever its material type: the material-type sliders were removed
 * (2026-10-25); Notes for Orca can set an objective's emphasis instead.
 */
import type { ExamScope, Objective, Relation, Topic } from "../data.ts";
import { AGENDA_RULES, addDays } from "../mastery/agenda.ts";

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

function coverageFactor(o: Objective): number {
  if (o.origin === "inferred") return 1;
  const s = o.signals.reduce((sum, sig) => sum + sig.places.length, 0);
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
export function objectiveWeight(o: Objective, buildsOn: number): number {
  const emphasis = emphasisOf(o);
  if (emphasis === "skipped") return 0;
  const raw =
    coverageFactor(o) *
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
export function courseObjectiveWeights(objectives: Readonly<Record<string, Objective>>, topics: readonly Topic[], relations: readonly Relation[]): Map<string, number> {
  const uses = topicUses(topics, relations);
  const out = new Map<string, number>();
  for (const o of Object.values(objectives)) if (live(o)) out.set(o.id, objectiveWeight(o, uses.get(o.topicId)?.size ?? 0));
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

/* ── Exam weights (cram mode contract, section 5) ── */

/** What `examScopeWeights` reads of an exam: when it is, whether the student is cramming for it, and its scope. */
export interface ScopedExam {
  courseId: string;
  /** ISO date, YYYY-MM-DD */
  date: string;
  cramming: boolean;
  scope: ExamScope | null;
}

/** Today is inside the exam's window: the student is cramming for it, or it's within `AGENDA_RULES.examWindowDays` (today included). */
export function inExamWindow(exam: Pick<ScopedExam, "date" | "cramming">, today: string): boolean {
  return exam.cramming || (exam.date >= today && addDays(exam.date, -AGENDA_RULES.examWindowDays) <= today);
}

/**
 * The exam whose scope applies today, for one course: the cramming exam (soonest first, the one
 * `course_state.cramming` names), else the soonest exam within the window; null outside every window.
 */
export function scopingExam<E extends ScopedExam>(exams: readonly E[], courseId: string, today: string): E | null {
  const open = exams.filter((e) => e.courseId === courseId && inExamWindow(e, today)).sort((a, b) => Number(b.cramming) - Number(a.cramming) || a.date.localeCompare(b.date));
  return open[0] ?? null;
}

/**
 * The agenda's effective weights: inside the exam window, each objective's course weight × its
 * scope weight (1 when the scope doesn't list it, 0 when it's excluded or weighs 0); outside the
 * window, or with an exam that has no scope, the course weights unchanged. Every id in `weights`
 * stays present, so `agendaWeights` still finds each one.
 */
export function examScopeWeights(exams: readonly ScopedExam[], courseId: string, today: string, weights: ReadonlyMap<string, number>): Map<string, number> {
  const exam = scopingExam(exams, courseId, today);
  if (!exam?.scope) return new Map(weights);
  const scoped = new Map(exam.scope.objectives.map((o) => [o.objectiveId, Math.max(0, o.weight)]));
  const out = new Map<string, number>();
  for (const [id, w] of weights) out.set(id, w * (scoped.get(id) ?? 1));
  return out;
}
