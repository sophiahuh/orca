/**
 * The Claude connector against Supabase: the student's secret link (one per account, only its hash
 * stored) and the five tools in `src/lib/connector/mcp.ts` read and written with the service-role
 * client, every query scoped to that student.
 */
import { createHash, randomBytes } from "node:crypto";
import type { AnswerKey, AnswerReport, CheckedAnswer, ConnectorTools, CourseMode, CourseState, ExamLine, FlagCheckResult, NextQuestions, ObjectiveLine, QuestionLine, RecordedAnswer, SelfGradeNeeded, TopicLine, VaultLine, WritingLine } from "@/lib/connector/mcp";
import { addMaterial } from "@/lib/server/connector/add-material";
import { addQuestions } from "@/lib/server/connector/add-questions";
import { logEvidence } from "@/lib/server/connector/log-evidence";
import { materialFor } from "@/lib/server/connector/material-for";
import type { ExamScope, MaterialType } from "@/lib/data";
import { AGENDA_RULES } from "@/lib/mastery/agenda";
import { dayStartIn } from "@/lib/jobs/budget";
import { startFlagTopUpJob } from "@/lib/server/jobs/start";
import { rateLimit } from "@/lib/server/rate-limit";
import type { QuizQuestion } from "@/lib/data";
import { cleanAnswer, gradeExact, normaliseExact } from "@/lib/grading";
import { gradeAnswer } from "@/lib/server/grade";
import { dayKeyIn, stateAt } from "@/lib/mastery/objective-state";
import { NewerRulesError, VersionConflictError, readCourseState, recordEvent } from "@/lib/mastery/snapshots";
import type { AnswerEvent, ConfusionEvent, ObjectiveStatus } from "@/lib/mastery/types";
import { topUpAfterFlag } from "@/lib/server/flag-top-up";
import { recordSecurityEvents } from "@/lib/server/security";
import { checkBudget } from "@/lib/server/usage";
import { RecordError, supabaseSnapshotStore } from "@/lib/server/snapshot-store";
import { questionFromRow } from "@/lib/supabase/app-rows";
import type { Json } from "@/lib/supabase/database.types";
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
// Weak points first: only objectives in rotation and open checks come due (the agenda's DUE_TODAY).
const DUE_STATUSES: ReadonlySet<ObjectiveStatus> = new Set(["fading", "mixed-up", "learning", "check-due"]);
const DUE_LIMIT = 20;

/** The mode an exam puts the course in: day-of today, exam-week while cramming or within the agenda's exam window, else normal. */
function examMode(exam: { date: string; cramming: boolean }, today: string, weekOut: string): CourseMode {
  if (exam.date === today) return "day-of";
  if (exam.cramming || (exam.date > today && exam.date <= weekOut)) return "exam-week";
  return "normal";
}
const MODE_ORDER: Record<CourseMode, number> = { normal: 0, "exam-week": 1, "day-of": 2 };

/** The key Claude teaches from once an answer is checked. */
function keyOf(q: QuizQuestion): AnswerKey {
  if (q.kind !== "Short answer") return { answer: q.options[q.answer] ?? "", explanation: q.explanation };
  if (q.exact?.length) return { answer: q.exact[0], exact: q.exact, explanation: q.explanation };
  if (q.rubric) return { answer: q.rubric.requiredIdeas.join("; "), rubric: q.rubric, explanation: q.explanation };
  return { answer: "", explanation: q.explanation };
}

/** Which option the student chose: its number as shown (1-based), its letter (A, B, …), or its text; null when none fits. */
export function pickOption(response: string, options: readonly string[]): number | null {
  const t = response.trim().replace(/[.)]+$/, "").trim();
  if (/^\d{1,2}$/.test(t)) {
    const n = Number(t);
    return n >= 1 && n <= options.length ? n - 1 : null;
  }
  if (/^[A-Za-z]$/.test(t)) {
    const i = t.toUpperCase().charCodeAt(0) - 65;
    if (i >= 0 && i < options.length) return i;
  }
  const want = normaliseExact(t);
  const exact = options.findIndex((o) => normaliseExact(o) === want);
  if (exact >= 0) return exact;
  // The option's text inside a longer answer ("I'd say XOR"), when only one option fits.
  const within = options.map((o, i) => (normaliseExact(o).length >= 2 && want.includes(normaliseExact(o)) ? i : -1)).filter((i) => i >= 0);
  return within.length === 1 ? within[0] : null;
}

/**
 * Orca's own result for the student's words against a stored key it can check itself: a choice
 * question (the option as check_answer reads it) or an exact answer. Null when Orca can't tell
 * (a prose question, or no option fits the words), so the outcome Claude stated stands.
 */
export function orcaOutcome(q: QuizQuestion, response: string): AnswerEvent["outcome"] | null {
  if (q.kind !== "Short answer") {
    const picked = pickOption(response, q.options);
    return picked === null ? null : picked === q.answer ? "correct" : "incorrect";
  }
  if (q.exact?.length) return gradeExact(response, q.exact).outcome;
  return null;
}

export function connectorTools(db: OrcaSupabase, ownerId: string, now: () => Date = () => new Date()): ConnectorTools {
  const owns = async (courseId: string) => {
    const { data, error } = await db.from("courses").select("id, name").eq("owner_id", ownerId).eq("id", courseId).is("deleted_at", null).maybeSingle();
    if (error) throw new Error(`Couldn't read the course: ${error.message}`);
    return data;
  };

  const courseState = async (courseId: string, options: { detail?: "summary" | "full"; topicIds?: string[] } = {}): Promise<CourseState | null> => {
    const course = await owns(courseId);
    if (!course) return null;
    const [topics, objectives, questions, exams, profile, snapshots, feedback, runs, budget, vault] = await Promise.all([
      db.from("topics").select("id, name, review, merged_into, sort_order").eq("owner_id", ownerId).eq("course_id", courseId),
      db.from("objectives").select("id, topic_id, name, review, merged_into").eq("owner_id", ownerId).eq("course_id", courseId),
      db.from("questions").select("id, objective_id, deep").eq("owner_id", ownerId).eq("course_id", courseId),
      db.from("exams").select("id, title, date, topic_ids, cramming, scope").eq("owner_id", ownerId).eq("course_id", courseId).order("date"),
      db.from("profiles").select("timezone").eq("owner_id", ownerId).maybeSingle(),
      readCourseState(supabaseSnapshotStore(db, ownerId, courseId)),
      db.from("question_feedback").select("question_id").eq("owner_id", ownerId).eq("rating", "down"),
      db.from("pipeline_runs").select("id, status, objective_ids").eq("owner_id", ownerId).eq("course_id", courseId).eq("kind", "top-up").in("status", ["queued", "waiting", "running"]).order("at"),
      checkBudget(db, ownerId, 0),
      // Held-back materials (every non-removed one): listed by name only, never opened.
      db.from("materials").select("id, filename, type").eq("owner_id", ownerId).eq("course_id", courseId).neq("status", "removed").eq("held_back", true).order("created_at"),
    ]);
    for (const r of [topics, objectives, questions, exams, profile, feedback, runs, vault]) if (r.error) throw new Error(`Couldn't read the course: ${r.error.message}`);

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
    // Askable questions only: not dive-only, not thumbed down (what a quick review, and next_questions, can ask).
    const down = new Set((feedback.data ?? []).map((f) => f.question_id));
    const questionCount = new Map<string, number>();
    for (const q of questions.data ?? []) if (q.objective_id && !q.deep && !down.has(q.id)) questionCount.set(q.objective_id, (questionCount.get(q.objective_id) ?? 0) + 1);
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
      });
    }
    const dueNow = lines
      .filter((l) => l.questions > 0 && DUE_STATUSES.has(l.status as ObjectiveStatus))
      .sort((a, b) => DUE_ORDER[a.status as ObjectiveStatus] - DUE_ORDER[b.status as ObjectiveStatus] || (a.recall ?? 1) - (b.recall ?? 1))
      .slice(0, DUE_LIMIT)
      .map((l) => l.id);

    const timezone = profile.data?.timezone ?? "UTC";
    const today = dayKeyIn(timezone)(at.toISOString());
    const weekOut = new Date(at.getTime() + AGENDA_RULES.examWindowDays * 86_400_000).toISOString().slice(0, 10);
    // The exams table holds scope to an object (or null); its shape is the app's ExamScope.
    const examLines: ExamLine[] = (exams.data ?? []).map((e) => ({ id: e.id, title: e.title, date: e.date, topicIds: e.topic_ids, cramming: e.cramming, scope: e.scope as unknown as ExamScope | null, mode: examMode(e, today, weekOut) }));
    // The next week's exams' topics; an exam that names none covers every topic.
    const examFocus = [...new Set(examLines.filter((e) => e.date >= today && e.date <= weekOut).flatMap((e) => (e.topicIds.length ? e.topicIds : liveTopics.map((t) => t.id))))];
    const mode = examLines.reduce<CourseMode>((m, e) => (MODE_ORDER[e.mode] > MODE_ORDER[m] ? e.mode : m), "normal");
    const cramming = examLines.find((e) => e.cramming)?.id ?? null;
    const vaultLines: VaultLine[] = (vault.data ?? []).map((m) => ({ materialId: m.id, filename: m.filename, type: m.type as MaterialType }));
    const topicLines: TopicLine[] = liveTopics.map((t) => {
      const mine = lines.filter((l) => l.topicId === t.id);
      return { id: t.id, name: t.name, objectives: mine.length, weak: mine.filter((l) => DUE_STATUSES.has(l.status as ObjectiveStatus)).length, askable: mine.filter((l) => l.questions > 0).length };
    });
    const shown = options.topicIds ? new Set(options.topicIds) : null;
    const writing: WritingLine[] = (runs.data ?? []).map((r) => ({ runId: r.id, objectiveIds: r.objective_ids, state: r.status as WritingLine["state"] }));
    // The budget resets at the student's next local midnight (src/lib/jobs/budget.ts counts their day).
    const resetsAt = new Date(dayStartIn(timezone, at).getTime() + 86_400_000).toISOString();

    return {
      course: { id: course.id, name: course.name },
      today,
      exams: examLines,
      topics: topicLines,
      ...(options.detail === "summary" ? {} : { objectives: shown ? lines.filter((l) => shown.has(l.topicId)) : lines }),
      dueNow,
      examFocus,
      budget: budget.ok ? { ok: true, resetsAt } : { ok: false, reason: budget.message, resetsAt },
      writing,
      vault: vaultLines,
      mode,
      cramming,
    };
  };

  /** Askable questions (not dive-only, not thumbed down) for some objectives, with what the student has answered. */
  const askableFor = async (courseId: string, objectiveIds: readonly string[]) => {
    if (!objectiveIds.length) return { byObjective: new Map<string, QuestionLine[]>(), lastAnswered: new Map<string, string>() };
    const [questions, feedback, answers] = await Promise.all([
      db.from("questions").select("*").eq("owner_id", ownerId).eq("course_id", courseId).eq("deep", false).in("objective_id", objectiveIds).order("sort_order"),
      db.from("question_feedback").select("question_id").eq("owner_id", ownerId).eq("rating", "down"),
      db.from("evidence_events").select("question_id, at").eq("owner_id", ownerId).eq("course_id", courseId).eq("kind", "answer").in("objective_id", objectiveIds),
    ]);
    for (const r of [questions, feedback, answers]) if (r.error) throw new Error(`Couldn't read the questions: ${r.error.message}`);
    const down = new Set((feedback.data ?? []).map((f) => f.question_id));
    const lastAnswered = new Map<string, string>();
    for (const a of answers.data ?? []) if (a.question_id && (lastAnswered.get(a.question_id) ?? "") < a.at) lastAnswered.set(a.question_id, a.at);
    const byObjective = new Map<string, QuestionLine[]>();
    for (const row of questions.data ?? []) {
      if (!row.objective_id || down.has(row.id)) continue;
      const q = questionFromRow(row);
      const line: QuestionLine = { id: q.id, objectiveId: row.objective_id, kind: q.kind, prompt: q.figure ? `${q.prompt} [This question comes with a figure Orca can't show here; skip it if it needs one.]` : q.prompt, options: q.options, ...(q.anchor ? { anchor: q.anchor } : {}) };
      (byObjective.get(row.objective_id) ?? byObjective.set(row.objective_id, []).get(row.objective_id)!).push(line);
    }
    return { byObjective, lastAnswered };
  };

  /** The question (whole) and its live objective's topic, or why not. */
  const questionWithObjective = async (courseId: string, questionId: string): Promise<{ q: QuizQuestion; objectiveId: string; topicId: string; tier: AnswerEvent["tier"] } | { error: string }> => {
    if (!(await owns(courseId))) return { error: "No such course." };
    const { data: row, error } = await db.from("questions").select("*").eq("owner_id", ownerId).eq("course_id", courseId).eq("id", questionId).maybeSingle();
    if (error) throw new Error(`Couldn't read the question: ${error.message}`);
    if (!row || !row.objective_id) return { error: "No such question in this course; use an id from questions_for." };
    const { data: objective, error: objectiveError } = await db.from("objectives").select("topic_id").eq("owner_id", ownerId).eq("course_id", courseId).eq("id", row.objective_id).maybeSingle();
    if (objectiveError) throw new Error(`Couldn't read the question's objective: ${objectiveError.message}`);
    if (!objective) return { error: "That question's objective is no longer in the course." };
    return { q: questionFromRow(row), objectiveId: row.objective_id, topicId: objective.topic_id, tier: row.tier as AnswerEvent["tier"] };
  };

  /** One answer event from the connector, recorded against the student's snapshot, with what Claude reported (help, confidence, the kind of mistake). */
  const record = async (a: { courseId: string; topicId: string; objectiveId: string; questionId: string; tier: AnswerEvent["tier"]; outcome: AnswerEvent["outcome"]; grader: AnswerEvent["grader"]; sessionId: string; response?: string; help?: AnswerEvent["help"]; confidence?: AnswerEvent["confidence"]; errorType?: AnswerEvent["errorType"] }): Promise<RecordedAnswer | { error: string }> => {
    const at = now();
    const event: AnswerEvent = {
      kind: "answer",
      id: crypto.randomUUID(),
      at: at.toISOString(),
      courseId: a.courseId,
      topicId: a.topicId,
      objectiveId: a.objectiveId,
      questionId: a.questionId,
      tier: a.tier,
      outcome: a.outcome,
      grader: a.grader,
      source: "connector",
      sessionId: a.sessionId,
      ...(a.response ? { response: a.response } : {}),
      ...(a.help ? { help: a.help } : {}),
      ...(a.confidence ? { confidence: a.confidence } : {}),
      ...(a.errorType ? { errorType: a.errorType } : {}),
    };
    try {
      const r = await recordEvent(supabaseSnapshotStore(db, ownerId, a.courseId), event);
      const status = r.objectiveId && r.accumulator ? stateAt(r.objectiveId, r.accumulator, at).status : "unseen";
      return { recorded: true, objectiveId: r.objectiveId ?? a.objectiveId, status, ...(r.objectiveId === null ? { note: "Recorded, but this question's objective isn't live, so it counts for nothing." } : {}) };
    } catch (e) {
      if (e instanceof VersionConflictError) return { error: "Another answer was being saved at the same moment; this one wasn't recorded. Try again." };
      if (e instanceof NewerRulesError) return { error: "Orca is being updated; the answer wasn't recorded. Try again in a moment." };
      if (e instanceof RecordError) return { error: `Orca couldn't record the answer: ${e.message}` };
      throw e;
    }
  };

  return {
    async courses() {
      const { data, error } = await db.from("courses").select("id, name").eq("owner_id", ownerId).is("deleted_at", null).order("created_at");
      if (error) throw new Error(`Couldn't read the courses: ${error.message}`);
      return data.map((c) => ({ id: c.id, name: c.name }));
    },

    courseState,

    async questionsFor(courseId, objectiveIds, limit) {
      const state = await courseState(courseId);
      if (!state) return null;
      const wanted = objectiveIds ?? state.dueNow;
      if (wanted.length === 0) return { questions: [], withoutQuestions: [] };
      const { data, error } = await db.from("questions").select("*").eq("owner_id", ownerId).eq("course_id", courseId).in("objective_id", wanted).order("sort_order");
      if (error) throw new Error(`Couldn't read the questions: ${error.message}`);
      // Spread across the objectives asked for, in the order they were asked for.
      const byObjective = new Map<string, QuestionLine[]>();
      // Deep-review questions can be asked here too, but an objective with only those still needs its own (as in flag_check).
      const quickAsked = new Set<string>();
      for (const row of data) {
        if (!row.objective_id) continue;
        if (!row.deep) quickAsked.add(row.objective_id);
        const q = questionFromRow(row);
        const line: QuestionLine = {
          id: q.id,
          objectiveId: row.objective_id,
          kind: q.kind,
          prompt: q.figure ? `${q.prompt} [This question comes with a figure Orca can't show here; skip it if it needs one.]` : q.prompt,
          options: q.options,
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
      return { questions: out, withoutQuestions: wanted.filter((id) => !quickAsked.has(id)) };
    },

    async nextQuestions(courseId, { objectiveIds, topicIds, count, write }): Promise<NextQuestions | null> {
      const state = await courseState(courseId, { detail: "full" });
      if (!state) return null;
      const lines = state.objectives ?? [];
      const byId = new Map(lines.map((l) => [l.id, l]));
      // What to draw from: the ids given; the topics given; else what's due, the next exam's topics, then unflagged objectives in course order.
      let candidates: string[];
      if (objectiveIds?.length) candidates = objectiveIds.filter((id) => byId.has(id));
      else if (topicIds?.length) candidates = lines.filter((l) => topicIds.includes(l.topicId)).map((l) => l.id);
      else {
        const focus = new Set(state.examFocus);
        const rest = lines.filter((l) => !state.dueNow.includes(l.id) && (l.status === "unseen" || l.status === "verified"));
        candidates = [...state.dueNow, ...rest.filter((l) => focus.has(l.topicId)).map((l) => l.id), ...rest.filter((l) => !focus.has(l.topicId) && l.status === "unseen").map((l) => l.id)];
      }
      if (!candidates.length) return { questions: [], reason: objectiveIds?.length || topicIds?.length ? "None of those are live objectives of this course." : "This course has no objectives yet: add its material in Orca first." };
      const { byObjective, lastAnswered } = await askableFor(courseId, candidates);
      // Per objective: unseen questions first (in order), then the least recently answered.
      const ordered = new Map<string, QuestionLine[]>();
      for (const id of candidates) {
        const qs = byObjective.get(id) ?? [];
        ordered.set(id, [...qs.filter((q) => !lastAnswered.has(q.id)), ...qs.filter((q) => lastAnswered.has(q.id)).sort((a, b) => lastAnswered.get(a.id)!.localeCompare(lastAnswered.get(b.id)!))]);
      }
      const questions: QuestionLine[] = [];
      for (let round = 0; questions.length < count; round++) {
        let added = false;
        for (const id of candidates) {
          const q = ordered.get(id)?.[round];
          if (q && questions.length < count) {
            questions.push(q);
            added = true;
          }
        }
        if (!added) break;
      }
      if (questions.length) return { questions };

      const targets = candidates.filter((id) => !(byObjective.get(id)?.length)).slice(0, count);
      if (!targets.length) return { questions: [], reason: "Nothing left to ask here." };
      const inFlight = state.writing.find((w) => w.objectiveIds.some((id) => targets.includes(id)));
      const untilReset = Math.max(60, Math.ceil((Date.parse(state.budget.resetsAt) - now().getTime()) / 1000));
      if (inFlight) {
        const waiting = inFlight.state === "waiting";
        return { questions: [], pending: { runId: inFlight.runId, objectiveIds: inFlight.objectiveIds, state: waiting ? "waiting" : "queued", retryAfterSeconds: waiting ? untilReset : 90, reason: waiting ? `Orca is writing questions for these, but its daily model limit is spent; they're written when it resets. ${state.budget.reason ?? ""}`.trim() : "Orca is writing questions for these now." } };
      }
      if (!write) return { questions: [], reason: "No questions written for these yet (write is false)." };
      if (!state.budget.ok) return { questions: [], pending: { runId: null, objectiveIds: targets, state: "waiting", retryAfterSeconds: untilReset, reason: `Orca's daily model limit is spent, so it can't write questions until it resets. ${state.budget.reason ?? ""}`.trim() } };
      if (!(await rateLimit(db, ownerId, "topUp")).ok) return { questions: [], reason: "Orca has written questions as often as it allows this hour; ask again later." };
      const started = await startFlagTopUpJob(db, ownerId, { courseId, objectiveIds: targets });
      if (started.state === "no-model") return { questions: [], reason: "Orca has no AI connected, so it can't write questions." };
      if (started.state === "no-session") return { questions: [], reason: "Orca couldn't start writing questions." };
      return { questions: [], pending: { runId: started.runId ?? null, objectiveIds: targets, state: started.state, retryAfterSeconds: started.state === "busy" ? 180 : 90, reason: started.state === "busy" ? "Orca is busy with another job for this student; the questions are written after it." : "Orca is writing questions for these now." } };
    },

    async removeExam(courseId, examId) {
      if (!(await owns(courseId))) return { error: "No such course." };
      const { data, error } = await db.from("exams").delete().eq("owner_id", ownerId).eq("course_id", courseId).eq("id", examId).select("id");
      if (error) throw new Error(`Couldn't remove the exam: ${error.message}`);
      if (!data.length) return { error: "No such exam in this course; use an id from course_state." };
      return { removed: true };
    },

    // `report` (help, confidence) is stored on the event; the rubric grader's errorType too.
    async checkAnswer(courseId, questionId, response, sessionId, report = {}): Promise<CheckedAnswer | SelfGradeNeeded | { error: string }> {
      const found = await questionWithObjective(courseId, questionId);
      if ("error" in found) return found;
      const { q, objectiveId, topicId, tier } = found;
      const words = cleanAnswer(response);
      if (!words) return { error: "response is the student's answer, 1 to 2000 characters." };
      const key = keyOf(q);
      let outcome: AnswerEvent["outcome"];
      let feedback: string;
      let grader: CheckedAnswer["grader"];
      // The kind of mistake: only the rubric grader names one; choice and exact answers never have one.
      let errorType: CheckedAnswer["errorType"] = null;
      if (q.kind !== "Short answer") {
        const picked = pickOption(words, q.options);
        if (picked === null) return { error: `Pass the option the student chose: its number as shown (1 to ${q.options.length}), its letter, or its text.` };
        outcome = picked === q.answer ? "correct" : "incorrect";
        feedback = outcome === "correct" ? "Right." : `Not quite. The answer is ${q.options[q.answer]}.`;
        grader = "choice";
      } else if (q.exact?.length) {
        const r = gradeExact(words, q.exact);
        outcome = r.outcome;
        feedback = r.feedback;
        grader = "exact";
      } else if (q.rubric) {
        // Orca's own prose grader, on Orca's key: its rate limit, budgets and the grading-off rule apply.
        const g = await gradeAnswer(db, ownerId, questionId, words);
        if (g.status !== 200 || "error" in g.body) return { needsSelfGrade: true, reason: "error" in g.body ? g.body.error : "Orca couldn't grade this answer.", ...key };
        outcome = g.body.outcome;
        feedback = g.body.feedback;
        grader = "rubric";
        errorType = g.body.errorType ?? null;
      } else {
        return { error: "This question has no key Orca can check against." };
      }
      const recorded = await record({ courseId, topicId, objectiveId, questionId, tier, outcome, grader, sessionId, response: words, help: report.help, confidence: report.confidence, ...(errorType ? { errorType } : {}) });
      if ("error" in recorded) return recorded;
      return { recorded: true, outcome, grader, feedback, errorType, ...key, objectiveId: recorded.objectiveId, status: recorded.status, ...(recorded.note ? { note: recorded.note } : {}) };
    },

    // An answer Claude graded against the key (grader claude: full credit unless `help` says
    // otherwise, src/lib/mastery/objective-state.ts). When the student's words are given and the
    // key is one Orca can check itself (a choice or exact answer), Orca's result wins (corrected).
    async recordAnswer(courseId, questionId, outcome, sessionId, response, report: AnswerReport): Promise<RecordedAnswer | { error: string }> {
      const found = await questionWithObjective(courseId, questionId);
      if ("error" in found) return found;
      const { q, objectiveId, topicId, tier } = found;
      const checked = response ? orcaOutcome(q, response) : null;
      const corrected = checked !== null && checked !== outcome;
      const recorded = await record({ courseId, topicId, objectiveId, questionId, tier, outcome: corrected ? checked : outcome, grader: "claude", sessionId, ...(response ? { response } : {}), help: report.help, confidence: report.confidence, errorType: report.errorType });
      return "error" in recorded || !corrected ? recorded : { ...recorded, corrected: true };
    },

    materialFor: (courseId, objectiveIds) => materialFor(db, ownerId, courseId, objectiveIds),
    addQuestions: (courseId, questions) => addQuestions(db, ownerId, courseId, questions),
    addMaterial: (courseId, input) => addMaterial(db, ownerId, courseId, input),
    logEvidence: (courseId, objectiveId, entry, sessionId) => logEvidence(db, ownerId, courseId, objectiveId, entry, sessionId),

    async screened(hits) {
      await recordSecurityEvents(db, ownerId, "reflection_note", hits);
    },

    async flagCheck(courseId, objectiveIds, said, strength): Promise<FlagCheckResult | { error: string }> {
      if (!(await owns(courseId))) return { error: "No such course." };
      const [objectives, topics] = await Promise.all([
        db.from("objectives").select("id, topic_id, review, merged_into").eq("owner_id", ownerId).eq("course_id", courseId),
        db.from("topics").select("id, review, merged_into").eq("owner_id", ownerId).eq("course_id", courseId),
      ]);
      if (objectives.error || topics.error) throw new Error(`Couldn't read the course: ${(objectives.error ?? topics.error)!.message}`);
      const objectiveById = new Map(objectives.data.map((o) => [o.id, o]));
      const topicById = new Map(topics.data.map((t) => [t.id, t]));
      const survivor = <T extends { merged_into: string | null }>(byId: Map<string, T>, id: string): T | undefined => {
        let x = byId.get(id);
        for (let i = 0; x?.merged_into && i < 50; i++) x = byId.get(x.merged_into);
        return x;
      };
      // A flag counts only on a live objective in a live topic; anything else is listed, not recorded.
      const live = new Map<string, { id: string; topic_id: string }>();
      const unknown: string[] = [];
      for (const id of objectiveIds) {
        const o = survivor(objectiveById, id);
        const topic = o ? survivor(topicById, o.topic_id) : undefined;
        if (!o || o.review === "archived" || !topic || topic.review === "archived") unknown.push(id);
        else live.set(o.id, o);
      }
      const at = now();
      const flagged: FlagCheckResult["flagged"] = [];
      for (const o of live.values()) {
        // The flag's strength follows its source (src/lib/mastery/flags.ts): check me, or struggled.
        const event: ConfusionEvent = { kind: "confusion", id: crypto.randomUUID(), at: at.toISOString(), courseId, topicId: o.topic_id, objectiveId: o.id, materialId: null, note: said, flagSource: strength === "struggled" ? "connector-struggled" : "connector", page: null };
        try {
          const r = await recordEvent(supabaseSnapshotStore(db, ownerId, courseId), event);
          flagged.push({ objectiveId: o.id, status: r.objectiveId && r.accumulator ? stateAt(r.objectiveId, r.accumulator, at).status : "unseen" });
        } catch (e) {
          if (e instanceof VersionConflictError) return { error: "Another answer was being saved at the same moment; not every flag was recorded. Try again." };
          if (e instanceof NewerRulesError) return { error: "Orca is being updated; the flags weren't recorded. Try again in a moment." };
          if (e instanceof RecordError) return { error: `Orca couldn't record the flags: ${e.message}` };
          throw e;
        }
      }
      const ids = flagged.map((f) => f.objectiveId);
      const asked = new Set<string>();
      if (ids.length) {
        // Questions of objectives merged into these count for them.
        const sources = objectives.data.filter((o) => ids.includes(survivor(objectiveById, o.id)?.id ?? o.id)).map((o) => o.id);
        const { data, error } = await db.from("questions").select("objective_id").eq("owner_id", ownerId).eq("course_id", courseId).eq("deep", false).in("objective_id", sources);
        if (error) throw new Error(`Couldn't read the questions: ${error.message}`);
        for (const q of data) if (q.objective_id) asked.add(survivor(objectiveById, q.objective_id)?.id ?? q.objective_id);
      }
      const withoutQuestions = ids.filter((id) => !asked.has(id));
      if (!withoutQuestions.length) return { flagged, unknown, withoutQuestions };
      const started = await topUpAfterFlag(db, ownerId, courseId, withoutQuestions);
      // The job itself holds on a spent daily budget (it goes `waiting`), which the hand-off can't
      // see; say so here rather than promising questions in a few minutes (owner, 2026-11-07).
      const held = started === "started" || started === "queued" || started === "busy" ? await checkBudget(db, ownerId, 0) : null;
      const note =
        held && !held.ok
          ? `${held.message} Orca's daily model limit is spent, so the questions for these aren't written until it resets: tell the student, and ask for them again tomorrow rather than in a few minutes.`
          : started === "started" || started === "queued" || started === "busy"
            ? "Orca is writing questions for these; ask for them again in a few minutes."
            : started === "no-model"
              ? "Orca has no AI connected, so it can't write questions for these yet."
              : "Orca will write questions for these with its next batch.";
      return { flagged, unknown, withoutQuestions, note };
    },

    async setExam(courseId, exam): Promise<ExamLine | { error: string }> {
      if (!(await owns(courseId))) return { error: "No such course." };
      const { data: topics, error: topicsError } = await db.from("topics").select("id").eq("owner_id", ownerId).eq("course_id", courseId).in("id", exam.topicIds.length ? exam.topicIds : ["00000000-0000-0000-0000-000000000000"]);
      if (topicsError) throw new Error(`Couldn't read the topics: ${topicsError.message}`);
      const known = new Set((topics ?? []).map((t) => t.id));
      const unknown = exam.topicIds.filter((id) => !known.has(id));
      if (unknown.length) return { error: `These aren't topic ids in this course: ${unknown.join(", ")}. Use ids from course_state.` };
      // cramming and scope left out keep what the exam already has (false and null for a new one).
      let kept: { cramming: boolean; scope: ExamScope | null } = { cramming: false, scope: null };
      if (exam.id) {
        const { data: existing, error } = await db.from("exams").select("id, cramming, scope").eq("owner_id", ownerId).eq("course_id", courseId).eq("id", exam.id).maybeSingle();
        if (error) throw new Error(`Couldn't read the exam: ${error.message}`);
        if (!existing) return { error: "No such exam in this course; use an id from course_state, or omit examId to add one." };
        kept = { cramming: existing.cramming, scope: existing.scope as unknown as ExamScope | null };
      }
      const cramming = exam.cramming ?? kept.cramming;
      const scope = exam.scope ?? kept.scope;
      const row = { id: exam.id ?? crypto.randomUUID(), owner_id: ownerId, course_id: courseId, title: exam.title, date: exam.date, topic_ids: exam.topicIds, cramming, scope: scope as unknown as Json };
      const { error } = await db.from("exams").upsert(row);
      if (error) throw new Error(`Couldn't save the exam: ${error.message}`);
      const at = now();
      const today = dayKeyIn((await db.from("profiles").select("timezone").eq("owner_id", ownerId).maybeSingle()).data?.timezone ?? "UTC")(at.toISOString());
      const weekOut = new Date(at.getTime() + AGENDA_RULES.examWindowDays * 86_400_000).toISOString().slice(0, 10);
      return { id: row.id, title: row.title, date: row.date, topicIds: row.topic_ids, cramming, scope, mode: examMode({ date: row.date, cramming }, today, weekOut) };
    },
  };
}
