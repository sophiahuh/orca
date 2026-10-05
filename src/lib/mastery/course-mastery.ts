/** Everything learner-facing about one course, derived in one pass. */
import { attribution } from "./attribution.ts";
import type { QuestionRef } from "./catalogue.ts";
import { MASTERY_RULES, computeObjectiveState } from "./objective-state.ts";
import { type IslandLevel, type TopicProgress, islandLevel, topicProgress } from "./progress.ts";
import type { EvidenceEvent, ObjectiveInfo, ObjectiveState } from "./types.ts";

export interface CourseMastery {
  objectives: Map<string, ObjectiveState>;
  /** topicId → its objective ids, in first-seen order. */
  topicObjectives: Map<string, string[]>;
  topics: Map<string, TopicProgress>;
  /**
   * topicId → how many of its objectives have fewer questions than the mastery bar needs
   * (3 different questions), so they can't be mastered until more questions exist.
   */
  objectivesNeedingQuestions: Map<string, number>;
  island: IslandLevel;
  /** This course's evidence, each event filed under the objective it counts for now (merges and re-sorting followed). */
  events: EvidenceEvent[];
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
  // An answer counts toward its question's *current* objective, so re-sorting questions into
  // objectives re-files past answers too. Otherwise the objective recorded at answer time is used,
  // following merges. Answers on archived objectives (or archived topics' objectives) match no
  // listed objective, so they count for nothing (attribution.ts; the server's snapshots use it too).
  const { perTopic, refile } = attribution({ topicIds, bank, catalogue });
  const events = evidence
    .filter((e) => e.courseId === courseId)
    .map((e) => {
      const current = refile(e);
      return current !== e.objectiveId ? { ...e, objectiveId: current } : e;
    });

  const objectives = new Map<string, ObjectiveState>();
  const topicObjectives = new Map<string, string[]>();
  const topics = new Map<string, TopicProgress>();
  const objectivesNeedingQuestions = new Map<string, number>();
  for (const { topicId, list } of perTopic) {
    for (const o of list) {
      objectives.set(o.id, computeObjectiveState(o.id, events, now, { hasMechanismQuestions: o.hasMechanismQuestions, dayKey }));
    }
    const ids = list.map((o) => o.id);
    topicObjectives.set(topicId, ids);
    topics.set(topicId, topicProgress(ids, objectives));
    objectivesNeedingQuestions.set(topicId, list.filter((o) => o.questionIds.length < MASTERY_RULES.requiredCredit).length);
  }
  return { objectives, topicObjectives, topics, objectivesNeedingQuestions, island: islandLevel([...objectives.values()]), events };
}
