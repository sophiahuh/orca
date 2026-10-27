/** Which objectives a topic has, derived from the questions in its bank. */
import type { QuizQuestion } from "../data.ts";
import type { ObjectiveInfo } from "./types.ts";

export type QuestionRef = Pick<QuizQuestion, "id" | "objectiveId" | "tier">;

export interface TopicObjective extends ObjectiveInfo {
  hasMechanismQuestions: boolean;
  questionIds: string[];
}

/**
 * Follow `mergedInto` to the objective that now stands for `id`. Returns the id unchanged when
 * it isn't in the catalogue (callers decide whether that's an error).
 */
export function resolveObjectiveId(id: string, catalogue: Readonly<Record<string, Pick<ObjectiveInfo, "topicId" | "mergedInto">>>): string {
  const seen = new Set<string>();
  let current = id;
  while (catalogue[current]?.mergedInto) {
    if (seen.has(current)) throw new Error(`Objective merge cycle through "${current}"`);
    seen.add(current);
    current = catalogue[current].mergedInto!;
  }
  return current;
}

type Filing = Readonly<Record<string, Pick<ObjectiveInfo, "topicId" | "mergedInto">>>;

/**
 * The topic an objective lives in now: follow the objective's merges to its survivor, then that
 * survivor's topic's merges. A question's topic is always this, never a stored copy (2026-10-26:
 * questions saved by a job while the student merged kept the old topic and broke the course).
 */
export function currentTopicOf(objectiveId: string, catalogue: Filing, topicMergedInto: ReadonlyMap<string, string>): string {
  const objective = catalogue[resolveObjectiveId(objectiveId, catalogue)];
  if (!objective) throw new Error(`Objective "${objectiveId}" isn't in the course`);
  const seen = new Set<string>();
  let topic = objective.topicId;
  while (topicMergedInto.has(topic)) {
    if (seen.has(topic)) throw new Error(`Topic merge cycle through "${topic}"`);
    seen.add(topic);
    topic = topicMergedInto.get(topic)!;
  }
  return topic;
}

/**
 * Objectives with their topic followed through topic merges. An upload can create an objective in
 * a topic the student merges meanwhile; the merge only moved the objectives the browser knew of.
 * Returns the same record when nothing moves.
 */
export function withCurrentTopics<O extends { topicId: string }>(objectives: Readonly<Record<string, O>>, topicMergedInto: ReadonlyMap<string, string>): Record<string, O> {
  if (!topicMergedInto.size || !Object.values(objectives).some((o) => topicMergedInto.has(o.topicId))) return objectives as Record<string, O>;
  const out: Record<string, O> = {};
  for (const [id, o] of Object.entries(objectives)) {
    out[id] = topicMergedInto.has(o.topicId) ? { ...o, topicId: currentTopicOf(id, { [id]: { topicId: o.topicId } }, topicMergedInto) } : o;
  }
  return out;
}

/** Group questions by topic, each under its objective's current topic (`currentTopicOf`), in the order given. */
export function fileQuestions<Q extends { id: string; objectiveId: string }>(questions: readonly Q[], catalogue: Filing, topicMergedInto: ReadonlyMap<string, string>): Record<string, Q[]> {
  const bank: Record<string, Q[]> = {};
  for (const question of questions) {
    if (!catalogue[question.objectiveId]) throw new Error(`Question ${question.id} points at objective "${question.objectiveId}", which isn't in the course`);
    (bank[currentTopicOf(question.objectiveId, catalogue, topicMergedInto)] ??= []).push(question);
  }
  return bank;
}

/**
 * Objectives with their questions for one topic. A question counts for the objective its own
 * objective was merged into; questions of archived (rejected) objectives are left out.
 */
export function objectivesForTopic(
  topicId: string,
  questions: readonly QuestionRef[],
  catalogue: Readonly<Record<string, ObjectiveInfo>>,
): TopicObjective[] {
  const byId = new Map<string, TopicObjective>();
  for (const q of questions) {
    const id = resolveObjectiveId(q.objectiveId, catalogue);
    let objective = byId.get(id);
    if (!objective) {
      const found = catalogue[id];
      if (!found) throw new Error(`Question ${q.id} points at objective "${id}", which is not in the catalogue`);
      if (found.review === "archived") continue;
      if (found.topicId !== topicId) {
        throw new Error(`Question ${q.id} is in topic "${topicId}" but its objective "${id}" belongs to "${found.topicId}"`);
      }
      objective = { ...found, hasMechanismQuestions: false, questionIds: [] };
      byId.set(id, objective);
    }
    objective.questionIds.push(q.id);
    if (q.tier === "mechanism") objective.hasMechanismQuestions = true;
  }
  return [...byId.values()];
}

/** The objective a question counts for now (after merges), or null if that objective is archived. */
export function liveObjectiveOf(q: { objectiveId: string }, catalogue: Readonly<Record<string, ObjectiveInfo>>): ObjectiveInfo | null {
  const found = catalogue[resolveObjectiveId(q.objectiveId, catalogue)];
  if (!found) throw new Error(`Objective "${q.objectiveId}" is not in the catalogue`);
  return found.review === "archived" ? null : found;
}
