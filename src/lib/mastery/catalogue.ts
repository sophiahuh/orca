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

export function objectivesForTopic(
  topicId: string,
  questions: readonly QuestionRef[],
  catalogue: Readonly<Record<string, ObjectiveInfo>>,
): TopicObjective[] {
  const byId = new Map<string, TopicObjective>();
  for (const q of questions) {
    const id = objectiveIdOf(q, topicId);
    let objective = byId.get(id);
    if (!objective) {
      let info: ObjectiveInfo;
      if (id === unsortedObjectiveId(topicId)) {
        info = { id, topicId, name: "Questions not yet sorted into objectives" };
      } else {
        const found = catalogue[id];
        if (!found) throw new Error(`Question ${q.id} points at objective "${id}", which is not in the catalogue`);
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
