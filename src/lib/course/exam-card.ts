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

/**
 * The scope the cram setup saves: every covered objective, at the weight it already has (1 when
 * new), with the professor's words as `professor` evidence on each (its earlier professor quote
 * replaced), and `professor` among the sources. Without words, the scope is left as it is.
 */
export function scopeFromSetup(existing: ExamScope | null, covered: readonly string[], words: string): ExamScope | null {
  const quote = words.trim();
  if (!quote) return existing;
  const evidence = { signal: "professor" as const, strength: SCOPE_STRENGTH.professor, quote };
  const was = new Map((existing?.objectives ?? []).map((o) => [o.objectiveId, o]));
  const ids = [...new Set([...was.keys(), ...covered])];
  return {
    objectives: ids.map((objectiveId) => {
      const before = was.get(objectiveId);
      return { objectiveId, weight: before?.weight ?? 1, evidence: [...(before?.evidence ?? []).filter((e) => e.signal !== "professor"), evidence] };
    }),
    ...(existing?.format ? { format: existing.format } : {}),
    sources: [...new Set([...(existing?.sources ?? []), "professor" as const])],
  };
}
