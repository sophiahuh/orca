import test from "node:test";
import assert from "node:assert/strict";
import { type ConnectorTools, INSTRUCTIONS, PROTOCOL_VERSION, TOOLS, handleRpc } from "../../src/lib/connector/mcp.ts";

/** A student with one course, one objective and one question, remembering what was recorded. */
function fakeTools() {
  const recorded: Array<{ questionId: string; outcome: string; session: string }> = [];
  const exams: Array<{ id: string; title: string; date: string; topicIds: string[] }> = [];
  const COURSE = "c0000000-0000-4000-8000-000000000001";
  const TOPIC = "e0000000-0000-4000-8000-000000000001";
  const OBJ = "f0000000-0000-4000-8000-000000000001";
  const Q = "a0000000-0000-4000-8000-000000000001";
  const tools: ConnectorTools = {
    async courses() {
      return [{ id: COURSE, name: "ALD" }];
    },
    async courseState(courseId) {
      if (courseId !== COURSE) return null;
      return {
        course: { id: COURSE, name: "ALD" },
        today: "2026-11-04",
        exams,
        topics: [{ id: TOPIC, name: "Adders" }],
        objectives: [{ id: OBJ, topicId: TOPIC, topic: "Adders", name: "Explain carry-save", status: "unseen", recall: null, questions: 1, upcoming: false }],
        dueNow: [OBJ],
      };
    },
    async questionsFor(courseId, objectiveIds, limit) {
      if (courseId !== COURSE) return null;
      if (objectiveIds && !objectiveIds.includes(OBJ)) return [];
      return [{ id: Q, objectiveId: OBJ, kind: "Short answer" as const, prompt: "Why is carry-save faster?", options: [], answer: -1, explanation: "No ripple." }].slice(0, limit);
    },
    async recordAnswer(courseId, questionId, outcome, session) {
      if (courseId !== COURSE || questionId !== Q) return { error: "No such question in this course; use an id from questions_for." };
      recorded.push({ questionId, outcome, session });
      return { recorded: true, objectiveId: OBJ, status: "learning" };
    },
    async setExam(courseId, exam) {
      if (courseId !== COURSE) return { error: "No such course." };
      const saved = { id: exam.id ?? "b0000000-0000-4000-8000-000000000001", title: exam.title, date: exam.date, topicIds: exam.topicIds };
      exams.push(saved);
      return saved;
    },
  };
  return { tools, recorded, exams, COURSE, TOPIC, OBJ, Q };
}

const rpc = (method: string, params?: unknown, id: number | string | null = 1) => ({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
const call = (name: string, args: unknown, id = 1) => rpc("tools/call", { name, arguments: args }, id);
const text = (reply: { body: unknown }) => JSON.parse((reply.body as { result: { content: Array<{ text: string }> } }).result.content[0].text) as Record<string, unknown>;
const isError = (reply: { body: unknown }) => (reply.body as { result: { isError: boolean } }).result.isError;

test("initialize answers with the protocol version, the tools capability and the instructions", async () => {
  const { tools } = fakeTools();
  const reply = await handleRpc(rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "claude", version: "1" } }), tools, "s");
  assert.equal(reply.status, 200);
  const body = reply.body as { id: number; result: { protocolVersion: string; capabilities: object; instructions: string; serverInfo: { name: string } } };
  assert.equal(body.id, 1);
  assert.equal(body.result.protocolVersion, "2025-03-26", "a known older version is echoed");
  assert.deepEqual(body.result.capabilities, { tools: { listChanged: false } });
  assert.equal(body.result.instructions, INSTRUCTIONS);
  assert.equal(body.result.serverInfo.name, "orca");
  const unknown = await handleRpc(rpc("initialize", { protocolVersion: "1999-01-01" }), tools, "s");
  assert.equal((unknown.body as { result: { protocolVersion: string } }).result.protocolVersion, PROTOCOL_VERSION);
});

test("notifications get 202 and no body; ping and tools/list answer", async () => {
  const { tools } = fakeTools();
  assert.deepEqual(await handleRpc({ jsonrpc: "2.0", method: "notifications/initialized" }, tools, "s"), { status: 202, body: null });
  assert.deepEqual((await handleRpc(rpc("ping"), tools, "s")).body, { jsonrpc: "2.0", id: 1, result: {} });
  const list = await handleRpc(rpc("tools/list"), tools, "s");
  const names = (list.body as { result: { tools: Array<{ name: string }> } }).result.tools.map((t) => t.name);
  assert.deepEqual(names, ["course_state", "set_exam", "questions_for", "record_answer"]);
  for (const t of TOOLS) {
    assert.ok(t.description.length > 80, `${t.name} explains when to use it`);
    assert.equal(t.inputSchema.type, "object");
  }
});

test("a malformed message is a 400; an unknown method is a JSON-RPC error", async () => {
  const { tools } = fakeTools();
  assert.equal((await handleRpc({ hello: 1 }, tools, "s")).status, 400);
  assert.equal((await handleRpc([rpc("ping")], tools, "s")).status, 400, "batches aren't accepted");
  const unknown = await handleRpc(rpc("resources/list"), tools, "s");
  assert.equal(unknown.status, 200);
  assert.equal((unknown.body as { error: { code: number } }).error.code, -32601);
});

test("course_state lists the courses without an id and describes one with it", async () => {
  const { tools, COURSE } = fakeTools();
  assert.deepEqual(text(await handleRpc(call("course_state", {}), tools, "s")), { courses: [{ id: COURSE, name: "ALD" }] });
  const state = text(await handleRpc(call("course_state", { courseId: COURSE }), tools, "s"));
  assert.equal((state.course as { name: string }).name, "ALD");
  assert.deepEqual(state.dueNow, ["f0000000-0000-4000-8000-000000000001"]);
  const missing = await handleRpc(call("course_state", { courseId: "c0000000-0000-4000-8000-000000000009" }), tools, "s");
  assert.equal(isError(missing), true);
  assert.equal(isError(await handleRpc(call("course_state", { courseId: "ALD" }), tools, "s")), true, "a name isn't an id");
});

test("questions_for draws from what's due by default and takes a limit", async () => {
  const { tools, COURSE, Q } = fakeTools();
  const got = text(await handleRpc(call("questions_for", { courseId: COURSE }), tools, "s"));
  assert.equal((got.questions as Array<{ id: string }>)[0].id, Q);
  const none = text(await handleRpc(call("questions_for", { courseId: COURSE, objectiveIds: ["f0000000-0000-4000-8000-000000000002"], limit: 3 }), tools, "s"));
  assert.deepEqual(none.questions, []);
  assert.equal(isError(await handleRpc(call("questions_for", { courseId: COURSE, objectiveIds: "all" }), tools, "s")), true);
});

test("record_answer records a graded outcome under the chat's session and refuses anything else", async () => {
  const { tools, recorded, COURSE, Q } = fakeTools();
  const ok = text(await handleRpc(call("record_answer", { courseId: COURSE, questionId: Q, outcome: "partial" }), tools, "connector:2026-11-04"));
  assert.deepEqual(ok, { recorded: true, objectiveId: "f0000000-0000-4000-8000-000000000001", status: "learning" });
  assert.deepEqual(recorded, [{ questionId: Q, outcome: "partial", session: "connector:2026-11-04" }]);
  assert.equal(isError(await handleRpc(call("record_answer", { courseId: COURSE, questionId: Q, outcome: "right" }), tools, "s")), true, "outcomes are the three Orca knows");
  assert.equal(isError(await handleRpc(call("record_answer", { courseId: COURSE, questionId: "a0000000-0000-4000-8000-000000000009", outcome: "correct" }), tools, "s")), true);
  assert.equal(recorded.length, 1, "refused calls record nothing");
});

test("set_exam checks its fields and returns the saved exam", async () => {
  const { tools, exams, COURSE, TOPIC } = fakeTools();
  const saved = text(await handleRpc(call("set_exam", { courseId: COURSE, title: "Midterm", date: "2026-10-23", topicIds: [TOPIC] }), tools, "s"));
  assert.equal(saved.title, "Midterm");
  assert.equal(exams.length, 1);
  assert.equal(isError(await handleRpc(call("set_exam", { courseId: COURSE, title: "Midterm", date: "Oct 23", topicIds: [] }), tools, "s")), true, "dates are YYYY-MM-DD");
  assert.equal(isError(await handleRpc(call("set_exam", { courseId: COURSE, title: "", date: "2026-10-23", topicIds: [] }), tools, "s")), true);
  assert.equal(isError(await handleRpc(call("set_exam", { courseId: COURSE, title: "Final", date: "2026-12-18", topicIds: ["Adders"] }), tools, "s")), true, "topics are ids");
  assert.equal(exams.length, 1, "refused calls save nothing");
});

test("a tool that throws is reported as that tool's failure, not a protocol error", async () => {
  const { tools, COURSE } = fakeTools();
  tools.courseState = async () => {
    throw new Error("Couldn't read the course: boom");
  };
  const reply = await handleRpc(call("course_state", { courseId: COURSE }), tools, "s");
  assert.equal(reply.status, 200);
  assert.equal(isError(reply), true);
  assert.match(String(text(reply).error), /boom/);
});
