/**
 * The Claude connector: Orca as an MCP server that Claude calls on its own while a student studies
 * in a chat. Claude does the teaching; Orca holds what the exam covers, which objectives are weak,
 * the question bank, and records the answers Claude grades (as self-marked: half credit, never
 * clearing a mix-up). This module is the protocol and the tool contract, pure: the route gives it
 * a `ConnectorTools` backed by Supabase, the tests a fake one.
 *
 * Protocol: MCP over "Streamable HTTP" (spec 2025-06-18), one JSON-RPC request per POST, answered
 * as JSON. No server-to-client stream (nothing here is long-running), no sessions.
 */

export const PROTOCOL_VERSION = "2025-06-18";
const KNOWN_VERSIONS = new Set(["2025-06-18", "2025-03-26", "2024-11-05"]);
export const SERVER_INFO = { name: "orca", version: "0.1" } as const;

/** What Claude is told when it connects; the tool descriptions do the rest. */
export const INSTRUCTIONS =
  "Orca keeps this student's courses: what each exam covers, every learning objective and how well " +
  "the student can do it, and a bank of questions written from their course material. Before " +
  "planning a study session or saying what to work on, call course_state. When the student says " +
  "what an exam covers (from the professor, the syllabus, or a classmate), call set_exam. To check " +
  "the student, ask questions from questions_for and grade them yourself; then call record_answer " +
  "for each one so Orca's record stays right. Never record an answer you didn't grade.";

/* ── Tool results: plain data the implementations return; the protocol wraps them ── */

export interface CourseSummary {
  id: string;
  name: string;
}

export interface ObjectiveLine {
  id: string;
  topicId: string;
  topic: string;
  name: string;
  /** Orca's derived status: unseen, learning, mixed-up, mastered, fading, retired. */
  status: string;
  /** Predicted chance of recalling it now, 0–1, or null before any answer. */
  recall: number | null;
  /** How many questions Orca has for it (0: it can't be checked until some are written). */
  questions: number;
  /** From material the class hasn't reached yet: not due, still askable if the student wants. */
  upcoming: boolean;
}

export interface ExamLine {
  id: string;
  title: string;
  /** YYYY-MM-DD */
  date: string;
  /** Topic ids it covers; empty means the whole course. */
  topicIds: string[];
}

export interface CourseState {
  course: CourseSummary;
  /** The student's day, YYYY-MM-DD, in their timezone. */
  today: string;
  exams: ExamLine[];
  topics: Array<{ id: string; name: string }>;
  objectives: ObjectiveLine[];
  /** Objective ids Orca would have the student work on now, most urgent first. */
  dueNow: string[];
}

export interface QuestionLine {
  id: string;
  objectiveId: string;
  kind: "Multiple choice" | "True or false" | "Short answer";
  prompt: string;
  options: string[];
  /** Index into options for choice questions; -1 for short answer. */
  answer: number;
  /** Accepted exact answers for a short answer, if it has an exact form. */
  exact?: string[];
  /** How to judge a prose answer, if there's no exact form. */
  rubric?: { requiredIdeas: string[]; acceptableAlternatives: string[]; knownMisconceptions: Array<{ description: string; indicativePhrasing: string[] }> };
  explanation: string;
  /** Where in the course material it's grounded, when it is. */
  anchor?: { locator: string; excerpt: string };
}

export type Outcome = "correct" | "partial" | "incorrect";

export interface RecordedAnswer {
  recorded: boolean;
  objectiveId: string;
  /** The objective's status after the answer. */
  status: string;
  note?: string;
}

/** What the route implements against the student's data. Every method is scoped to one student. */
export interface ConnectorTools {
  courses(): Promise<CourseSummary[]>;
  courseState(courseId: string): Promise<CourseState | null>;
  questionsFor(courseId: string, objectiveIds: string[] | null, limit: number): Promise<QuestionLine[] | null>;
  recordAnswer(courseId: string, questionId: string, outcome: Outcome, sessionId: string): Promise<RecordedAnswer | { error: string }>;
  setExam(courseId: string, exam: { id?: string; title: string; date: string; topicIds: string[] }): Promise<ExamLine | { error: string }>;
}

/* ── Tool list, as Claude sees it ── */

const UUID = { type: "string", description: "An id from course_state." };

export const TOOLS = [
  {
    name: "course_state",
    description:
      "The student's courses, or one course in full: its exams and what each covers, its topics, every " +
      "learning objective with Orca's status for it (unseen = not flagged, verified, check-due, learning, " +
      "mixed-up, mastered, fading, retired) and predicted recall, and which objectives are due now. Orca " +
      "only schedules weak points: objectives the student struggled with, missed or asked to be checked " +
      "on. Call this before planning " +
      "what to study, and again after recording answers to see where things stand. With no course, " +
      "lists the courses so you can pick one.",
    inputSchema: {
      type: "object",
      properties: { courseId: { ...UUID, description: "The course to describe. Omit to list the courses." } },
      additionalProperties: false,
    },
  },
  {
    name: "set_exam",
    description:
      "Record an exam and what it covers: its date and the topic ids it tests (empty for the whole " +
      "course). Use it when the student says what's on an exam, from the professor, the syllabus or a " +
      "classmate. Pass an existing exam's id to change it. Orca schedules reviews from this.",
    inputSchema: {
      type: "object",
      properties: {
        courseId: UUID,
        examId: { ...UUID, description: "An existing exam to change; omit to add one." },
        title: { type: "string", description: "What the student calls it, e.g. Midterm, Final." },
        date: { type: "string", description: "YYYY-MM-DD." },
        topicIds: { type: "array", items: { type: "string" }, description: "Topic ids it covers; empty for every topic." },
      },
      required: ["courseId", "title", "date", "topicIds"],
      additionalProperties: false,
    },
  },
  {
    name: "questions_for",
    description:
      "Questions from Orca's bank to check the student with, each with its objective, the answer and " +
      "how to grade it. Ask them in your own words if you like, but grade against the answer, exact " +
      "forms or rubric given. For a choice question, show the options. Then call record_answer for " +
      "each one you graded. Leave objectiveIds out to get questions for what's due now.",
    inputSchema: {
      type: "object",
      properties: {
        courseId: UUID,
        objectiveIds: { type: "array", items: { type: "string" }, description: "Objectives to draw from; omit for what's due now." },
        limit: { type: "integer", minimum: 1, maximum: 20, description: "How many at most (default 5)." },
      },
      required: ["courseId"],
      additionalProperties: false,
    },
  },
  {
    name: "record_answer",
    description:
      "Record one answer you graded to one of Orca's questions: correct, partial or incorrect. Only " +
      "call it for a question from questions_for that the student actually answered and you graded; " +
      "'I don't know' is incorrect. Orca counts these as self-marked (half credit) and derives the " +
      "objective's new status.",
    inputSchema: {
      type: "object",
      properties: {
        courseId: UUID,
        questionId: { ...UUID, description: "The question's id from questions_for." },
        outcome: { type: "string", enum: ["correct", "partial", "incorrect"] },
      },
      required: ["courseId", "questionId", "outcome"],
      additionalProperties: false,
    },
  },
] as const;

/* ── JSON-RPC over one POST ── */

interface RpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

export interface RpcReply {
  /** HTTP status: 200 with a body, 202 for a notification, 400 for a malformed request. */
  status: number;
  body: unknown | null;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

function result(id: RpcRequest["id"], value: unknown): RpcReply {
  return { status: 200, body: { jsonrpc: "2.0", id: id ?? null, result: value } };
}
function failure(id: RpcRequest["id"], code: number, message: string, status = 200): RpcReply {
  return { status, body: { jsonrpc: "2.0", id: id ?? null, error: { code, message } } };
}
/** A tool's answer, or its refusal, as MCP content. */
function toolText(value: unknown, isError = false) {
  return { content: [{ type: "text", text: JSON.stringify(value) }], isError };
}

/**
 * Answer one JSON-RPC message. `session` names the chat for evidence (`sessionId`): the route passes
 * a stable value per connection where it has one, else the day.
 */
export async function handleRpc(raw: unknown, tools: ConnectorTools, session: string): Promise<RpcReply> {
  if (!isObject(raw) || raw.jsonrpc !== "2.0" || typeof raw.method !== "string") {
    return failure(null, -32600, "Send one JSON-RPC 2.0 request.", 400);
  }
  const req = raw as unknown as RpcRequest;
  const params = isObject(req.params) ? req.params : {};
  const isNotification = !("id" in raw);

  switch (req.method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : PROTOCOL_VERSION;
      return result(req.id, {
        protocolVersion: KNOWN_VERSIONS.has(asked) ? asked : PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "notifications/initialized":
    case "notifications/cancelled":
    case "notifications/roots/list_changed":
      return { status: 202, body: null };
    case "ping":
      return result(req.id, {});
    case "tools/list":
      return result(req.id, { tools: TOOLS });
    case "tools/call":
      if (isNotification) return { status: 202, body: null };
      return result(req.id, await callTool(params, tools, session));
    default:
      if (isNotification) return { status: 202, body: null };
      return failure(req.id, -32601, `Orca doesn't have "${req.method}".`);
  }
}

async function callTool(params: Record<string, unknown>, tools: ConnectorTools, session: string) {
  const name = params.name;
  const args = isObject(params.arguments) ? params.arguments : {};
  try {
    switch (name) {
      case "course_state": {
        if (args.courseId === undefined) return toolText({ courses: await tools.courses() });
        if (!isUuid(args.courseId)) return toolText({ error: "courseId must be a course id from course_state." }, true);
        const state = await tools.courseState(args.courseId);
        return state ? toolText(state) : toolText({ error: "No such course." }, true);
      }
      case "set_exam": {
        if (!isUuid(args.courseId)) return toolText({ error: "courseId must be a course id from course_state." }, true);
        if (typeof args.title !== "string" || args.title.trim().length === 0 || args.title.length > 120) return toolText({ error: "title is 1 to 120 characters." }, true);
        if (typeof args.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(args.date) || Number.isNaN(Date.parse(args.date))) return toolText({ error: "date is YYYY-MM-DD." }, true);
        if (!Array.isArray(args.topicIds) || !args.topicIds.every(isUuid)) return toolText({ error: "topicIds is a list of topic ids from course_state (empty for the whole course)." }, true);
        if (args.examId !== undefined && !isUuid(args.examId)) return toolText({ error: "examId must be an exam id from course_state." }, true);
        const exam = await tools.setExam(args.courseId, { ...(args.examId !== undefined ? { id: args.examId } : {}), title: args.title.trim(), date: args.date, topicIds: args.topicIds });
        return toolText(exam, "error" in exam);
      }
      case "questions_for": {
        if (!isUuid(args.courseId)) return toolText({ error: "courseId must be a course id from course_state." }, true);
        if (args.objectiveIds !== undefined && (!Array.isArray(args.objectiveIds) || !args.objectiveIds.every(isUuid))) return toolText({ error: "objectiveIds is a list of objective ids from course_state." }, true);
        const limit = typeof args.limit === "number" && Number.isInteger(args.limit) ? Math.min(20, Math.max(1, args.limit)) : 5;
        const questions = await tools.questionsFor(args.courseId, (args.objectiveIds as string[] | undefined) ?? null, limit);
        return questions ? toolText({ questions }) : toolText({ error: "No such course." }, true);
      }
      case "record_answer": {
        if (!isUuid(args.courseId)) return toolText({ error: "courseId must be a course id from course_state." }, true);
        if (!isUuid(args.questionId)) return toolText({ error: "questionId must be a question id from questions_for." }, true);
        if (args.outcome !== "correct" && args.outcome !== "partial" && args.outcome !== "incorrect") return toolText({ error: "outcome is correct, partial or incorrect." }, true);
        const recorded = await tools.recordAnswer(args.courseId, args.questionId, args.outcome, session);
        return toolText(recorded, "error" in recorded);
      }
      default:
        return toolText({ error: `Orca doesn't have a tool called "${String(name)}".` }, true);
    }
  } catch (e) {
    // A tool that threw is reported to Claude as the tool's failure, not a protocol error.
    return toolText({ error: e instanceof Error ? e.message : "Orca couldn't do that." }, true);
  }
}
