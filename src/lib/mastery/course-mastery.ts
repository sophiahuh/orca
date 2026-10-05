/** Everything learner-facing about one course, derived in one pass. */
import { objectivesForTopic, type QuestionRef } from "./catalogue.ts";
import { computeObjectiveState } from "./objective-state.ts";
import { type IslandLevel, type TopicProgress, islandLevel, topicProgress } from "./progress.ts";
import type { EvidenceEvent, ObjectiveInfo, ObjectiveState } from "./types.ts";

export interface CourseMastery {
  objectives: Map<string, ObjectiveState>;
  /** topicId → its objective ids, in first-seen order. */
  topicObjectives: Map<string, string[]>;
  topics: Map<string, TopicProgress>;
  island: IslandLevel;
}

export interface CourseMasteryInput {
  courseId: string;
  topicIds: readonly string[];
  /** topicId → that topic's questions. */
  bank: Readonly<Record<string, readonly QuestionRef[]>>;
  catalogue: Readonly<Record<string, ObjectiveInfo>>;
  evidence: readonly EvidenceEvent[];
  now: Date;
  dayKey?: (iso: string) => string;
}

export function courseMastery({ courseId, topicIds, bank, catalogue, evidence, now, dayKey }: CourseMasteryInput): CourseMastery {
  const perTopic = topicIds.map((topicId) => ({ topicId, list: objectivesForTopic(topicId, bank[topicId] ?? [], catalogue) }));

  // An answer counts toward its question's *current* objective, so re-sorting questions into
  // objectives re-files past answers too. The objective recorded at answer time is used only
  // when the question is no longer in the bank.
  const objectiveOfQuestion = new Map<string, string>();
  for (const { list } of perTopic) for (const o of list) for (const q of o.questionIds) objectiveOfQuestion.set(q, o.id);
  const events = evidence
    .filter((e) => e.courseId === courseId)
    .map((e) => {
      const current = objectiveOfQuestion.get(e.questionId);
      return current && current !== e.objectiveId ? { ...e, objectiveId: current } : e;
    });

  const objectives = new Map<string, ObjectiveState>();
  const topicObjectives = new Map<string, string[]>();
  const topics = new Map<string, TopicProgress>();
  for (const { topicId, list } of perTopic) {
    for (const o of list) {
      objectives.set(o.id, computeObjectiveState(o.id, events, now, { hasMechanismQuestions: o.hasMechanismQuestions, dayKey }));
    }
    const ids = list.map((o) => o.id);
    topicObjectives.set(topicId, ids);
    topics.set(topicId, topicProgress(ids, objectives));
  }
  return { objectives, topicObjectives, topics, island: islandLevel([...objectives.values()]) };
}
