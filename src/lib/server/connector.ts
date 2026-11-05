/**
 * The Claude connector against Supabase: the student's secret link (one per account, only its hash
 * stored) and the four tools in `src/lib/connector/mcp.ts` read and written with the service-role
 * client, every query scoped to that student.
 */
import { createHash, randomBytes } from "node:crypto";
import type { ConnectorTools, CourseState, ExamLine, ObjectiveLine, QuestionLine, RecordedAnswer } from "@/lib/connector/mcp";
import { dayKeyIn, stateAt } from "@/lib/mastery/objective-state";
import { NewerRulesError, VersionConflictError, readCourseState, recordEvent } from "@/lib/mastery/snapshots";
import type { AnswerEvent, ObjectiveStatus } from "@/lib/mastery/types";
import { RecordError, supabaseSnapshotStore } from "@/lib/server/snapshot-store";
import { questionFromRow } from "@/lib/supabase/app-rows";
import type { OrcaSupabase } from "@/lib/supabase/server";

/* ── The link ── */

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/** Mint the student's connector token (replacing any earlier one) and return it, once. */
export async function createConnectorToken(db: OrcaSupabase, ownerId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const { error } = await db.from("connector_tokens").upsert({ owner_id: ownerId, token_hash: hash(token), created_at: new Date().toISOString(), last_used_at: null });
  if (error) throw new Error(`Couldn't save the connector token: ${error.message}`);
  return token;
}

export async function revokeConnectorToken(db: OrcaSupabase, ownerId: string): Promise<void> {
  const { error } = await db.from("connector_tokens").delete().eq("owner_id", ownerId);
  if (error) throw new Error(`Couldn't revoke the connector token: ${error.message}`);
}

export async function connectorStatus(db: OrcaSupabase, ownerId: string): Promise<{ connected: boolean; createdAt: string | null; lastUsedAt: string | null }> {
  const { data, error } = await db.from("connector_tokens").select("created_at, last_used_at").eq("owner_id", ownerId).maybeSingle();
  if (error) throw new Error(`Couldn't read the connector: ${error.message}`);
  return { connected: data !== null, createdAt: data?.created_at ?? null, lastUsedAt: data?.last_used_at ?? null };
}

/** The student a token belongs to, or null. Notes the use. */
export async function studentForToken(db: OrcaSupabase, token: string): Promise<{ id: string } | null> {
  if (!/^[A-Za-z0-9_-]{40,50}$/.test(token)) return null;
  const { data, error } = await db.from("connector_tokens").select("owner_id").eq("token_hash", hash(token)).maybeSingle();
  if (error) throw new Error(`Couldn't check the connector token: ${error.message}`);
  if (!data) return null;
  await db.from("connector_tokens").update({ last_used_at: new Date().toISOString() }).eq("owner_id", data.owner_id);
  return { id: data.owner_id };
}

/* ── The tools ── */

const DUE_ORDER: Record<ObjectiveStatus, number> = { fading: 0, "mixed-up": 1, learning: 2, "check-due": 3, unseen: 4, verified: 5, mastered: 6, retired: 7 };
const DUE_STATUSES: ReadonlySet<ObjectiveStatus> = new Set(["fading", "mixed-up", "learning", "unseen"]);
const DUE_LIMIT = 20;

export function connectorTools(db: OrcaSupabase, ownerId: string, now: () => Date = () => new Date()): ConnectorTools {
  const owns = async (courseId: string) => {
    const { data, error } = await db.from("courses").select("id, name").eq("owner_id", ownerId).eq("id", courseId).maybeSingle();
    if (error) throw new Error(`Couldn't read the course: ${error.message}`);
    return data;
  };

  const courseState = async (courseId: string): Promise<CourseState | null> => {
    const course = await owns(courseId);
    if (!course) return null;
    const [topics, objectives, questions, exams, materials, profile, snapshots] = await Promise.all([
      db.from("topics").select("id, name, review, merged_into, sort_order").eq("owner_id", ownerId).eq("course_id", courseId),
      db.from("objectives").select("id, topic_id, name, review, merged_into, material_id").eq("owner_id", ownerId).eq("course_id", courseId),
      db.from("questions").select("objective_id").eq("owner_id", ownerId).eq("course_id", courseId),
      db.from("exams").select("id, title, date, topic_ids").eq("owner_id", ownerId).eq("course_id", courseId).order("date"),
      db.from("materials").select("id, upcoming").eq("owner_id", ownerId).eq("course_id", courseId),
      db.from("profiles").select("timezone").eq("owner_id", ownerId).maybeSingle(),
      readCourseState(supabaseSnapshotStore(db, ownerId, courseId)),
    ]);
    for (const r of [topics, objectives, questions, exams, materials, profile]) if (r.error) throw new Error(`Couldn't read the course: ${r.error.message}`);

    const at = now();
    const topicById = new Map((topics.data ?? []).map((t) => [t.id, t]));
    const survivor = (topicId: string) => {
      let t = topicById.get(topicId);
      for (let i = 0; t?.merged_into && i < 20; i++) t = topicById.get(t.merged_into);
      return t ?? topicById.get(topicId);
    };
    const liveTopics = (topics.data ?? [])
      .filter((t) => t.review !== "archived" && !t.merged_into)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((t) => ({ id: t.id, name: t.name }));
    const questionCount = new Map<string, number>();
    for (const q of questions.data ?? []) if (q.objective_id) questionCount.set(q.objective_id, (questionCount.get(q.objective_id) ?? 0) + 1);
    const upcoming = new Set((materials.data ?? []).filter((m) => m.upcoming).map((m) => m.id));
    const stateOf = new Map(snapshots.objectives.map((s) => [s.objectiveId, stateAt(s.objectiveId, s.accumulator, at)]));

    const lines: ObjectiveLine[] = [];
    for (const o of objectives.data ?? []) {
      if (o.review === "archived" || o.merged_into) continue;
      const topic = survivor(o.topic_id);
      if (!topic || topic.review === "archived") continue;
      const state = stateOf.get(o.id);
      lines.push({
        id: o.id,
        topicId: topic.id,
        topic: topic.name,
        name: o.name,
        status: state?.status ?? "unseen",
        recall: state?.recall ?? null,
        questions: questionCount.get(o.id) ?? 0,
        upcoming: o.material_id !== null && upcoming.has(o.material_id),
      });
    }
    const dueNow = lines
      .filter((l) => l.questions > 0 && !l.upcoming && DUE_STATUSES.has(l.status as ObjectiveStatus))
      .sort((a, b) => DUE_ORDER[a.status as ObjectiveStatus] - DUE_ORDER[b.status as ObjectiveStatus] || (a.recall ?? 1) - (b.recall ?? 1))
      .slice(0, DUE_LIMIT)
      .map((l) => l.id);

    return {
      course: { id: course.id, name: course.name },
      today: dayKeyIn(profile.data?.timezone ?? "UTC")(at.toISOString()),
      exams: (exams.data ?? []).map((e) => ({ id: e.id, title: e.title, date: e.date, topicIds: e.topic_ids })),
      topics: liveTopics,
      objectives: lines,
      dueNow,
    };
  };

  return {
    async courses() {
      const { data, error } = await db.from("courses").select("id, name").eq("owner_id", ownerId).order("created_at");
      if (error) throw new Error(`Couldn't read the courses: ${error.message}`);
      return data.map((c) => ({ id: c.id, name: c.name }));
    },

    courseState,

    async questionsFor(courseId, objectiveIds, limit): Promise<QuestionLine[] | null> {
      const state = await courseState(courseId);
      if (!state) return null;
      const wanted = objectiveIds ?? state.dueNow;
      if (wanted.length === 0) return [];
      const { data, error } = await db.from("questions").select("*").eq("owner_id", ownerId).eq("course_id", courseId).in("objective_id", wanted).order("sort_order");
      if (error) throw new Error(`Couldn't read the questions: ${error.message}`);
      // Spread across the objectives asked for, in the order they were asked for.
      const byObjective = new Map<string, QuestionLine[]>();
      for (const row of data) {
        if (!row.objective_id) continue;
        const q = questionFromRow(row);
        const line: QuestionLine = {
          id: q.id,
          objectiveId: row.objective_id,
          kind: q.kind,
          prompt: q.figure ? `${q.prompt} [This question comes with a figure Orca can't show here; skip it if it needs one.]` : q.prompt,
          options: q.options,
          answer: q.answer,
          ...(q.exact ? { exact: q.exact } : {}),
          ...(q.rubric ? { rubric: q.rubric } : {}),
          explanation: q.explanation,
          ...(q.anchor ? { anchor: q.anchor } : {}),
        };
        (byObjective.get(row.objective_id) ?? byObjective.set(row.objective_id, []).get(row.objective_id)!).push(line);
      }
      const out: QuestionLine[] = [];
      for (let round = 0; out.length < limit; round++) {
        let added = false;
        for (const id of wanted) {
          const q = byObjective.get(id)?.[round];
          if (q && out.length < limit) {
            out.push(q);
            added = true;
          }
        }
        if (!added) break;
      }
      return out;
    },

    async recordAnswer(courseId, questionId, outcome, sessionId): Promise<RecordedAnswer | { error: string }> {
      if (!(await owns(courseId))) return { error: "No such course." };
      const { data: q, error } = await db.from("questions").select("objective_id, tier").eq("owner_id", ownerId).eq("course_id", courseId).eq("id", questionId).maybeSingle();
      if (error) throw new Error(`Couldn't read the question: ${error.message}`);
      if (!q || !q.objective_id) return { error: "No such question in this course; use an id from questions_for." };
      const { data: objective, error: objectiveError } = await db.from("objectives").select("topic_id").eq("owner_id", ownerId).eq("course_id", courseId).eq("id", q.objective_id).maybeSingle();
      if (objectiveError) throw new Error(`Couldn't read the question's objective: ${objectiveError.message}`);
      if (!objective) return { error: "That question's objective is no longer in the course." };
      const at = now();
      const event: AnswerEvent = {
        kind: "answer",
        id: crypto.randomUUID(),
        at: at.toISOString(),
        courseId,
        topicId: objective.topic_id,
        objectiveId: q.objective_id,
        questionId,
        tier: q.tier as AnswerEvent["tier"],
        outcome,
        // Claude graded it, not Orca's own grader: self-marked (half credit, never clears a mix-up).
        grader: "self",
        source: "connector",
        sessionId,
      };
      try {
        const r = await recordEvent(supabaseSnapshotStore(db, ownerId, courseId), event);
        const status = r.objectiveId && r.accumulator ? stateAt(r.objectiveId, r.accumulator, at).status : "unseen";
        return { recorded: true, objectiveId: r.objectiveId ?? q.objective_id, status, ...(r.objectiveId === null ? { note: "Recorded, but this question's objective isn't live, so it counts for nothing." } : {}) };
      } catch (e) {
        if (e instanceof VersionConflictError) return { error: "Another answer was being saved at the same moment; this one wasn't recorded. Try again." };
        if (e instanceof NewerRulesError) return { error: "Orca is being updated; the answer wasn't recorded. Try again in a moment." };
        if (e instanceof RecordError) return { error: `Orca couldn't record the answer: ${e.message}` };
        throw e;
      }
    },

    async setExam(courseId, exam): Promise<ExamLine | { error: string }> {
      if (!(await owns(courseId))) return { error: "No such course." };
      const { data: topics, error: topicsError } = await db.from("topics").select("id").eq("owner_id", ownerId).eq("course_id", courseId).in("id", exam.topicIds.length ? exam.topicIds : ["00000000-0000-0000-0000-000000000000"]);
      if (topicsError) throw new Error(`Couldn't read the topics: ${topicsError.message}`);
      const known = new Set((topics ?? []).map((t) => t.id));
      const unknown = exam.topicIds.filter((id) => !known.has(id));
      if (unknown.length) return { error: `These aren't topic ids in this course: ${unknown.join(", ")}. Use ids from course_state.` };
      const row = { id: exam.id ?? crypto.randomUUID(), owner_id: ownerId, course_id: courseId, title: exam.title, date: exam.date, topic_ids: exam.topicIds };
      if (exam.id) {
        const { data: existing, error } = await db.from("exams").select("id").eq("owner_id", ownerId).eq("course_id", courseId).eq("id", exam.id).maybeSingle();
        if (error) throw new Error(`Couldn't read the exam: ${error.message}`);
        if (!existing) return { error: "No such exam in this course; use an id from course_state, or omit examId to add one." };
      }
      const { error } = await db.from("exams").upsert(row);
      if (error) throw new Error(`Couldn't save the exam: ${error.message}`);
      return { id: row.id, title: row.title, date: row.date, topicIds: row.topic_ids };
    },
  };
}
