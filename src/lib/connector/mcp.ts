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

import { checkNotes } from "../pipeline/notes.ts";
import type { ScreenHit } from "../untrusted/screen.ts";

export const PROTOCOL_VERSION = "2025-06-18";
const KNOWN_VERSIONS = new Set(["2025-06-18", "2025-03-26", "2024-11-05"]);
export const SERVER_INFO = { name: "orca", version: "0.2" } as const;

/** What Claude is told when it connects; the tool descriptions do the rest. */
export const INSTRUCTIONS =
  "Orca keeps this student's courses: what each exam covers, every learning objective and how well " +
  "the student can do it, and a bank of questions written from their course material. Before " +
  "planning a study session or saying what to work on, call course_state. When the student says " +
  "what an exam covers (from the professor, the syllabus, or a classmate), call set_exam. To check " +
  "the student, ask questions from questions_for one at a time and send each answer, in the student's " +
  "words, to check_answer: Orca grades it, records it and returns the key and explanation for you to " +
  "teach from. Only when check_answer says needsSelfGrade do you grade against the key it returns and " +
  "call record_answer. Never record an answer the student didn't give. When the student asks about " +
  "something or gets it wrong in this chat, call flag_check so Orca checks them on it later.";

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
  /** Orca's derived status: unseen (not flagged), verified, check-due, learning, mixed-up, mastered, fading, retired. */
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

/** A question as Claude asks it: no key (Orca grades through check_answer, which returns the key afterwards). */
export interface QuestionLine {
  id: string;
  objectiveId: string;
  kind: "Multiple choice" | "True or false" | "Short answer";
  prompt: string;
  /** Choices for a choice question, in the order to show them; empty for short answer. */
  options: string[];
  /** Where in the course material it's grounded, when it is. */
  anchor?: { locator: string; excerpt: string };
}

export type Outcome = "correct" | "partial" | "incorrect";

export interface Rubric {
  requiredIdeas: string[];
  acceptableAlternatives: string[];
  knownMisconceptions: Array<{ description: string; indicativePhrasing: string[] }>;
}

/** The key, returned once an answer is checked (or when Orca can't check it). */
export interface AnswerKey {
  /** The right answer as text: the right option, the first accepted exact form, or the ideas a full prose answer needs. */
  answer: string;
  /** Every accepted spelling of an exact answer. */
  exact?: string[];
  /** How a prose answer is judged. */
  rubric?: Rubric;
  explanation: string;
}

/** An answer Orca graded and recorded (full credit, with Orca's own grader). */
export interface CheckedAnswer extends AnswerKey {
  recorded: true;
  outcome: Outcome;
  grader: "choice" | "exact" | "rubric";
  feedback: string;
  objectiveId: string;
  /** The objective's status after the answer. */
  status: string;
  note?: string;
}

/** Orca couldn't grade a prose answer now (no model, the day's budget, a rate limit, grading off): Claude grades against the key and calls record_answer. */
export interface SelfGradeNeeded extends AnswerKey {
  needsSelfGrade: true;
  reason: string;
}

export interface RecordedAnswer {
  recorded: boolean;
  objectiveId: string;
  /** The objective's status after the answer. */
  status: string;
  note?: string;
}

export interface FlagCheckResult {
  /** The objectives flagged (each a live objective of the course), with their status after the flag. */
  flagged: Array<{ objectiveId: string; status: string }>;
  /** Ids that aren't live objectives of this course: nothing was recorded for them. */
  unknown: string[];
  /** Flagged objectives with no questions yet. */
  withoutQuestions: string[];
  note?: string;
}

/** What the route implements against the student's data. Every method is scoped to one student. */
export interface ConnectorTools {
  courses(): Promise<CourseSummary[]>;
  courseState(courseId: string): Promise<CourseState | null>;
  /** The questions, and which of the objectives asked for have none (deep-review questions don't count). Null: no such course. */
  questionsFor(courseId: string, objectiveIds: string[] | null, limit: number): Promise<{ questions: QuestionLine[]; withoutQuestions: string[] } | null>;
  /** Grade the student's answer with Orca's own graders and record it (full credit); or say Orca can't right now and hand over the key. `response` arrives cleaned. */
  checkAnswer(courseId: string, questionId: string, response: string, sessionId: string): Promise<CheckedAnswer | SelfGradeNeeded | { error: string }>;
  /** An answer Claude graded itself: self-marked (half credit). `response`, when given, is the student's words, cleaned and screened. */
  recordAnswer(courseId: string, questionId: string, outcome: Outcome, sessionId: string, response?: string): Promise<RecordedAnswer | { error: string }>;
  setExam(courseId: string, exam: { id?: string; title: string; date: string; topicIds: string[] }): Promise<ExamLine | { error: string }>;
  /** One check-me flag (source connector) per known live objective. `said` arrives cleaned and screened. */
  flagCheck(courseId: string, objectiveIds: string[], said: string): Promise<FlagCheckResult | { error: string }>;
  /** Log the screen's hits on what the student said (refused or not). */
  screened(hits: ScreenHit[]): Promise<void>;
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
      "Questions from Orca's bank to check the student with, each with its objective. They come without " +
      "their keys: ask one, then send the student's answer to check_answer, which grades it, records it and " +
      "returns the key and explanation. For a choice question, show the options in the order given. Leave " +
      "objectiveIds out to get questions for what's due now (only weak points are ever due; pass " +
      "objectiveIds to practise others).",
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
    name: "check_answer",
    description:
      "Send the student's answer to one of Orca's questions, in their own words, and Orca grades and " +
      "records it: a choice question by the option they picked (its number as shown, 1 to 4, its letter, " +
      "or its text), a short answer by exact match or, for a prose answer, by Orca's grader against the " +
      "question's rubric. The reply carries the outcome, feedback, the key and the explanation: teach from " +
      "those. If it says needsSelfGrade, Orca couldn't grade it now; grade against the key yourself and call " +
      "record_answer. 'I don't know' is an answer too: send it.",
    inputSchema: {
      type: "object",
      properties: {
        courseId: UUID,
        questionId: { ...UUID, description: "The question's id from questions_for." },
        response: { type: "string", maxLength: 2000, description: "The student's answer, as they gave it (at most 2000 characters)." },
      },
      required: ["courseId", "questionId", "response"],
      additionalProperties: false,
    },
  },
  {
    name: "record_answer",
    description:
      "Record one answer you graded yourself, only after check_answer said needsSelfGrade for it: correct, " +
      "partial or incorrect, graded against the key check_answer returned. Orca counts these as self-marked " +
      "(half credit) and derives the objective's new status. Pass the student's words too, so Orca can " +
      "look at the grading later. 'I don't know' is incorrect.",
    inputSchema: {
      type: "object",
      properties: {
        courseId: UUID,
        questionId: { ...UUID, description: "The question's id from questions_for." },
        outcome: { type: "string", enum: ["correct", "partial", "incorrect"] },
        response: { type: "string", maxLength: 2000, description: "The student's answer, as they gave it (at most 2000 characters)." },
      },
      required: ["courseId", "questionId", "outcome"],
      additionalProperties: false,
    },
  },
  {
    name: "flag_check",
    description:
      "Ask Orca to check the student later on objectives they asked about or got wrong in this chat: each gets one " +
      "check-me question in their next quick review (a miss makes it a weak point Orca keeps practising). Flag only " +
      "what the student asked about or got wrong, never everything the chat touched. Pass what they said, in their " +
      "words. Orca writes questions for any objective that has none yet.",
    inputSchema: {
      type: "object",
      properties: {
        courseId: UUID,
        objectiveIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 20, description: "Objective ids from course_state." },
        said: { type: "string", maxLength: 200, description: "What the student said or asked, in their words (at most 200 characters)." },
      },
      required: ["courseId", "objectiveIds", "said"],
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
        return questions ? toolText(questions) : toolText({ error: "No such course." }, true);
      }
      case "check_answer": {
        if (!isUuid(args.courseId)) return toolText({ error: "courseId must be a course id from course_state." }, true);
        if (!isUuid(args.questionId)) return toolText({ error: "questionId must be a question id from questions_for." }, true);
        if (typeof args.response !== "string" || args.response.trim().length === 0 || args.response.length > 2000) return toolText({ error: "response is the student's answer, 1 to 2000 characters." }, true);
        const checked = await tools.checkAnswer(args.courseId, args.questionId, args.response.trim(), session);
        return toolText(checked, "error" in checked);
      }
      case "record_answer": {
        if (!isUuid(args.courseId)) return toolText({ error: "courseId must be a course id from course_state." }, true);
        if (!isUuid(args.questionId)) return toolText({ error: "questionId must be a question id from questions_for." }, true);
        if (args.outcome !== "correct" && args.outcome !== "partial" && args.outcome !== "incorrect") return toolText({ error: "outcome is correct, partial or incorrect." }, true);
        let response: string | undefined;
        if (args.response !== undefined) {
          if (typeof args.response !== "string" || args.response.length > 2000) return toolText({ error: "response is the student's answer, at most 2000 characters." }, true);
          // Screened like a reflection note: a strong hit is refused, every hit logged.
          const said = checkNotes(args.response, 2000);
          if (said.hits.length) await tools.screened(said.hits);
          if (!said.ok) return toolText({ error: `Orca can't record that answer ("${said.quote}"); send what the student said, in plain words.` }, true);
          response = said.text ?? undefined;
        }
        const recorded = await tools.recordAnswer(args.courseId, args.questionId, args.outcome, session, response);
        return toolText(recorded, "error" in recorded);
      }
      case "flag_check": {
        if (!isUuid(args.courseId)) return toolText({ error: "courseId must be a course id from course_state." }, true);
        if (!Array.isArray(args.objectiveIds) || args.objectiveIds.length < 1 || args.objectiveIds.length > 20 || !args.objectiveIds.every(isUuid)) {
          return toolText({ error: "objectiveIds is 1 to 20 objective ids from course_state." }, true);
        }
        if (typeof args.said !== "string" || args.said.length > 200) return toolText({ error: "said is 1 to 200 characters: what the student said." }, true);
        // Screened like a reflection note: a strong hit is refused, every hit logged.
        const said = checkNotes(args.said, 200);
        if (said.hits.length) await tools.screened(said.hits);
        if (!said.ok) return toolText({ error: `Orca can't record that note ("${said.quote}"); say what the student asked in plain words.` }, true);
        if (!said.text) return toolText({ error: "said is 1 to 200 characters: what the student said." }, true);
        const out = await tools.flagCheck(args.courseId, [...new Set(args.objectiveIds as string[])], said.text);
        return toolText(out, "error" in out);
      }
      default:
        return toolText({ error: `Orca doesn't have a tool called "${String(name)}".` }, true);
    }
  } catch (e) {
    // A tool that threw is reported to Claude as the tool's failure, not a protocol error.
    return toolText({ error: e instanceof Error ? e.message : "Orca couldn't do that." }, true);
  }
}
