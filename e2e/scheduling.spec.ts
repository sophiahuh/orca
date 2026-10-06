import type { Page } from "@playwright/test";
import type { AnswerEvent } from "../src/lib/mastery/types";
import { expect, test, F, FIXTURE_STATE, daysAgo, seedPages, seedState, stored } from "./fixture";
import { fakeCalls, fakeModel } from "./fake-model";

const COURSE = "logic-e2e";
const bank = FIXTURE_STATE.questionBank[F.course];
const answers = new Map(Object.values(bank).flat().map((q) => [q.prompt, q.exact![0]]));

/**
 * The server stamps every answer with its own clock, so these tests run on the real clock and seed
 * past days relative to it (they used to freeze the browser's clock, which the server can't see).
 * A test that starts a minute before midnight can see its answers land on the next day.
 */

/** Answer every question in the run, right or wrong, then finish. */
async function answerAll(page: Page, right: boolean) {
  let previous: string | null = null;
  for (;;) {
    // Wait for the next question to finish replacing the last one.
    if (previous !== null) await expect(page.locator("h1").first()).not.toHaveText(previous);
    await expect(page.getByPlaceholder("Type your answer")).toBeEnabled();
    const prompt = (await page.locator("h1").first().textContent())!.trim();
    previous = prompt;
    // The fake API's deep-review questions ("…: deep case 3?") have the case number as their answer.
    const answer = answers.get(prompt) ?? /deep case (\d+)\?$/.exec(prompt)?.[1];
    if (answer === undefined) throw new Error(`No fixture answer for "${prompt}"`);
    await page.getByPlaceholder("Type your answer").fill(right ? answer : "0");
    await page.getByRole("button", { name: "Check" }).click();
    const finish = page.getByRole("button", { name: "Finish" });
    if (await finish.isVisible()) {
      await finish.click();
      return;
    }
    await page.getByRole("button", { name: "Continue" }).click();
  }
}

const noModel = (page: Page) => page.route("**/api/llm/status", (route) => route.fulfill({ json: { serverModel: null } }));

/**
 * Milliseconds until the next midnight in the student's timezone (the fixture signs students up
 * with this process's zone). A test that starts just before it would see its answers land on the
 * next day, so the run waits for the new day first instead of failing.
 */
function msToMidnight(now = new Date()): number {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(now).map((p) => [p.type, p.value]));
  const sinceMidnight = (Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second)) * 1000 + now.getMilliseconds();
  return 86_400_000 - sinceMidnight;
}
test.beforeEach(async ({}, testInfo) => {
  const left = msToMidnight();
  if (left < 90_000) {
    testInfo.setTimeout(testInfo.timeout + left + 5_000);
    await new Promise((r) => setTimeout(r, left + 1_000));
  }
});

test.describe("scheduling", () => {
  test("a quick review is due, starts instantly from the stock and is done for the day once finished", async ({ page, student }) => {
    await noModel(page);
    await seedState(student, FIXTURE_STATE);
    await page.goto("/home");
    const card = page.locator('[data-todo="quick"]');
    await expect(card).toContainText("Quick review · 10 min");
    await expect(card).toContainText("3 objectives due · New: not practised yet");

    await card.click();
    await expect(page).toHaveURL(/\/session\/logic-e2e\?kind=quick/);
    await expect(page.getByText("1 / 6")).toBeVisible();
    await answerAll(page, true);

    await expect(page.getByText("You answered 6 of 6 correctly.")).toBeVisible();
    await expect(page.locator('[data-part="top-up"]')).toHaveText("No AI is connected, so Orca can't write new questions.");
    const { results, evidence } = await stored(page, student);
    expect(results.map((r) => r.mode)).toEqual(["quick"]);
    expect(evidence).toHaveLength(6);
    expect(new Set(evidence.map((e) => (e as AnswerEvent).source))).toEqual(new Set(["quick-review"]));
    expect(evidence.every((e) => (e as AnswerEvent).sessionId === results[0].sessionId)).toBe(true);

    await page.goto("/home");
    await expect(page.locator('[data-todo="quick"]')).toHaveCount(0);
  });

  test("a poor session leaves review to-dos with where to re-read, and a re-quiz for the next day", async ({ page, student }) => {
    await noModel(page);
    await seedState(student, FIXTURE_STATE);
    await page.goto(`/session/${COURSE}?kind=quick`);
    await answerAll(page, false);
    await expect(page.getByText("You answered 0 of 6 correctly.")).toBeVisible();

    await page.goto("/home");
    await expect(page.locator('[data-todo="study"]')).toHaveCount(3);
    const requiz = page.locator('[data-todo="requiz"]');
    await expect(requiz).toContainText("Re-quiz · 3 objectives");
    await expect(page.getByRole("heading", { name: "Due tomorrow" }).locator("..")).toContainText("Re-quiz");

    await page.locator('[data-todo="study"]').filter({ hasText: "Simplify an expression" }).click();
    await expect(page.locator('[data-part="where-taught"]')).toContainText("L01_Fixture.pdf, slides 1–5");
    const missed = page.locator('[data-part="missed"]');
    await expect(missed).toContainText("Simplify x + xy.");
    await expect(missed).toContainText("Simplify a + a'c.");
    await expect(missed).toContainText("Fixture question.");
    await expect(page.getByText("Your re-quiz opens tomorrow.")).toBeVisible();

    await page.goto(`/session/${COURSE}?kind=requiz`);
    await expect(page.getByText("Your re-quiz opens tomorrow.")).toBeVisible();
  });

  test("the re-quiz opens the next day and clears the to-dos", async ({ page, student }) => {
    await noModel(page);
    // Yesterday's poor quick review.
    const yesterday = Date.now() - 86_400_000;
    const miss = (questionId: string, topicId: string, objectiveId: string, i: number): AnswerEvent => ({
      kind: "answer",
      id: crypto.randomUUID(),
      at: new Date(yesterday + i * 1000).toISOString(),
      courseId: F.course,
      topicId,
      objectiveId,
      questionId,
      tier: "retrieval",
      outcome: "incorrect",
      grader: "exact",
      source: "quick-review",
      sessionId: "poor",
    });
    const evidence = [
      miss(F.ba1, F.booleanAlgebra, F.simplify, 1),
      miss(F.tc1, F.twosComplement, F.convert, 2),
      miss(F.tc4, F.twosComplement, F.signExtend, 3),
      miss(F.ba2, F.booleanAlgebra, F.simplify, 4),
      miss(F.tc2, F.twosComplement, F.convert, 5),
      miss(F.tc3, F.twosComplement, F.convert, 6),
    ];
    const results = [{ courseId: F.course, topicId: null, mode: "quick" as const, sessionId: "poor", correct: 0, total: 3, seconds: 60, finishedAt: new Date(yesterday + 60_000).toISOString() }];
    await seedState(student, { ...FIXTURE_STATE, evidence, results });
    await page.goto("/home");
    await expect(page.getByRole("heading", { name: "Due today" }).locator("..").locator('[data-todo="requiz"]')).toContainText("Re-quiz · 3 objectives");
    await page.locator('[data-todo="requiz"]').click();
    await expect(page).toHaveURL(/kind=requiz/);
    await answerAll(page, true);
    await expect(page.getByText("You answered 6 of 6 correctly.")).toBeVisible();
    // The finished session is saved just after the end card shows; wait for it rather than racing it.
    await expect.poll(async () => (await stored(page, student)).results.map((r) => r.mode)).toEqual(["quick", "requiz"]);

    await page.goto("/home");
    await expect(page.locator('[data-todo="study"]')).toHaveCount(0);
    await expect(page.locator('[data-todo="requiz"]')).toHaveCount(0);
  });

  test("deep review comes due a week after the first answer, writes harder questions when it starts, and stays due until done", async ({ page, student }) => {
    await noModel(page);
    const answered = (objectiveId: string, questionId: string, topicId: string): AnswerEvent => ({
      kind: "answer",
      id: crypto.randomUUID(),
      at: daysAgo(8),
      courseId: F.course,
      topicId,
      objectiveId,
      questionId,
      tier: "retrieval",
      outcome: "correct",
      grader: "exact",
      source: "quiz",
      sessionId: "old",
    });
    const evidence = [answered(F.simplify, F.ba1, F.booleanAlgebra), answered(F.convert, F.tc1, F.twosComplement), answered(F.signExtend, F.tc4, F.twosComplement)];
    await seedState(student, { ...FIXTURE_STATE, evidence });
    // The deck's stored pages: deep questions are written from where each objective is taught.
    await seedPages(student, { [F.material]: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ n, text: `Slide ${n}: logic.` })) });
    await page.goto("/home");
    const card = page.locator('[data-todo="deep"]');
    await expect(card).toContainText("Dive in");
    await card.click();
    await expect(page).toHaveURL(/kind=deep/);

    // The student picks the length and starts; nothing is listed ahead. 20 minutes is 5 questions (4 minutes each).
    await expect(page.getByRole("heading", { name: "How long do you want to study?" })).toBeVisible();
    await expect(page.locator('[data-part="deep-plan"]')).toHaveCount(0);
    await page.locator('[data-part="deep-minutes"][data-minutes="20"]').click();
    await page.locator('[data-part="deep-start"]').click();
    await expect(page.getByText("1 / 5")).toBeVisible({ timeout: 30_000 });
    // One call per topic (the fixture has two), all through the deep step; nothing checks them after.
    expect(await fakeCalls()).toEqual(["deep", "deep"]);
    await expect(page.locator("h1").first()).toContainText("deep case");

    const state = await stored(page, student);
    const deep = Object.values(state.questionBank[F.course]).flat().filter((q) => q.deep);
    expect(deep).toHaveLength(5);
    expect(new Set(deep.map((q) => q.objectiveId))).toEqual(new Set([F.simplify, F.convert, F.signExtend]));
    await answerAll(page, true);

    // The end card offers another deep review, which asks for its length again.
    await page.locator('[data-part="again"]').click();
    await expect(page.getByRole("heading", { name: "How long do you want to study?" })).toBeVisible();
    const modes = (await stored(page, student)).results.map((r) => r.mode);
    expect(modes).toEqual(["deep"]);

    // Deep-review questions stay out of the topic quiz.
    await page.goto(`/quiz/${COURSE}/${F.booleanAlgebra}`);
    await expect(page.getByText("1 / 2")).toBeVisible();

    await page.goto("/home");
    await expect(page.locator('[data-todo="deep"]')).toHaveCount(0);
  });

  test("skipping every question in a dive records nothing: no answers, no session, mastery unchanged, the dive still due", async ({ page, student }) => {
    const answered = (objectiveId: string, questionId: string, topicId: string): AnswerEvent => ({
      kind: "answer",
      id: crypto.randomUUID(),
      at: daysAgo(8),
      courseId: F.course,
      topicId,
      objectiveId,
      questionId,
      tier: "retrieval",
      outcome: "correct",
      grader: "exact",
      source: "quiz",
      sessionId: "old",
    });
    await seedState(student, { ...FIXTURE_STATE, evidence: [answered(F.simplify, F.ba1, F.booleanAlgebra), answered(F.convert, F.tc1, F.twosComplement)] });
    await seedPages(student, { [F.material]: [1, 2, 3, 4, 5].map((n) => ({ n, text: `Slide ${n}: logic.` })) });
    await page.goto("/home");
    await expect(page.locator('[data-todo="deep"]')).toBeVisible();
    const { data: before } = await student.db.from("objective_state").select("objective_id, accumulator").order("objective_id");

    await page.goto(`/session/${COURSE}?kind=deep&topic=${F.booleanAlgebra}&minutes=10`);
    await expect(page.getByText("1 / 3")).toBeVisible({ timeout: 30_000 });
    for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Skip" }).click();
    await expect(page.locator("[data-part=quiz-end-summary]")).toHaveText("You skipped every question, so nothing was recorded and your mastery is unchanged.");

    const state = await stored(page, student);
    expect(state.evidence).toHaveLength(2);
    expect(state.results).toEqual([]);
    const { data: after } = await student.db.from("objective_state").select("objective_id, accumulator").order("objective_id");
    expect(after).toEqual(before);
    await page.goto("/home");
    await expect(page.locator('[data-todo="deep"]')).toBeVisible();
  });

  test("after a session, objectives short of unseen questions are topped up from the material's stored pages", async ({ page, student }) => {
    await fakeModel({ perObjective: 2 });
    await seedState(student, FIXTURE_STATE);
    await seedPages(student, { [F.material]: [{ n: 2, text: "x + xy = x (absorption)" }] });

    await page.goto(`/quiz/${COURSE}/${F.booleanAlgebra}`);
    await answerAll(page, true);
    await expect(page.locator('[data-part="top-up"]')).toHaveText("2 new questions written and checked for next time.", { timeout: 30_000 });
    // A job on the server wrote them, from the stored page, through the fake API.
    expect(await fakeCalls()).toEqual(["generate"]);
    const s = await stored(page, student);
    expect(s.questionBank[F.course][F.booleanAlgebra].map((q) => q.prompt)).toEqual(["Simplify x + xy.", "Simplify a + a'c.", "Simplify an expression: case 1?", "Simplify an expression: case 2?"]);
    expect(s.runs).toEqual([expect.objectContaining({ kind: "top-up", status: "done", materialId: F.material, questionsAdded: 2 })]);
  });
});
