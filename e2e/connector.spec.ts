import { type Page } from "@playwright/test";
import type { QuizQuestion } from "../src/lib/data";
import { fakeModel } from "./fake-model";
import { expect, test, F, FIXTURE_STATE, ids, seedState, stored } from "./fixture";

/**
 * The Claude connector, end to end: the link minted in Settings, then the MCP route as Claude
 * calls it (one JSON-RPC message per POST) against the fixture course, and the evidence it leaves.
 */

let nextId = 1;
async function rpc(page: Page, url: string, method: string, params?: unknown) {
  const res = await page.request.post(url, { data: { jsonrpc: "2.0", id: nextId++, method, ...(params === undefined ? {} : { params }) } });
  return { status: res.status(), body: (await res.json().catch(() => null)) as { result?: { content?: Array<{ text: string }>; isError?: boolean; tools?: Array<{ name: string }>; protocolVersion?: string }; error?: { message: string } } | null };
}
const toolText = (r: Awaited<ReturnType<typeof rpc>>) => JSON.parse(r.body!.result!.content![0].text) as Record<string, unknown>;
const call = (page: Page, url: string, name: string, args: unknown) => rpc(page, url, "tools/call", { name, arguments: args });

test("Settings mints the connector link once; Claude can read the course, ask a question and have Orca grade it; Disconnect revokes it", async ({ page, student }) => {
  // The fixture's exact-answer questions, plus a choice question and a prose one, so every grader is exercised.
  const id = ids("mc", "prose", "noq");
  const mc: QuizQuestion = { id: id.mc, kind: "Multiple choice", tier: "retrieval", topic: "Two's Complement", prompt: "Which 4-bit pattern is −5?", options: ["0101", "1011", "0110", "1111"], answer: 1, explanation: "Invert 0101 and add one.", anchor: { locator: "slide 7", excerpt: "fixture" }, objectiveId: F.convert };
  const prose: QuizQuestion = { id: id.prose, kind: "Short answer", tier: "mechanism", topic: "Two's Complement", prompt: "Why does sign extension copy the top bit?", options: [], answer: -1, rubric: { requiredIdeas: ["The top bit is the sign"], acceptableAlternatives: [], knownMisconceptions: [] }, explanation: "The weight of the new bits cancels.", anchor: { locator: "slide 9", excerpt: "fixture" }, objectiveId: F.signExtend };
  const bank = FIXTURE_STATE.questionBank[F.course];
  // Plus an objective with no questions yet, for next_questions to write for.
  const noq = { ...FIXTURE_STATE.objectives[F.course][F.simplify], id: id.noq, name: "Factor an expression" };
  await seedState(student, { ...FIXTURE_STATE, objectives: { [F.course]: { ...FIXTURE_STATE.objectives[F.course], [id.noq]: noq } }, questionBank: { [F.course]: { ...bank, [F.twosComplement]: [...bank[F.twosComplement], mc, prose] } } });
  await page.goto("/settings?section=connections");
  const card = page.locator('[data-part="claude-connector"]');
  await expect(card.locator('[data-part="connector-status"]')).toHaveText(/Not connected/);
  await card.locator('[data-part="connector-create"]').click();
  const url = (await card.locator('[data-part="connector-url"]').textContent())!.trim();
  expect(url).toMatch(/\/api\/mcp\/[A-Za-z0-9_-]{40,}$/);

  // The handshake, as Claude's client does it.
  const init = await rpc(page, url, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude", version: "1" } });
  expect(init.status).toBe(200);
  expect(init.body!.result!.protocolVersion).toBe("2025-06-18");
  const note = await page.request.post(url, { data: { jsonrpc: "2.0", method: "notifications/initialized" } });
  expect(note.status()).toBe(202);
  const tools = await rpc(page, url, "tools/list");
  expect(tools.body!.result!.tools!.map((t) => t.name)).toEqual(["course_state", "next_questions", "set_exam", "questions_for", "check_answer", "record_answer", "flag_check"]);

  // The courses, then one course: every objective unseen (not flagged), each with its questions counted; weak points first, so none is due.
  const courses = toolText(await call(page, url, "course_state", {}));
  expect(courses.courses).toEqual([{ id: F.course, name: "Logic Fixture" }]);
  const state = toolText(await call(page, url, "course_state", { courseId: F.course })) as { topics: Array<{ name: string; objectives: number; askable: number }>; objectives: Array<{ id: string; status: string; questions: number }>; dueNow: string[]; exams: unknown[]; budget: { ok: boolean; resetsAt: string }; writing: unknown[]; examFocus: string[] };
  expect(state.topics.map((t) => [t.name, t.objectives, t.askable])).toEqual([["Boolean Algebra", 2, 1], ["Two's Complement", 2, 2]]);
  expect(state.objectives.map((o) => [o.id, o.status, o.questions]).sort()).toEqual(
    [
      [F.simplify, "unseen", 2],
      [F.convert, "unseen", 4],
      [F.signExtend, "unseen", 2],
      [id.noq, "unseen", 0],
    ].sort(),
  );
  expect(state.dueNow).toEqual([]);
  expect(state.exams).toEqual([]);
  expect(state.budget.ok).toBe(true);
  expect(Date.parse(state.budget.resetsAt)).toBeGreaterThan(Date.now());
  expect([state.writing, state.examFocus]).toEqual([[], []]);
  // A summary leaves the objective lines out; the session needs nothing else between answers.
  const summary = toolText(await call(page, url, "course_state", { courseId: F.course, detail: "summary" }));
  expect(summary).not.toHaveProperty("objectives");
  // next_questions picks for an objective (unseen questions first) and writes for one that has none.
  const next = toolText(await call(page, url, "next_questions", { courseId: F.course, objectiveIds: [F.convert], count: 2 })) as { questions: Array<{ id: string }> };
  expect(next.questions.map((q) => q.id)).toEqual([F.tc1, F.tc2]);
  const writing = toolText(await call(page, url, "next_questions", { courseId: F.course, objectiveIds: [id.noq] })) as { questions: unknown[]; pending?: { objectiveIds: string[]; state: string; retryAfterSeconds: number; reason: string } };
  expect(writing.questions).toEqual([]);
  expect(writing.pending?.objectiveIds).toEqual([id.noq]);
  expect(["started", "queued", "busy"]).toContain(writing.pending?.state);
  expect(writing.pending?.retryAfterSeconds).toBeGreaterThan(0);

  // An exam with its scope; then a question for one objective, without its key.
  const exam = toolText(await call(page, url, "set_exam", { courseId: F.course, title: "Midterm", date: "2026-12-01", topicIds: [F.booleanAlgebra] })) as { id: string; title: string; topicIds: string[] };
  expect(exam.title).toBe("Midterm");
  expect(exam.topicIds).toEqual([F.booleanAlgebra]);
  const questions = toolText(await call(page, url, "questions_for", { courseId: F.course, objectiveIds: [F.simplify], limit: 1 })) as { questions: Array<Record<string, unknown>> };
  expect(questions.questions).toHaveLength(1);
  expect(questions.questions[0]).toMatchObject({ id: F.ba1, objectiveId: F.simplify, prompt: "Simplify x + xy." });
  for (const k of ["answer", "exact", "rubric", "explanation"]) expect(questions.questions[0]).not.toHaveProperty(k);

  // Orca grades (owner, 2026-11-08). An exact answer, right: full credit, and the key comes back; answered right unflagged, the objective is verified.
  const right = toolText(await call(page, url, "check_answer", { courseId: F.course, questionId: F.ba1, response: "it's x" }));
  expect(right).toMatchObject({ recorded: true, outcome: "correct", grader: "exact", answer: "x", exact: ["x"], explanation: "Fixture question.", objectiveId: F.simplify, status: "verified" });
  // A wrong exact answer makes the objective a weak point.
  const wrong = toolText(await call(page, url, "check_answer", { courseId: F.course, questionId: F.ba2, response: "a" })) as { outcome: string; feedback: string; status: string };
  expect(wrong).toMatchObject({ outcome: "incorrect", grader: "exact", status: "learning" });
  expect(wrong.feedback).toMatch(/a \+ c/);
  // A choice question, by the option's number as shown.
  const choice = toolText(await call(page, url, "check_answer", { courseId: F.course, questionId: id.mc, response: "2" }));
  expect(choice).toMatchObject({ outcome: "correct", grader: "choice", answer: "1011", objectiveId: F.convert, status: "verified" });
  const vague = await call(page, url, "check_answer", { courseId: F.course, questionId: id.mc, response: "one of the odd ones" });
  expect(vague.body!.result!.isError).toBe(true);
  // A prose answer goes through Orca's own grader (here the fake API, which says correct).
  const graded = toolText(await call(page, url, "check_answer", { courseId: F.course, questionId: id.prose, response: "Because the top bit is the sign bit." }));
  expect(graded).toMatchObject({ outcome: "correct", grader: "rubric", feedback: "The fake API graded it.", answer: "The top bit is the sign", objectiveId: F.signExtend, status: "verified" });
  // When the grader can't run, the key is handed over and Claude's own grade is recorded self-marked, with the student's words.
  await fakeModel({ fail: { step: "grade", message: "The fake API is having a bad day." } });
  const held = toolText(await call(page, url, "check_answer", { courseId: F.course, questionId: id.prose, response: "copy it" })) as { needsSelfGrade: boolean; reason: string; rubric?: { requiredIdeas: string[] } };
  expect(held.needsSelfGrade).toBe(true);
  expect(held.reason).toMatch(/bad day/);
  expect(held.rubric?.requiredIdeas).toEqual(["The top bit is the sign"]);
  const recorded = toolText(await call(page, url, "record_answer", { courseId: F.course, questionId: id.prose, outcome: "partial", response: "copy it" }));
  expect(recorded).toEqual({ recorded: true, objectiveId: F.signExtend, status: "learning" });

  // The student asked about conversion in the chat: a check-me flag on the verified objective, so it comes due for one question.
  const flagged = toolText(await call(page, url, "flag_check", { courseId: F.course, objectiveIds: [F.convert], said: "why does the sign bit get copied?" })) as { flagged: Array<{ objectiveId: string; status: string }>; unknown: string[]; withoutQuestions: string[] };
  expect(flagged).toEqual({ flagged: [{ objectiveId: F.convert, status: "check-due" }], unknown: [], withoutQuestions: [] });
  const after = toolText(await call(page, url, "course_state", { courseId: F.course })) as { objectives: Array<{ id: string; status: string }>; exams: Array<{ title: string }>; dueNow: string[] };
  expect(Object.fromEntries(after.objectives.map((o) => [o.id, o.status]))).toEqual({ [F.simplify]: "learning", [F.convert]: "check-due", [F.signExtend]: "learning", [id.noq]: "unseen" });
  expect([...after.dueNow].sort()).toEqual([F.simplify, F.convert, F.signExtend].sort());
  expect(after.exams.map((e) => e.title)).toEqual(["Midterm"]);
  // The exam is cancelled.
  expect(toolText(await call(page, url, "set_exam", { courseId: F.course, examId: exam.id, remove: true }))).toEqual({ removed: true });
  expect((toolText(await call(page, url, "course_state", { courseId: F.course, detail: "summary" })) as { exams: unknown[] }).exams).toEqual([]);
  const s = await stored(page, student);
  const events = s.evidence.filter((e) => e.kind === "answer").sort((a, b) => a.at.localeCompare(b.at));
  expect(events.map((e) => [e.questionId, e.outcome, e.grader, e.source])).toEqual([
    [F.ba1, "correct", "exact", "connector"],
    [F.ba2, "incorrect", "exact", "connector"],
    [id.mc, "correct", "choice", "connector"],
    [id.prose, "correct", "rubric", "connector"],
    [id.prose, "partial", "self", "connector"],
  ]);
  expect(events.map((e) => (e.kind === "answer" ? e.response : null))).toEqual(["it's x", "a", "2", "Because the top bit is the sign bit.", "copy it"]);
  expect(s.evidence.filter((e) => e.kind === "confusion")).toEqual([expect.objectContaining({ objectiveId: F.convert, flagSource: "connector", note: "why does the sign bit get copied?", materialId: null, page: null })]);

  // Refusals are the tool's, not the protocol's: an unknown question, a name for an id.
  const bad = await call(page, url, "record_answer", { courseId: F.course, questionId: "a0000000-0000-4000-8000-000000000009", outcome: "correct" });
  expect(bad.body!.result!.isError).toBe(true);
  const named = await call(page, url, "course_state", { courseId: "Logic Fixture" });
  expect(named.body!.result!.isError).toBe(true);

  // Disconnect: the link stops working at once.
  await page.reload();
  await expect(card.locator('[data-part="connector-status"]')).toHaveText(/Connected/);
  await card.locator('[data-part="connector-revoke"]').click();
  // Disconnect asks first; Keep it backs out, Yes, disconnect revokes.
  await card.locator('[data-part="connector-revoke-cancel"]').click();
  await expect(card.locator('[data-part="connector-revoke-confirm"]')).toHaveCount(0);
  await expect(card.locator('[data-part="connector-status"]')).toHaveText(/Connected/);
  await card.locator('[data-part="connector-revoke"]').click();
  await card.locator('[data-part="connector-revoke-yes"]').click();
  await expect(card.locator('[data-part="connector-status"]')).toHaveText(/Not connected/);
  const revoked = await rpc(page, url, "ping");
  expect(revoked.status).toBe(401);
});

test("a made-up link is refused, and GET isn't served", async ({ page }) => {
  const bogus = await rpc(page, "/api/mcp/" + "x".repeat(43), "ping");
  expect(bogus.status).toBe(401);
  expect(bogus.body!.error!.message).toMatch(/isn't valid/);
  const got = await page.request.get("/api/mcp/" + "x".repeat(43));
  expect(got.status()).toBe(405);
});
