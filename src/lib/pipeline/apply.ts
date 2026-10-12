/** Merge an upload's plan into a course's structure. Pure; the store calls it. */
import type { Relation } from "../data.ts";
import type { CourseStructure } from "../course/ops.ts";
import type { UploadPlan } from "./run.ts";

export interface CourseStructureWithRelations extends CourseStructure {
  relations: Relation[];
}

export function applyUploadPlan(s: CourseStructureWithRelations, plan: UploadPlan): CourseStructureWithRelations {
  const topics = [
    ...s.topics.map((t) => (plan.topicAliases[t.id] ? { ...t, aliases: [...t.aliases, ...plan.topicAliases[t.id]] } : t)),
    ...plan.newTopics,
  ];
  const objectives = { ...s.objectives };
  for (const [id, update] of Object.entries(plan.objectiveUpdates)) {
    const o = objectives[id];
    if (!o) throw new Error(`The upload updates objective ${id}, which isn't in the course`);
    objectives[id] = { ...o, aliases: [...o.aliases, ...update.aliases], signals: update.signal ? [...o.signals, update.signal] : o.signals };
  }
  for (const o of plan.newObjectives) objectives[o.id] = o;
  const bank = { ...s.bank };
  for (const [topicId, qs] of Object.entries(plan.questions)) bank[topicId] = [...(bank[topicId] ?? []), ...qs];
  return { topics, objectives, bank, relations: [...s.relations, ...plan.relations] };
}
