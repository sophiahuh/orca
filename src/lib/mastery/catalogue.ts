/** Which objectives a topic has, derived from the questions in its bank. */
import type { QuizQuestion } from "../data.ts";
import type { ObjectiveInfo } from "./types.ts";

export type QuestionRef = Pick<QuizQuestion, "id" | "objectiveId" | "tier">;

export interface TopicObjective extends ObjectiveInfo {
  hasMechanismQuestions: boolean;
  questionIds: string[];
}

/** The explicit bucket for questions extraction hasn't assigned to an objective yet. */
export function unsortedObjectiveId(topicId: string) {
  return `${topicId}#unsorted`;
}

export function objectiveIdOf(q: { objectiveId?: string }, topicId: string) {
  return q.objectiveId ?? unsortedObjectiveId(topicId);
}

/**
 * Follow `mergedInto` to the objective that now stands for `id`. Returns the id unchanged when
 * it isn't in the catalogue (callers decide whether that's an error).
 */
export function resolveObjectiveId(id: string, catalogue: Readonly<Record<string, ObjectiveInfo>>): string {
  const seen = new Set<string>();
  let current = id;
  while (catalogue[current]?.mergedInto) {
    if (seen.has(current)) throw new Error(`Objective merge cycle through "${current}"`);
    seen.add(current);
    current = catalogue[current].mergedInto!;
  }
  return current;
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
    const raw = objectiveIdOf(q, topicId);
    const id = raw === unsortedObjectiveId(topicId) ? raw : resolveObjectiveId(raw, catalogue);
    let objective = byId.get(id);
    if (!objective) {
      let info: ObjectiveInfo;
      if (id === unsortedObjectiveId(topicId)) {
        info = { id, topicId, name: "Questions not yet sorted into objectives", review: "confirmed" };
      } else {
        const found = catalogue[id];
        if (!found) throw new Error(`Question ${q.id} points at objective "${id}", which is not in the catalogue`);
        if (found.review === "archived") continue;
        if (found.topicId !== topicId) {
          throw new Error(`Question ${q.id} is in topic "${topicId}" but its objective "${id}" belongs to "${found.topicId}"`);
        }
        info = found;
      }
      objective = { ...info, hasMechanismQuestions: false, questionIds: [] };
      byId.set(id, objective);
    }
    objective.questionIds.push(q.id);
    if (q.tier === "mechanism") objective.hasMechanismQuestions = true;
  }
  return [...byId.values()];
}

/** The objective a question counts for now (after merges), or null if that objective is archived. */
export function liveObjectiveOf(
  q: { objectiveId?: string },
  topicId: string,
  catalogue: Readonly<Record<string, ObjectiveInfo>>,
): ObjectiveInfo | null {
  const raw = objectiveIdOf(q, topicId);
  if (raw === unsortedObjectiveId(topicId)) return { id: raw, topicId, name: "Questions not yet sorted into objectives", review: "confirmed" };
  const found = catalogue[resolveObjectiveId(raw, catalogue)];
  if (!found) throw new Error(`Objective "${raw}" is not in the catalogue`);
  return found.review === "archived" ? null : found;
}
