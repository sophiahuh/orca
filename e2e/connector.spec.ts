import { type Page } from "@playwright/test";
import { expect, test, F, seedFixtureCourse, stored } from "./fixture";

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

test("Settings mints the connector link once; Claude can read the course, ask a question and record the answer; Disconnect revokes it", async ({ page, student }) => {
  await seedFixtureCourse(student);
  await page.goto("/settings");
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
  expect(tools.body!.result!.tools!.map((t) => t.name)).toEqual(["course_state", "set_exam", "questions_for", "record_answer"]);

  // The courses, then one course: every objective unseen, each with its questions counted, all due.
  const courses = toolText(await call(page, url, "course_state", {}));
  expect(courses.courses).toEqual([{ id: F.course, name: "Logic Fixture" }]);
  const state = toolText(await call(page, url, "course_state", { courseId: F.course })) as { topics: Array<{ name: string }>; objectives: Array<{ id: string; status: string; questions: number; upcoming: boolean }>; dueNow: string[]; exams: unknown[] };
  expect(state.topics.map((t) => t.name)).toEqual(["Boolean Algebra", "Two's Complement"]);
  expect(state.objectives.map((o) => [o.id, o.status, o.questions, o.upcoming]).sort()).toEqual(
    [
      [F.simplify, "unseen", 2, false],
      [F.convert, "unseen", 3, false],
      [F.signExtend, "unseen", 1, false],
    ].sort(),
  );
  expect(state.dueNow.sort()).toEqual([F.simplify, F.convert, F.signExtend].sort());
  expect(state.exams).toEqual([]);

  // An exam with its scope; then a question for one objective, with what Claude needs to grade it.
  const exam = toolText(await call(page, url, "set_exam", { courseId: F.course, title: "Midterm", date: "2026-12-01", topicIds: [F.booleanAlgebra] })) as { id: string; title: string; topicIds: string[] };
  expect(exam.title).toBe("Midterm");
  expect(exam.topicIds).toEqual([F.booleanAlgebra]);
  const questions = toolText(await call(page, url, "questions_for", { courseId: F.course, objectiveIds: [F.simplify], limit: 1 })) as { questions: Array<{ id: string; objectiveId: string; prompt: string; exact?: string[] }> };
  expect(questions.questions).toHaveLength(1);
  expect(questions.questions[0]).toMatchObject({ id: F.ba1, objectiveId: F.simplify, prompt: "Simplify x + xy.", exact: ["x"] });

  // Claude grades it and records it: self-marked evidence from the connector, and the objective moves to learning.
  const recorded = toolText(await call(page, url, "record_answer", { courseId: F.course, questionId: F.ba1, outcome: "correct" }));
  expect(recorded).toEqual({ recorded: true, objectiveId: F.simplify, status: "learning" });
  const after = toolText(await call(page, url, "course_state", { courseId: F.course })) as { objectives: Array<{ id: string; status: string }>; exams: Array<{ title: string }> };
  expect(after.objectives.find((o) => o.id === F.simplify)!.status).toBe("learning");
  expect(after.exams.map((e) => e.title)).toEqual(["Midterm"]);
  const s = await stored(page, student);
  const events = s.evidence.filter((e) => e.kind === "answer");
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ kind: "answer", questionId: F.ba1, objectiveId: F.simplify, outcome: "correct", grader: "self", source: "connector" });

  // Refusals are the tool's, not the protocol's: an unknown question, a name for an id.
  const bad = await call(page, url, "record_answer", { courseId: F.course, questionId: "a0000000-0000-4000-8000-000000000009", outcome: "correct" });
  expect(bad.body!.result!.isError).toBe(true);
  const named = await call(page, url, "course_state", { courseId: "Logic Fixture" });
  expect(named.body!.result!.isError).toBe(true);

  // Disconnect: the link stops working at once.
  await page.reload();
  await expect(card.locator('[data-part="connector-status"]')).toHaveText(/Connected/);
  await card.locator('[data-part="connector-revoke"]').click();
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
