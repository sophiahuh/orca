/**
 * The exam card on the course page (cram mode contract, section 5, "Exam weights"): which exam it
 * shows, how far off it is, what it covers, and the scope its setup saves. Pure.
 */
import type { Exam, ExamScope, Objective, Topic } from "../data.ts";
import { SCOPE_STRENGTH } from "./scope.ts";
import { survivingTopic } from "./weights.ts";

/** The exam the card shows: the cramming exam (soonest first), else the soonest exam on or after today; null without one. */
export function cardExam<E extends Pick<Exam, "courseId" | "date" | "cramming">>(exams: readonly E[], courseId: string, today: string): E | null {
  const mine = exams.filter((e) => e.courseId === courseId && (e.cramming || e.date >= today)).sort((a, b) => Number(b.cramming) - Number(a.cramming) || a.date.localeCompare(b.date));
  return mine[0] ?? null;
}

const utcDay = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

/** Whole days from today to the exam's date: 0 on the day, negative once it's past. */
export function daysUntil(date: string, today: string): number {
  return Math.round((utcDay(date) - utcDay(today)) / 86_400_000);
}

const live = (o: Objective | undefined): o is Objective => !!o && o.review !== "archived" && !o.mergedInto;

/**
 * The objectives an exam covers, in catalogue order: the ones its scope lists with a weight above 0
 * when it has a scope with objectives; else every live objective of its topics (every live topic
 * when it names none). Topic ids follow merges.
 */
export function examObjectives(exam: Pick<Exam, "topicIds" | "scope">, topics: readonly Topic[], objectives: Readonly<Record<string, Objective>>): string[] {
  if (exam.scope?.objectives.length) {
    const listed = new Map(exam.scope.objectives.map((o) => [o.objectiveId, o.weight]));
    return Object.values(objectives)
      .filter((o) => live(o) && (listed.get(o.id) ?? 0) > 0)
      .map((o) => o.id);
  }
  const byId = new Map(topics.map((t) => [t.id, t]));
  const liveTopics = new Set(topics.filter((t) => t.review !== "archived" && !t.mergedInto).map((t) => t.id));
  const covered = exam.topicIds.length ? new Set(exam.topicIds.map((id) => survivingTopic(id, byId)?.id).filter((id): id is string => !!id && liveTopics.has(id))) : liveTopics;
  return Object.values(objectives)
    .filter((o) => live(o) && covered.has(survivingTopic(o.topicId, byId)?.id ?? o.topicId))
    .map((o) => o.id);
}

/** The materials an objective is taught in: the one that created it and the ones its signals name, deduplicated, in that order. */
export function objectiveMaterialIds(o: Pick<Objective, "materialId" | "signals">): string[] {
  return [...new Set([...(o.materialId ? [o.materialId] : []), ...o.signals.map((s) => s.materialId)])];
}

/** What the picker excludes says on the scope: the professor's words, by elimination. */
export const NOT_IN_FILES = "not in the files the exam covers";

/**
 * The objectives the cram setup starts from: every live objective of the exam's topics (its scope
 * set aside, so a narrowed scope can be widened again), split by the materials picked. With
 * nothing picked everything is in scope; else an objective is in scope when the material that
 * created it, or one its signals name, was picked.
 */
export function splitByMaterials(candidates: readonly string[], picked: readonly string[], catalogue: Readonly<Record<string, Objective>>): { inScope: string[]; excluded: string[] } {
  if (!picked.length) return { inScope: [...candidates], excluded: [] };
  const chosen = new Set(picked);
  const inScope: string[] = [];
  const excluded: string[] = [];
  for (const id of candidates) {
    const o = catalogue[id];
    (o && objectiveMaterialIds(o).some((m) => chosen.has(m)) ? inScope : excluded).push(id);
  }
  return { inScope, excluded };
}

/**
 * The scope the cram setup saves. In-scope objectives (every candidate, or the ones taught in the
 * picked materials) keep the weight they had above 0 (1 when new or excluded before), with the
 * professor's words as `professor` evidence on each (its earlier professor quote replaced); the
 * objectives the picker excludes weigh 0 with a `professor` note saying so. Other evidence, the
 * format and the sources are kept; `professor` joins the sources; the picked materials are stored
 * (none when nothing was picked). Without words and without a pick, the scope is left as it is.
 */
export function scopeFromSetup(existing: ExamScope | null, candidates: readonly string[], words: string, picked: readonly string[] = [], catalogue: Readonly<Record<string, Objective>> = {}): ExamScope | null {
  const quote = words.trim();
  if (!quote && !picked.length) return existing;
  const said = quote ? [{ signal: "professor" as const, strength: SCOPE_STRENGTH.professor, quote }] : [];
  const notInFiles = { signal: "professor" as const, strength: SCOPE_STRENGTH.professor, quote: NOT_IN_FILES };
  const { inScope, excluded } = splitByMaterials(candidates, picked, catalogue);
  const chosen = new Set(inScope);
  const out = new Set(excluded);
  const was = new Map((existing?.objectives ?? []).map((o) => [o.objectiveId, o]));
  const ids = [...new Set([...was.keys(), ...inScope, ...excluded])];
  return {
    objectives: ids.map((objectiveId) => {
      const before = was.get(objectiveId);
      const kept = (before?.evidence ?? []).filter((e) => e.signal !== "professor");
      if (out.has(objectiveId)) return { objectiveId, weight: 0, evidence: [...kept, notInFiles] };
      // A listed objective that's no longer a candidate (not in the exam's topics) keeps its weight as it was.
      const weight = chosen.has(objectiveId) ? (before && before.weight > 0 ? before.weight : 1) : (before?.weight ?? 1);
      return { objectiveId, weight, evidence: [...kept, ...said] };
    }),
    ...(existing?.format ? { format: existing.format } : {}),
    sources: [...new Set([...(existing?.sources ?? []), "professor" as const])],
    ...(picked.length ? { materialIds: [...new Set(picked)] } : {}),
  };
}
