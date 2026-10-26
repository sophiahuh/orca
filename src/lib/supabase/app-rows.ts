/**
 * The app's types ↔ database rows, for everything the store loads and saves (the evidence and
 * snapshot rows are in rows.ts). Pure (loads under plain Node), so the store, the e2e fixture and
 * the tests share one mapping.
 *
 * Optional fields absent in the app are null in the database and absent again when read back, so a
 * row round-trips to the same value. Rows for save_structure always name every column, so clearing
 * a field (an un-merge, a settled duplicate) writes the null.
 */
import { z } from "zod";
import { type AvatarId, isAvatar } from "../avatars.ts";
import type {
  AnswerRubric,
  CalendarEvent,
  Course,
  Exam,
  IslandVariant,
  Material,
  Objective,
  FeedbackReason,
  ObjectiveSignal,
  PipelineRun,
  QuestionRating,
  SessionProgress,
  QuizQuestion,
  QuizResult,
  Relation,
  ReviewConfig,
  Topic,
} from "../data.ts";
import { DEFAULT_CONFIG } from "../data.ts";
import type { EvidenceEvent } from "../mastery/types.ts";
import type { Database, Json } from "./database.types.ts";
import { type EvidenceRow, type SnapshotRow, eventFromRow } from "./rows.ts";

type Tables = Database["public"]["Tables"];
type Row<K extends keyof Tables> = Tables[K]["Row"];
/** A save_structure row: the table's columns without the owner, course and creation time, which the function sets. */
type StructureRow<K extends keyof Tables> = Omit<Row<K>, "owner_id" | "course_id" | "created_at">;

const json = (v: unknown) => v as Json;
/** For NOT NULL jsonb columns. */
const jsonValue = (v: object) => v as NonNullable<Json>;

/* ── Course settings (read and written whole; checked on both sides) ── */

const ReviewRowSchema = z.object({ duration: z.enum(["5 min", "10 min", "15 min", "30 min", "1 hour", "3 hours", "10 hours"]), cadence: z.enum(["Daily", "Weekly", "1 wk before exam"]) });
export const ReviewConfigSchema = z.object({ quick: ReviewRowSchema, deep: ReviewRowSchema, exam: ReviewRowSchema });

/** The profile's defaults for new courses, as written to `profiles`. */
export function defaultsToRow(config: ReviewConfig) {
  return { default_review_config: jsonValue(ReviewConfigSchema.parse(config)) };
}

/* ── Courses ── */

export function courseToRow(c: Course, config: ReviewConfig | null): Omit<Row<"courses">, "owner_id" | "created_at" | "weights"> {
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    short: c.short,
    variant: c.variant,
    pos_x: c.pos.x,
    pos_y: c.pos.y,
    trail: c.trail ?? null,
    review_config: config === null ? null : jsonValue(ReviewConfigSchema.parse(config)),
  };
}

/* ── Structure ── */

export function topicToRow(t: Topic, sortOrder: number): StructureRow<"topics"> {
  return {
    id: t.id,
    sort_order: sortOrder,
    name: t.name,
    review: t.review,
    merged_into: t.mergedInto ?? null,
    material_id: t.materialId ?? null,
    uncertain: json(t.uncertain ?? null),
    pos_x: t.pos.x,
    pos_y: t.pos.y,
    summary: t.summary ?? null,
    source: jsonValue(t.source ?? []),
  };
}

export function topicFromRow(r: Row<"topics">): Topic {
  return {
    id: r.id,
    name: r.name,
    review: r.review as Topic["review"],
    ...(r.merged_into !== null ? { mergedInto: r.merged_into } : {}),
    ...(r.material_id !== null ? { materialId: r.material_id } : {}),
    ...(r.uncertain !== null ? { uncertain: r.uncertain as unknown as NonNullable<Topic["uncertain"]> } : {}),
    pos: { x: r.pos_x, y: r.pos_y },
    ...(r.summary !== null ? { summary: r.summary } : {}),
    ...(Array.isArray(r.source) && r.source.length ? { source: r.source as unknown as NonNullable<Topic["source"]> } : {}),
  };
}

export function objectiveToRow(o: Objective): StructureRow<"objectives"> {
  return {
    id: o.id,
    topic_id: o.topicId,
    name: o.name,
    description: o.description,
    origin: o.origin,
    review: o.review,
    merged_into: o.mergedInto ?? null,
    material_id: o.materialId,
    run_id: o.runId,
    archived_with_topic: o.archivedWithTopic === true,
    uncertain: json(o.uncertain ?? null),
    signals: jsonValue(o.signals),
  };
}

export function objectiveFromRow(r: Row<"objectives">): Objective {
  return {
    id: r.id,
    topicId: r.topic_id,
    name: r.name,
    description: r.description,
    origin: r.origin as Objective["origin"],
    review: r.review as Objective["review"],
    ...(r.merged_into !== null ? { mergedInto: r.merged_into } : {}),
    materialId: r.material_id,
    runId: r.run_id,
    ...(r.archived_with_topic ? { archivedWithTopic: true as const } : {}),
    ...(r.uncertain !== null ? { uncertain: r.uncertain as unknown as NonNullable<Objective["uncertain"]> } : {}),
    signals: r.signals as unknown as ObjectiveSignal[],
  };
}

export function relationToRow(r: Relation): StructureRow<"relations"> {
  return { id: r.id, from_topic: r.from, to_topic: r.to, type: r.type, anchor: json(r.anchor), review: r.review, material_id: r.materialId, reason: r.reason };
}

export function relationFromRow(r: Row<"relations">): Relation {
  return {
    id: r.id,
    from: r.from_topic,
    to: r.to_topic,
    type: r.type as Relation["type"],
    anchor: r.anchor as unknown as Relation["anchor"],
    review: r.review as Relation["review"],
    materialId: r.material_id,
    reason: r.reason,
  };
}

export function questionToRow(q: QuizQuestion, topicId: string, sortOrder: number): StructureRow<"questions"> {
  return {
    id: q.id,
    topic_id: topicId,
    sort_order: sortOrder,
    objective_id: q.objectiveId ?? null,
    kind: q.kind,
    tier: q.tier ?? null,
    topic_name: q.topic,
    prompt: q.prompt,
    table: json(q.table ?? null),
    options: q.options,
    answer: q.answer,
    exact: q.exact ?? null,
    rubric: json(q.rubric ?? null),
    explanation: q.explanation,
    anchor: json(q.anchor ?? null),
    figure: json(q.figure ?? null),
    material_id: q.materialId ?? null,
    deep: q.deep ?? false,
  };
}

export function questionFromRow(r: Row<"questions">): QuizQuestion {
  return {
    id: r.id,
    kind: r.kind as QuizQuestion["kind"],
    ...(r.tier !== null ? { tier: r.tier as NonNullable<QuizQuestion["tier"]> } : {}),
    topic: r.topic_name,
    prompt: r.prompt,
    ...(r.table !== null ? { table: r.table as unknown as NonNullable<QuizQuestion["table"]> } : {}),
    options: r.options,
    answer: r.answer,
    ...(r.exact !== null ? { exact: r.exact } : {}),
    ...(r.rubric !== null ? { rubric: r.rubric as unknown as AnswerRubric } : {}),
    explanation: r.explanation,
    ...(r.anchor !== null ? { anchor: r.anchor as unknown as NonNullable<QuizQuestion["anchor"]> } : {}),
    ...(r.figure !== null ? { figure: r.figure as unknown as NonNullable<QuizQuestion["figure"]> } : {}),
    ...(r.material_id !== null ? { materialId: r.material_id } : {}),
    ...(r.objective_id !== null ? { objectiveId: r.objective_id } : {}),
    ...(r.deep ? { deep: true } : {}),
  };
}

/** A finished (or failed) run as the job saves it; its Trigger.dev job id, a top-up's request (objective_ids) and when it was claimed (started_at) are left as they are. */
export function runToRow(r: PipelineRun): Omit<StructureRow<"pipeline_runs">, "job_id" | "objective_ids" | "started_at" | "deep_minutes"> {
  return {
    id: r.id,
    material_id: r.materialId,
    kind: r.kind ?? "upload",
    at: r.at,
    model: r.model,
    status: r.status,
    progress: r.status === "done" || r.status === "failed" ? null : json(r.progress ?? null),
    error: r.status === "failed" ? (r.error ?? "The job failed without saying why.") : null,
    topics_created: r.topicsCreated,
    objectives_created: r.objectivesCreated,
    objectives_attached: r.objectivesAttached,
    questions_added: r.questionsAdded,
    question_ids: r.questionIds ?? [],
    dropped: jsonValue(r.dropped),
    hidden_text: r.hiddenText ? jsonValue(r.hiddenText) : null,
    security: r.security ? jsonValue(r.security) : null,
  };
}

export function runFromRow(r: Row<"pipeline_runs">): PipelineRun {
  return {
    id: r.id,
    kind: r.kind as NonNullable<PipelineRun["kind"]>,
    courseId: r.course_id,
    materialId: r.material_id,
    at: new Date(r.at).toISOString(),
    model: r.model,
    ...(r.deep_minutes !== null ? { deepMinutes: r.deep_minutes } : {}),
    status: r.status as PipelineRun["status"],
    ...(r.started_at !== null ? { startedAt: new Date(r.started_at).toISOString() } : {}),
    ...(r.progress !== null ? { progress: r.progress as unknown as NonNullable<PipelineRun["progress"]> } : {}),
    ...(r.error !== null ? { error: r.error } : {}),
    topicsCreated: r.topics_created,
    objectivesCreated: r.objectives_created,
    objectivesAttached: r.objectives_attached,
    questionsAdded: r.questions_added,
    ...(r.question_ids.length ? { questionIds: r.question_ids } : {}),
    dropped: r.dropped as unknown as PipelineRun["dropped"],
    ...(r.hidden_text !== null ? { hiddenText: r.hidden_text as unknown as NonNullable<PipelineRun["hiddenText"]> } : {}),
    ...(r.security !== null ? { security: r.security as unknown as NonNullable<PipelineRun["security"]> } : {}),
  };
}

/** One course's structure as the store holds it. */
export interface StructureState {
  topics: Topic[];
  objectives: Record<string, Objective>;
  /** topicId → questions, in stock order. */
  bank: Record<string, QuizQuestion[]>;
  relations: Relation[];
}

/** A save_structure row: a new row whole, or an existing one's id and the columns that changed. */
type SavedRow<K extends keyof Tables> = StructureRow<K> | (Partial<StructureRow<K>> & { id: string });

export interface StructureRows {
  /** Only the server's jobs save runs (students can't write them). */
  runs?: Omit<StructureRow<"pipeline_runs">, "job_id" | "objective_ids" | "started_at" | "deep_minutes">[];
  topics?: SavedRow<"topics">[];
  objectives?: SavedRow<"objectives">[];
  relations?: SavedRow<"relations">[];
  questions?: SavedRow<"questions">[];
}

/**
 * New rows whole; rows that existed only with the columns that changed (save_structure keeps a left-out
 * column's value), so a save never writes back a column it didn't change: a job adding an upload
 * and the student renaming a topic at the same moment both land.
 */
function changed<T extends { id: string }>(kind: string, before: readonly T[], after: readonly T[]): Array<T | (Partial<T> & { id: string })> {
  const old = new Map(before.map((r) => [r.id, r]));
  const now = new Set(after.map((r) => r.id));
  for (const id of old.keys()) {
    // Nothing is deleted (archive or merge); a row that vanished is a bug, not a save.
    if (!now.has(id)) throw new Error(`The ${kind} ${id} disappeared from the course; nothing is ever deleted`);
  }
  return after.flatMap((r) => {
    const was = old.get(r.id);
    if (!was) return [r];
    const diff = (Object.keys(r) as Array<keyof T>).filter((k) => JSON.stringify(r[k]) !== JSON.stringify(was[k]));
    return diff.length ? [{ id: r.id, ...Object.fromEntries(diff.map((k) => [k, r[k]])) } as Partial<T> & { id: string }] : [];
  });
}

const questionRows = (bank: StructureState["bank"]) => Object.entries(bank).flatMap(([topicId, qs]) => qs.map((q, i) => questionToRow(q, topicId, i)));

/**
 * The rows save_structure needs to turn `before` into `after` (only what changed), plus `runs`.
 * Topics and questions carry their position, so a reorder or a move between topics saves too.
 */
export function structureRows(before: StructureState, after: StructureState, runs: readonly PipelineRun[] = []): StructureRows {
  const out: StructureRows = {};
  const put = <K extends keyof StructureRows>(key: K, rows: NonNullable<StructureRows[K]>) => {
    if (rows.length) out[key] = rows;
  };
  put("runs", runs.map(runToRow));
  put("topics", changed("topic", before.topics.map(topicToRow), after.topics.map(topicToRow)));
  put("objectives", changed("objective", Object.values(before.objectives).map(objectiveToRow), Object.values(after.objectives).map(objectiveToRow)));
  put("relations", changed("relation", before.relations.map(relationToRow), after.relations.map(relationToRow)));
  put("questions", changed("question", questionRows(before.bank), questionRows(after.bank)));
  return out;
}

export function isEmpty(rows: StructureRows): boolean {
  return Object.keys(rows).length === 0;
}

/* ── Activity ── */

export function materialToRow(m: Material): Omit<Row<"materials">, "owner_id" | "created_at"> {
  return {
    id: m.id,
    course_id: m.courseId,
    filename: m.filename,
    type: m.type,
    assigned: m.assigned,
    due: m.due,
    reflect: m.reflect,
    reflection: json(m.reflection ?? null),
    // A material saved from the browser is a record without a file (a file Orca can't read yet).
    // Uploaded PDFs are inserted by POST /api/materials and read on the server.
    storage_path: null,
    content_hash: null,
    size_bytes: null,
    mime: null,
    handwritten: false,
    status: "ready",
    error: null,
    hidden_text: null,
    reading_since: null,
  };
}

/**
 * The columns a student may insert (the rest are the server's): a material added from the browser
 * is a record without a file, which the database marks ready.
 */
export function materialInsertRow(m: Material) {
  const { id, course_id, filename, type, assigned, due, reflect, reflection } = materialToRow(m);
  return { id, course_id, filename, type, assigned, due, reflect, reflection };
}

export function materialFromRow(r: Row<"materials">): Material {
  return {
    id: r.id,
    courseId: r.course_id,
    filename: r.filename,
    type: r.type as Material["type"],
    assigned: r.assigned,
    due: r.due,
    reflect: r.reflect,
    ...(r.reflection !== null ? { reflection: r.reflection as unknown as NonNullable<Material["reflection"]> } : {}),
    ...(r.hidden_text !== null ? { hiddenText: r.hidden_text as unknown as NonNullable<Material["hiddenText"]> } : {}),
  };
}

export function sessionToRow(r: Omit<QuizResult, "finishedAt">): Omit<Row<"session_results">, "id" | "owner_id" | "finished_at"> {
  return { course_id: r.courseId, topic_id: r.topicId, mode: r.mode, session_id: r.sessionId, correct: r.correct, total: r.total, seconds: r.seconds };
}

export function sessionFromRow(r: Row<"session_results">): QuizResult {
  return {
    courseId: r.course_id,
    topicId: r.topic_id,
    mode: r.mode as QuizResult["mode"],
    sessionId: r.session_id,
    correct: r.correct,
    total: r.total,
    seconds: r.seconds,
    finishedAt: new Date(r.finished_at).toISOString(),
  };
}

export function calendarToRow(e: CalendarEvent, materialId: string | null): Omit<Row<"calendar_events">, "owner_id" | "created_at"> {
  return { id: e.id, date: e.date, kind: e.kind, title: e.title, course_id: e.courseId ?? null, material_id: materialId };
}

export function calendarFromRow(r: Row<"calendar_events">): CalendarEvent {
  return { id: r.id, date: r.date, kind: r.kind as CalendarEvent["kind"], title: r.title, ...(r.course_id !== null ? { courseId: r.course_id } : {}) };
}

export function examToRow(e: Exam): Omit<Row<"exams">, "owner_id" | "created_at"> {
  return { id: e.id, course_id: e.courseId, title: e.title, date: e.date, topic_ids: e.topicIds };
}

export function examFromRow(r: Row<"exams">): Exam {
  return { id: r.id, courseId: r.course_id, title: r.title, date: r.date, topicIds: r.topic_ids };
}

/* ── Everything at once (public.my_data()) ── */

/** What `my_data()` returns: the profile and every row the student owns. */
export interface MyData {
  profile: Row<"profiles"> | null;
  courses: Row<"courses">[];
  materials: Row<"materials">[];
  runs: Row<"pipeline_runs">[];
  topics: Row<"topics">[];
  objectives: Row<"objectives">[];
  relations: Row<"relations">[];
  questions: Row<"questions">[];
  sessions: Row<"session_results">[];
  calendar: Row<"calendar_events">[];
  exams: Row<"exams">[];
  /** Older databases (before the feedback migration) don't send it. */
  question_feedback?: Row<"question_feedback">[];
  session_progress?: Row<"session_progress">[];
  evidence: EvidenceRow[];
  snapshots: SnapshotRow[];
}

export interface LoadedState {
  timezone: string;
  onboarded: boolean;
  avatar: AvatarId;
  name: string | null;
  /** Settings' defaults for new courses; null = Orca's built-in ones. */
  defaultConfig: ReviewConfig | null;
  courses: Course[];
  configs: Record<string, ReviewConfig>;
  configOverrides: Record<string, ReviewConfig | null>;
  objectives: Record<string, Record<string, Objective>>;
  questionBank: Record<string, Record<string, QuizQuestion[]>>;
  relations: Record<string, Relation[]>;
  runs: PipelineRun[];
  materials: Material[];
  results: QuizResult[];
  events: CalendarEvent[];
  exams: Exam[];
  /** questionId → the student's rating of it. */
  feedback: Record<string, QuestionRating>;
  /** `${courseId}:${kind}` → an unfinished session. */
  progress: Record<string, SessionProgress>;
  evidence: EvidenceEvent[];
  snapshots: SnapshotRow[];
}

/** The store's state from `my_data()`. Throws on a row it can't read rather than showing something else. */
export function loadedState(d: MyData): LoadedState {
  if (!d.profile) throw new Error("Your profile is missing");
  const courses: Course[] = d.courses.map((c) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    short: c.short,
    variant: c.variant as IslandVariant,
    pos: { x: c.pos_x, y: c.pos_y },
    topics: d.topics
      .filter((t) => t.course_id === c.id)
      .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))
      .map(topicFromRow),
    ...(c.trail !== null ? { trail: c.trail } : {}),
  }));
  const byCourse = <T>(make: () => T) => Object.fromEntries(courses.map((c) => [c.id, make()])) as Record<string, T>;
  const objectives = byCourse<Record<string, Objective>>(() => ({}));
  for (const o of d.objectives) objectives[o.course_id][o.id] = objectiveFromRow(o);
  const questionBank = byCourse<Record<string, QuizQuestion[]>>(() => ({}));
  for (const q of [...d.questions].sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))) {
    (questionBank[q.course_id][q.topic_id] ??= []).push(questionFromRow(q));
  }
  const relations = byCourse<Relation[]>(() => []);
  for (const r of d.relations) relations[r.course_id].push(relationFromRow(r));
  if (!isAvatar(d.profile.avatar)) throw new Error(`Your profile's avatar "${d.profile.avatar}" isn't one Orca knows`);
  const defaultConfig = d.profile.default_review_config === null ? null : ReviewConfigSchema.parse(d.profile.default_review_config);
  const configOverrides = Object.fromEntries(d.courses.map((c) => [c.id, c.review_config === null ? null : ReviewConfigSchema.parse(c.review_config)]));
  return {
    timezone: d.profile.timezone,
    onboarded: d.profile.onboarded,
    avatar: d.profile.avatar,
    name: d.profile.name,
    defaultConfig,
    courses,
    configs: Object.fromEntries(d.courses.map((c) => [c.id, configOverrides[c.id] ?? defaultConfig ?? DEFAULT_CONFIG])),
    configOverrides,
    objectives,
    questionBank,
    relations,
    runs: d.runs.map(runFromRow),
    // An upload still on its way (or one whose file couldn't be read) isn't part of the course yet.
    materials: d.materials.filter((m) => m.status === "ready").map(materialFromRow),
    results: d.sessions.map(sessionFromRow),
    events: d.calendar.map(calendarFromRow),
    exams: d.exams.map(examFromRow),
    feedback: Object.fromEntries((d.question_feedback ?? []).map((r) => [r.question_id, { courseId: r.course_id, rating: r.rating as QuestionRating["rating"], reason: (r.reason as FeedbackReason | null) ?? null, note: r.note ?? null }])),
    progress: Object.fromEntries((d.session_progress ?? []).map((r) => [progressKey(r.course_id, r.kind as SessionProgress["kind"]), progressFromRow(r)])),
    evidence: d.evidence.map(eventFromRow),
    snapshots: d.snapshots,
  };
}

/** Where a course's unfinished session of one kind is kept. */
export function progressKey(courseId: string, kind: SessionProgress["kind"]): string {
  return `${courseId}:${kind}`;
}

export function progressFromRow(r: Row<"session_progress">): SessionProgress {
  return {
    courseId: r.course_id,
    kind: r.kind as SessionProgress["kind"],
    sessionId: r.session_id,
    items: r.items as unknown as SessionProgress["items"],
    position: r.position,
    correct: r.correct,
    skipped: r.skipped,
    ungraded: r.ungraded,
    missed: r.missed,
    seconds: r.seconds,
    title: r.title,
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

export function progressToRow(p: SessionProgress) {
  return {
    course_id: p.courseId,
    kind: p.kind,
    session_id: p.sessionId,
    items: p.items as unknown as NonNullable<Json>,
    position: p.position,
    correct: p.correct,
    skipped: p.skipped,
    ungraded: p.ungraded,
    missed: p.missed,
    seconds: p.seconds,
    title: p.title.slice(0, 200),
    updated_at: p.updatedAt,
  };
}
