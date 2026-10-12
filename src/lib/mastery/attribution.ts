/**
 * Which objective each event counts for now. Shared by the in-browser fold (course-mastery.ts) and
 * the server's snapshots (`objective_state`, one per objective an event counts for), so both read
 * the log the same way.
 */
import { type QuestionRef, type TopicObjective, objectivesForTopic, resolveObjectiveId } from "./catalogue.ts";
import type { EvidenceEvent, ObjectiveInfo } from "./types.ts";

export interface AttributionInput {
  /** The topics on the trail (archived ones left out); their objectives are the ones that hold state. */
  topicIds: readonly string[];
  /** topicId → that topic's questions. */
  bank: Readonly<Record<string, readonly QuestionRef[]>>;
  catalogue: Readonly<Record<string, ObjectiveInfo>>;
}

export interface Attribution {
  /** topicId → its objectives with their questions, in first-seen order. */
  perTopic: ReadonlyArray<{ topicId: string; list: TopicObjective[] }>;
  /** Every objective that can hold state now, by id. */
  objectives: ReadonlyMap<string, TopicObjective>;
  /**
   * Where an event is filed now: an answer under its question's current objective (so re-sorting
   * questions re-files past answers), otherwise its recorded objective, following merges. May name
   * an objective that holds no state (archived, or its topic is off the trail).
   */
  refile(e: EvidenceEvent): string;
  /** The objective an event counts for now, or null when it counts for nothing. */
  countsFor(e: EvidenceEvent): string | null;
}

export function attribution({ topicIds, bank, catalogue }: AttributionInput): Attribution {
  const perTopic = topicIds.map((topicId) => ({ topicId, list: objectivesForTopic(topicId, bank[topicId] ?? [], catalogue) }));
  const objectives = new Map<string, TopicObjective>();
  const objectiveOfQuestion = new Map<string, string>();
  for (const { list } of perTopic) {
    for (const o of list) {
      objectives.set(o.id, o);
      for (const q of o.questionIds) objectiveOfQuestion.set(q, o.id);
    }
  }
  const refile = (e: EvidenceEvent) =>
    (e.kind === "answer" ? objectiveOfQuestion.get(e.questionId) : undefined) ?? resolveObjectiveId(e.objectiveId, catalogue);
  return {
    perTopic,
    objectives,
    refile,
    countsFor(e) {
      const id = refile(e);
      return objectives.has(id) ? id : null;
    },
  };
}

/** The events that count for one objective, each filed under it (in log order). */
export function eventsCountingFor(objectiveId: string, events: readonly EvidenceEvent[], a: Attribution): EvidenceEvent[] {
  return events.flatMap((e) => (a.countsFor(e) !== objectiveId ? [] : e.objectiveId === objectiveId ? [e] : [{ ...e, objectiveId }]));
}
