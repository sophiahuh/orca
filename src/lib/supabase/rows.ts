/**
 * Database rows ↔ the mastery code's types, for evidence, snapshots and the structure the fold
 * reads. Pure (loads under plain Node), so the server and the HTTP check script share it.
 */
import { attribution } from "../mastery/attribution.ts";
import { type QuestionRef, fileQuestions, withCurrentTopics } from "../mastery/catalogue.ts";
import { type ObjectiveAccumulator, dayKeyIn } from "../mastery/objective-state.ts";
import type { CourseView, Snapshot } from "../mastery/snapshots.ts";
import type { AnswerEvent, EvidenceEvent, ObjectiveInfo } from "../mastery/types.ts";
import type { Database } from "./database.types.ts";

type Tables = Database["public"]["Tables"];
export type EvidenceRow = Tables["evidence_events"]["Row"];
export type SnapshotRow = Tables["objective_state"]["Row"];

/** An evidence row as the fold reads it. `at` is normalised to the ISO form the server stamps. */
export function eventFromRow(r: EvidenceRow): EvidenceEvent {
  const base = { id: r.id, at: new Date(r.at).toISOString(), courseId: r.course_id, topicId: r.topic_id, objectiveId: r.objective_id };
  if (r.kind === "confusion") {
    if (r.material_id === null || r.note === null) throw new Error(`Confusion event ${r.id} is missing its material or note`);
    return { ...base, kind: "confusion", materialId: r.material_id, note: r.note };
  }
  if (r.question_id === null || r.outcome === null || r.grader === null || r.source === null || r.session_id === null) {
    throw new Error(`Answer event ${r.id} is missing a field`);
  }
  return {
    ...base,
    kind: "answer",
    questionId: r.question_id,
    // The table's CHECK constraints hold these to the same values as the types.
    tier: r.tier as AnswerEvent["tier"],
    outcome: r.outcome as AnswerEvent["outcome"],
    grader: r.grader as AnswerEvent["grader"],
    source: r.source as AnswerEvent["source"],
    sessionId: r.session_id,
  };
}

/** An event as an evidence_events row (owner_id is set by record_evidence from the verified user). */
export function eventToRow(e: EvidenceEvent): Omit<EvidenceRow, "owner_id"> {
  const common = { id: e.id, kind: e.kind, at: e.at, course_id: e.courseId, topic_id: e.topicId, objective_id: e.objectiveId };
  return e.kind === "answer"
    ? { ...common, question_id: e.questionId, tier: e.tier, outcome: e.outcome, grader: e.grader, source: e.source, session_id: e.sessionId, material_id: null, note: null }
    : { ...common, question_id: null, tier: null, outcome: null, grader: null, source: null, session_id: null, material_id: e.materialId, note: e.note };
}

export function snapshotFromRow(r: SnapshotRow): Snapshot {
  return {
    objectiveId: r.objective_id,
    accumulator: r.accumulator as unknown as ObjectiveAccumulator | null,
    rulesVersion: r.rules_version,
    stale: r.stale,
    version: r.version,
  };
}

/**
 * One course as the fold sees it, from its rows and the student's timezone. Topics in trail order
 * (archived ones left out, as trailTopics does); questions in stock order.
 */
export function courseView(rows: {
  topics: ReadonlyArray<Pick<Tables["topics"]["Row"], "id" | "review" | "sort_order" | "merged_into">>;
  objectives: ReadonlyArray<Pick<Tables["objectives"]["Row"], "id" | "topic_id" | "name" | "review" | "merged_into">>;
  questions: ReadonlyArray<Pick<Tables["questions"]["Row"], "id" | "topic_id" | "objective_id" | "tier" | "sort_order">>;
  timezone: string;
}): CourseView {
  const rowCatalogue: Record<string, ObjectiveInfo> = {};
  for (const o of rows.objectives) {
    rowCatalogue[o.id] = { id: o.id, topicId: o.topic_id, name: o.name, review: o.review as ObjectiveInfo["review"], ...(o.merged_into ? { mergedInto: o.merged_into } : {}) };
  }
  // Objectives under their topic's survivor, and each question under its objective's current topic,
  // not the rows' own topic_id (either can be stale when a job wrote while the student merged).
  const topicMergedInto = new Map(rows.topics.flatMap((t) => (t.merged_into ? [[t.id, t.merged_into] as const] : [])));
  const catalogue = withCurrentTopics(rowCatalogue, topicMergedInto);
  const bank = fileQuestions(
    [...rows.questions]
      .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))
      .map((q) => ({
        topicId: q.topic_id,
        question: { id: q.id, ...(q.objective_id ? { objectiveId: q.objective_id } : {}), ...(q.tier ? { tier: q.tier as QuestionRef["tier"] } : {}) } as QuestionRef,
      })),
    catalogue,
    topicMergedInto,
  );
  const topicIds = [...rows.topics]
    .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))
    .filter((t) => t.review !== "archived")
    .map((t) => t.id);
  return { attribution: attribution({ topicIds, bank, catalogue }), dayKey: dayKeyIn(rows.timezone) };
}
