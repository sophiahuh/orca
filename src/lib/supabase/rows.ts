/**
 * Database rows ↔ the mastery code's types, for evidence, snapshots and the structure the fold
 * reads. Pure (loads under plain Node), so the server and the HTTP check script share it.
 */
import { attribution } from "../mastery/attribution.ts";
import { type QuestionRef, fileQuestions, withCurrentTopics } from "../mastery/catalogue.ts";
import { type ObjectiveAccumulator, dayKeyIn } from "../mastery/objective-state.ts";
import type { CourseView, Snapshot } from "../mastery/snapshots.ts";
import type { AnswerEvent, EvidenceEvent, FlagSource, ObjectiveInfo, SignalEvent, WorkEvent } from "../mastery/types.ts";
import type { Database } from "./database.types.ts";

type Tables = Database["public"]["Tables"];
export type EvidenceRow = Tables["evidence_events"]["Row"];
export type SnapshotRow = Tables["objective_state"]["Row"];

/** An evidence row as the fold reads it. `at` is normalised to the ISO form the server stamps. */
export function eventFromRow(r: EvidenceRow): EvidenceEvent {
  const base = { id: r.id, at: new Date(r.at).toISOString(), courseId: r.course_id, topicId: r.topic_id, objectiveId: r.objective_id };
  if (r.kind === "confusion") {
    if (r.flag_source === null) throw new Error(`Confusion event ${r.id} has no flag source`);
    // The table's CHECK constraints hold flag_source to FlagSource's values and its material and page to what the source needs.
    return { ...base, kind: "confusion", materialId: r.material_id, note: r.note, flagSource: r.flag_source as FlagSource, page: r.page };
  }
  // What Claude reported with an answer or a piece of work (the CHECK constraints hold them to the types' values).
  const reported = {
    ...(r.help !== null ? { help: r.help as WorkEvent["help"] } : {}),
    ...(r.confidence !== null ? { confidence: r.confidence as NonNullable<WorkEvent["confidence"]> } : {}),
    ...(r.error_type !== null ? { errorType: r.error_type as WorkEvent["errorType"] } : {}),
  };
  if (r.kind === "work") {
    if (r.problem === null || r.basis === null || r.outcome === null || r.session_id === null) throw new Error(`Work event ${r.id} is missing a field`);
    return {
      ...base,
      kind: "work",
      problem: r.problem,
      ...(r.note !== null ? { response: r.note } : {}),
      basis: r.basis as WorkEvent["basis"],
      outcome: r.outcome as WorkEvent["outcome"],
      source: "connector",
      sessionId: r.session_id,
      ...reported,
    };
  }
  if (r.kind === "signal") {
    if (r.signal === null || r.session_id === null) throw new Error(`Signal event ${r.id} is missing a field`);
    return { ...base, kind: "signal", signal: r.signal as SignalEvent["signal"], note: r.note, source: "connector", sessionId: r.session_id };
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
    ...(r.note !== null ? { response: r.note } : {}),
    ...reported,
  };
}

/** An event as an evidence_events row (owner_id is set by record_evidence from the verified user). */
export function eventToRow(e: EvidenceEvent): Omit<EvidenceRow, "owner_id"> {
  const common = { id: e.id, kind: e.kind, at: e.at, course_id: e.courseId, topic_id: e.topicId, objective_id: e.objectiveId };
  // Every column null unless the kind fills it.
  const empty = { question_id: null, tier: null, outcome: null, grader: null, source: null, session_id: null, material_id: null, note: null, flag_source: null, page: null, help: null, confidence: null, error_type: null, problem: null, basis: null, signal: null };
  switch (e.kind) {
    case "answer":
      return { ...common, ...empty, question_id: e.questionId, tier: e.tier, outcome: e.outcome, grader: e.grader, source: e.source, session_id: e.sessionId, note: e.response ?? null, help: e.help ?? null, confidence: e.confidence ?? null, error_type: e.errorType ?? null };
    case "confusion":
      return { ...common, ...empty, material_id: e.materialId, note: e.note, flag_source: e.flagSource, page: e.page };
    case "work":
      return { ...common, ...empty, problem: e.problem, note: e.response ?? null, basis: e.basis, outcome: e.outcome, source: e.source, session_id: e.sessionId, help: e.help ?? null, confidence: e.confidence ?? null, error_type: e.errorType ?? null };
    case "signal":
      return { ...common, ...empty, signal: e.signal, note: e.note, source: e.source, session_id: e.sessionId };
  }
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
  questions: ReadonlyArray<Pick<Tables["questions"]["Row"], "id" | "objective_id" | "tier" | "sort_order">>;
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
      .map((q): QuestionRef => ({ id: q.id, objectiveId: q.objective_id, ...(q.tier ? { tier: q.tier as QuestionRef["tier"] } : {}) })),
    catalogue,
    topicMergedInto,
  );
  const topicIds = [...rows.topics]
    .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))
    .filter((t) => t.review !== "archived")
    .map((t) => t.id);
  return { attribution: attribution({ topicIds, bank, catalogue }), dayKey: dayKeyIn(rows.timezone) };
}
