import { type Page } from "@playwright/test";
import type { QuizQuestion } from "../src/lib/data";
import { fakeCalls, fakeModel } from "./fake-model";
import { expect, test, F, FIXTURE_STATE, fixtureMaterial, ids, seedState, stored } from "./fixture";

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
  expect(tools.body!.result!.tools!.map((t) => t.name)).toEqual(["course_state", "next_questions", "set_exam", "questions_for", "check_answer", "record_answer", "flag_check", "material_for", "add_questions", "add_material", "log_evidence"]);

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
  // Claude graded it against the key, with a hint along the way (cram mode: grader claude, help on the event).
  const recorded = toolText(await call(page, url, "record_answer", { courseId: F.course, questionId: id.prose, outcome: "partial", response: "copy it", help: "hint", confidence: 2, errorType: "concept" }));
  expect(recorded).toEqual({ recorded: true, objectiveId: F.signExtend, status: "learning" });
  // An exact answer Claude marked right that the stored key disagrees with: Orca's result is recorded instead (corrected).
  const corrected = toolText(await call(page, url, "record_answer", { courseId: F.course, questionId: F.ba2, outcome: "correct", response: "a" }));
  expect(corrected).toEqual({ recorded: true, objectiveId: F.simplify, status: "learning", corrected: true });
  // The key agrees, but Claude showed the answer first: recorded as given, and the fold counts it as a miss (the objective's third: mixed up).
  const shown = toolText(await call(page, url, "record_answer", { courseId: F.course, questionId: F.ba1, outcome: "correct", response: "it is x", help: "shown" }));
  expect(shown).toEqual({ recorded: true, objectiveId: F.simplify, status: "mixed-up" });

  // A cram: a problem Claude set and judged, and what the student did, logged on the objective.
  const work = toolText(await call(page, url, "log_evidence", { courseId: F.course, objectiveId: F.signExtend, kind: "work", problem: "Sign-extend 1011 to 8 bits.", response: "11111011", basis: "known-answer", outcome: "correct", help: "none", confidence: 3 }));
  expect(work).toEqual({ recorded: true, objectiveId: F.signExtend, status: "learning" });
  const harder = toolText(await call(page, url, "log_evidence", { courseId: F.course, objectiveId: F.signExtend, kind: "signal", signal: "asked-harder", note: "wanted a 16-bit one" }));
  expect(harder).toEqual({ recorded: true, objectiveId: F.signExtend, status: "learning" });
  // "Got it" on an objective not in rotation opens a check.
  const gotIt = toolText(await call(page, url, "log_evidence", { courseId: F.course, objectiveId: id.noq, kind: "signal", signal: "got-it" }));
  expect(gotIt).toEqual({ recorded: true, objectiveId: id.noq, status: "check-due" });
  const noSuch = await call(page, url, "log_evidence", { courseId: F.course, objectiveId: "f0000000-0000-4000-8000-000000000099", kind: "signal", signal: "lost" });
  expect(noSuch.body!.result!.isError).toBe(true);

  // The student asked about conversion in the chat: a check-me flag on the verified objective, so it comes due for one question.
  const flagged = toolText(await call(page, url, "flag_check", { courseId: F.course, objectiveIds: [F.convert], said: "why does the sign bit get copied?" })) as { flagged: Array<{ objectiveId: string; status: string }>; unknown: string[]; withoutQuestions: string[] };
  expect(flagged).toEqual({ flagged: [{ objectiveId: F.convert, status: "check-due" }], unknown: [], withoutQuestions: [] });
  // A struggled flag from Claude: its own source, struggled strength.
  const struggled = toolText(await call(page, url, "flag_check", { courseId: F.course, objectiveIds: [F.signExtend], said: "I'm lost on sign extension", strength: "struggled" }));
  expect(struggled).toEqual({ flagged: [{ objectiveId: F.signExtend, status: "learning" }], unknown: [], withoutQuestions: [] });
  const after = toolText(await call(page, url, "course_state", { courseId: F.course })) as { objectives: Array<{ id: string; status: string }>; exams: Array<{ title: string }>; dueNow: string[] };
  expect(Object.fromEntries(after.objectives.map((o) => [o.id, o.status]))).toEqual({ [F.simplify]: "mixed-up", [F.convert]: "check-due", [F.signExtend]: "learning", [id.noq]: "check-due" });
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
    [id.prose, "partial", "claude", "connector"],
    [F.ba2, "incorrect", "claude", "connector"],
    [F.ba1, "correct", "claude", "connector"],
  ]);
  expect(events.map((e) => (e.kind === "answer" ? e.response : null))).toEqual(["it's x", "a", "2", "Because the top bit is the sign bit.", "copy it", "a", "it is x"]);
  // What Claude reported with each answer, stored on the event (record_answer's help defaults to none); Orca's own graders report nothing.
  expect(events.map((e) => (e.kind === "answer" ? [e.help ?? null, e.confidence ?? null, e.errorType ?? null] : null))).toEqual([
    [null, null, null],
    [null, null, null],
    [null, null, null],
    [null, null, null],
    ["hint", 2, "concept"],
    ["none", null, null],
    ["shown", null, null],
  ]);
  expect(s.evidence.filter((e) => e.kind === "confusion").sort((a, b) => a.at.localeCompare(b.at))).toEqual([
    expect.objectContaining({ objectiveId: F.convert, flagSource: "connector", note: "why does the sign bit get copied?", materialId: null, page: null }),
    expect.objectContaining({ objectiveId: F.signExtend, flagSource: "connector-struggled", note: "I'm lost on sign extension", materialId: null, page: null }),
  ]);
  expect(s.evidence.filter((e) => e.kind === "work")).toEqual([expect.objectContaining({ objectiveId: F.signExtend, topicId: F.twosComplement, problem: "Sign-extend 1011 to 8 bits.", response: "11111011", basis: "known-answer", outcome: "correct", help: "none", confidence: 3, source: "connector" })]);
  expect(s.evidence.filter((e) => e.kind === "signal").sort((a, b) => a.at.localeCompare(b.at))).toEqual([
    expect.objectContaining({ objectiveId: F.signExtend, signal: "asked-harder", note: "wanted a 16-bit one", source: "connector" }),
    expect.objectContaining({ objectiveId: id.noq, signal: "got-it", note: null, source: "connector" }),
  ]);

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

test("in a cram Orca makes no model calls: prose is handed back for Claude to grade and no questions are written; a corrected answer carries no errorType", async ({ page, student }) => {
  const id = ids("prose", "noq");
  const prose: QuizQuestion = { id: id.prose, kind: "Short answer", tier: "mechanism", topic: "Two's Complement", prompt: "Why does sign extension copy the top bit?", options: [], answer: -1, rubric: { requiredIdeas: ["The top bit is the sign"], acceptableAlternatives: [], knownMisconceptions: [] }, explanation: "The weight of the new bits cancels.", anchor: { locator: "slide 9", excerpt: "fixture" }, objectiveId: F.signExtend };
  const bank = FIXTURE_STATE.questionBank[F.course];
  const noq = { ...FIXTURE_STATE.objectives[F.course][F.simplify], id: id.noq, name: "Factor an expression" };
  await seedState(student, { ...FIXTURE_STATE, objectives: { [F.course]: { ...FIXTURE_STATE.objectives[F.course], [id.noq]: noq } }, questionBank: { [F.course]: { ...bank, [F.twosComplement]: [...bank[F.twosComplement], prose] } } });
  await page.goto("/settings?section=connections");
  const card = page.locator('[data-part="claude-connector"]');
  await card.locator('[data-part="connector-create"]').click();
  const url = (await card.locator('[data-part="connector-url"]').textContent())!.trim();
  await fakeModel({});

  // An exam 12 days out the student is cramming for: the course is in exam-week whatever the date.
  const far = new Date(Date.now() + 12 * 86_400_000).toISOString().slice(0, 10);
  const exam = toolText(await call(page, url, "set_exam", { courseId: F.course, title: "Final", date: far, topicIds: [], cramming: true })) as { id: string; mode: string };
  expect(exam.mode).toBe("exam-week");
  // No budget yet: the plan assumes 2 hours a study day (12 days: 24 hours) and says so.
  const assumed = toolText(await call(page, url, "course_state", { courseId: F.course, detail: "summary" })) as { mode: string; cramming: string; plan: { defaulted: boolean; hoursLeft: number; behindMinutes: number } };
  expect(assumed).toMatchObject({ mode: "exam-week", cramming: exam.id });
  expect(assumed.plan).toMatchObject({ defaulted: true, hoursLeft: 24, behindMinutes: 0 });
  // Full: the course's materials, and each objective's materialIds, so Claude can map "lectures 11 to 16" to files.
  const full = toolText(await call(page, url, "course_state", { courseId: F.course })) as { materials: unknown[]; objectives: Array<{ id: string; materialIds: string[] }>; exams: Array<{ scope: unknown }> };
  expect(full.materials).toEqual([{ id: F.material, filename: fixtureMaterial(F.course).filename, type: "Lecture", heldBack: false }]);
  expect(full.objectives.find((o) => o.id === F.convert)?.materialIds).toEqual([F.material]);
  expect(full.exams[0]).toHaveProperty("scope", null);
  // The time budget (set at cram setup, or here) makes course_state carry the derived plan and the scope's coverage; the scope names the deck and excludes one objective.
  const scope = { objectives: [{ objectiveId: id.noq, weight: 0, evidence: [{ signal: "professor", quote: "not in the files the exam covers" }] }], sources: ["professor"], materialIds: [F.material], budget: { hours: 6, daysOut: [], since: new Date().toISOString() } };
  const budgeted = toolText(await call(page, url, "set_exam", { courseId: F.course, examId: exam.id, title: "Final", date: far, topicIds: [], scope })) as { scope: { budget: { hours: number }; materialIds: string[] } };
  expect(budgeted.scope.budget.hours).toBe(6);
  expect(budgeted.scope.materialIds).toEqual([F.material]);
  expect(toolText(await call(page, url, "set_exam", { courseId: F.course, examId: exam.id, title: "Final", date: far, topicIds: [], scope: { ...scope, materialIds: [crypto.randomUUID()] } }))).toMatchObject({ error: expect.stringMatching(/material ids/) });
  const planned = toolText(await call(page, url, "course_state", { courseId: F.course, detail: "summary" })) as { plan: { line: string; daysLeft: number; hoursLeft: number; minutesToday: number; defaulted: boolean; perDay: Record<string, number>; days: Array<{ day: string; hours: number; today: boolean; topics: unknown[] }>; topics: Array<{ covered: string }> }; coverage: { total: number; verified: number }; topErrors: unknown[]; exams: Array<Record<string, unknown>> };
  expect(planned.plan.line).toMatch(/days to the exam/);
  expect(planned.plan.daysLeft).toBeGreaterThan(10);
  expect(planned.plan.hoursLeft).toBe(6);
  expect(planned.plan.defaulted).toBe(false);
  expect(planned.coverage.total).toBe(3);
  expect(planned.topErrors).toEqual([]);
  // A total is spread over the days: half an hour each over the 12 days, today included.
  const today = new Date().toISOString().slice(0, 10);
  expect(Object.keys(planned.plan.perDay)).toHaveLength(12);
  expect(planned.plan.perDay[today]).toBe(0.5);
  expect(planned.plan.minutesToday).toBe(30);
  expect(planned.plan.line).toMatch(/Today: /);
  // The schedule: a column per day of the budget, today flagged once; every topic says how far it has got.
  expect(planned.plan.days).toHaveLength(12);
  expect(planned.plan.days.filter((d) => d.today).map((d) => d.day)).toEqual([today]);
  expect(planned.plan.days.every((d) => d.hours === 0.5 && Array.isArray(d.topics))).toBe(true);
  expect(planned.plan.topics.map((t) => t.covered)).toEqual(["untouched", "untouched"]);
  // A summary carries each exam's scope by its size, not its entries (three live objectives in scope, the one excluded).
  expect(planned.exams[0]).not.toHaveProperty("scope");
  expect(planned.exams[0].scopeSummary).toMatchObject({ inScope: 3, excluded: 1, sources: ["professor"], budget: { hours: 6 } });
  // "I have no time today": the budget's today, with objectives and sources left out, keeps the scope; the plan follows the day's hours.
  const none0 = toolText(await call(page, url, "set_exam", { courseId: F.course, examId: exam.id, title: "Final", date: far, topicIds: [], scope: { budget: { today: 0 } } })) as { scope: { objectives: unknown[]; materialIds: string[]; budget: { hours: number; daysOut: string[]; perDay: Record<string, number> } } };
  expect(none0.scope.objectives).toHaveLength(1);
  expect(none0.scope.materialIds).toEqual([F.material]);
  expect(none0.scope.budget).toMatchObject({ hours: 5.5, daysOut: [today] });
  expect(none0.scope.budget.perDay[today]).toBe(0);
  const dayOff = toolText(await call(page, url, "course_state", { courseId: F.course, detail: "summary" })) as { plan: { line: string; minutesToday: number; hoursLeft: number } };
  expect(dayOff.plan.minutesToday).toBe(0);
  expect(dayOff.plan.hoursLeft).toBe(5.5);
  expect(dayOff.plan.line).not.toMatch(/Today: /);
  // "I have an hour": today is an hour, the other days as they were.
  const hour = toolText(await call(page, url, "set_exam", { courseId: F.course, examId: exam.id, title: "Final", date: far, topicIds: [], scope: { budget: { today: 1 } } })) as { scope: { budget: { hours: number; perDay: Record<string, number> } } };
  expect(hour.scope.budget.hours).toBe(6.5);
  expect(hour.scope.budget.perDay[today]).toBe(1);
  const withHour = toolText(await call(page, url, "course_state", { courseId: F.course, detail: "summary" })) as { plan: { line: string; minutesToday: number; hoursLeft: number } };
  expect(withHour.plan.minutesToday).toBe(60);
  expect(withHour.plan.hoursLeft).toBe(6.5);
  expect(withHour.plan.line).toMatch(/Today: /);
  expect(toolText(await call(page, url, "set_exam", { courseId: F.course, examId: exam.id, title: "Final", date: far, topicIds: [], scope: { budget: { today: 0.75 } } }))).toMatchObject({ error: expect.stringMatching(/steps of 0.5/) });
  // A prose answer isn't graded by Orca's model: the key comes back for Claude to grade.
  const held = toolText(await call(page, url, "check_answer", { courseId: F.course, questionId: id.prose, response: "Because the top bit is the sign bit." })) as { needsSelfGrade: boolean; reason: string; rubric?: { requiredIdeas: string[] } };
  expect(held.needsSelfGrade).toBe(true);
  expect(held.reason).toMatch(/cram/);
  expect(held.rubric?.requiredIdeas).toEqual(["The top bit is the sign"]);
  // Nothing askable and nothing pending: Orca starts no top-up, and says Claude writes.
  const none = toolText(await call(page, url, "next_questions", { courseId: F.course, objectiveIds: [id.noq] })) as { questions: unknown[]; pending?: unknown; reason?: string };
  expect(none.questions).toEqual([]);
  expect(none.pending).toBeUndefined();
  expect(none.reason).toMatch(/add_questions/);
  const flagged = toolText(await call(page, url, "flag_check", { courseId: F.course, objectiveIds: [id.noq], said: "factoring is hard", strength: "struggled" })) as { withoutQuestions: string[]; note?: string };
  expect(flagged.withoutQuestions).toEqual([id.noq]);
  expect(flagged.note).toMatch(/add_questions/);
  expect((toolText(await call(page, url, "course_state", { courseId: F.course, detail: "summary" })) as { writing: unknown[] }).writing).toEqual([]);
  expect(await fakeCalls()).toEqual([]);
  // Claude marked an exact answer wrong with a kind of mistake; the key says it's right: Orca's result wins and no errorType is stored.
  const corrected = toolText(await call(page, url, "record_answer", { courseId: F.course, questionId: F.ba1, outcome: "incorrect", response: "x", errorType: "sign" }));
  expect(corrected).toEqual({ recorded: true, objectiveId: F.simplify, status: "verified", corrected: true });
  const s = await stored(page, student);
  const answers = s.evidence.filter((e) => e.kind === "answer");
  expect(answers).toHaveLength(1);
  expect(answers[0]).toMatchObject({ questionId: F.ba1, outcome: "correct", grader: "claude", help: "none" });
  expect(answers[0]).not.toHaveProperty("errorType");

  // Cramming stopped (the exam is still 12 days out): Orca's grader is back.
  expect((toolText(await call(page, url, "set_exam", { courseId: F.course, examId: exam.id, title: "Final", date: far, topicIds: [], cramming: false })) as { mode: string }).mode).toBe("normal");
  const graded = toolText(await call(page, url, "check_answer", { courseId: F.course, questionId: id.prose, response: "Because the top bit is the sign bit." }));
  expect(graded).toMatchObject({ outcome: "correct", grader: "rubric", objectiveId: F.signExtend });
  expect(await fakeCalls()).toEqual(["grade"]);
});

test("a made-up link is refused, and GET isn't served", async ({ page }) => {
  const bogus = await rpc(page, "/api/mcp/" + "x".repeat(43), "ping");
  expect(bogus.status).toBe(401);
  expect(bogus.body!.error!.message).toMatch(/isn't valid/);
  const got = await page.request.get("/api/mcp/" + "x".repeat(43));
  expect(got.status()).toBe(405);
});
