import { expect, test, type Page, type Route } from "@playwright/test";
import { FIXTURE_STATE, STORAGE_KEY, seedState } from "./fixture";

const COURSE = "logic-e2e";
const bank = FIXTURE_STATE.questionBank[COURSE];
const answers = new Map(Object.values(bank).flat().map((q) => [q.prompt, q.exact![0]]));

async function stored<T>(page: Page, pick: (s: Record<string, unknown>) => T): Promise<T> {
  const state = await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null") as Record<string, unknown>, STORAGE_KEY);
  if (!state) throw new Error("No stored state");
  return pick(state);
}

/** Answer every question in the run, right or wrong, then finish. */
async function answerAll(page: Page, right: boolean) {
  let previous: string | null = null;
  for (;;) {
    // Wait for the next question to finish replacing the last one.
    if (previous !== null) await expect(page.locator("h1").first()).not.toHaveText(previous);
    await expect(page.getByPlaceholder("Type your answer")).toBeEnabled();
    const prompt = (await page.locator("h1").first().textContent())!.trim();
    previous = prompt;
    const answer = answers.get(prompt);
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

test.describe("scheduling", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-10-05T10:00:00"));
  });

  test("a quick review is due, starts instantly from the stock with reasons, and is done for the day once finished", async ({ page }) => {
    await noModel(page);
    await seedState(page, FIXTURE_STATE);
    await page.goto("/home");
    const card = page.locator('[data-todo="quick"]');
    await expect(card).toContainText("Quick review · 10 min");
    await expect(card).toContainText("3 objectives due · New: not practised yet");

    await card.click();
    await expect(page).toHaveURL(/\/session\/logic-e2e\?kind=quick/);
    await expect(page.getByText("1 / 6")).toBeVisible();
    await expect(page.locator('[data-part="question-notes"]')).toHaveText("New: not practised yet");
    await answerAll(page, true);

    await expect(page.getByText("You answered 6 of 6 correctly.")).toBeVisible();
    await expect(page.locator('[data-part="top-up"]')).toHaveText("No AI is connected, so Orca can't write new questions.");
    const results = await stored(page, (s) => s.results as Array<{ mode: string; sessionId: string }>);
    const evidence = await stored(page, (s) => s.evidence as Array<{ source: string; sessionId: string }>);
    expect(results.map((r) => r.mode)).toEqual(["quick"]);
    expect(new Set(evidence.map((e) => e.source))).toEqual(new Set(["quick-review"]));
    expect(evidence.every((e) => e.sessionId === results[0].sessionId)).toBe(true);

    await page.goto("/home");
    await expect(page.locator('[data-todo="quick"]')).toHaveCount(0);
  });

  test("a poor session leaves review to-dos with where to re-read, and a re-quiz for the next day", async ({ page }) => {
    await noModel(page);
    await seedState(page, FIXTURE_STATE);
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

  test("the re-quiz opens the next day and clears the to-dos", async ({ page }) => {
    await noModel(page);
    await page.clock.setFixedTime(new Date("2026-10-06T10:00:00"));
    const miss = (questionId: string, topicId: string, objectiveId: string, i: number) => ({
      kind: "answer",
      id: `m${i}`,
      at: `2026-10-05T10:00:0${i}.000Z`,
      courseId: COURSE,
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
      miss("ba-1", "boolean-algebra", "boolean-algebra/simplify", 1),
      miss("tc-1", "twos-complement", "twos-complement/convert", 2),
      miss("tc-4", "twos-complement", "twos-complement/sign-extend", 3),
      miss("ba-2", "boolean-algebra", "boolean-algebra/simplify", 4),
      miss("tc-2", "twos-complement", "twos-complement/convert", 5),
      miss("tc-3", "twos-complement", "twos-complement/convert", 6),
    ];
    const results = [{ courseId: COURSE, topicId: null, mode: "quick", sessionId: "poor", correct: 0, total: 3, seconds: 60, finishedAt: "2026-10-05T10:01:00.000Z" }];
    await seedState(page, { ...FIXTURE_STATE, evidence, results });
    await page.goto("/home");
    await expect(page.getByRole("heading", { name: "Due today" }).locator("..").locator('[data-todo="requiz"]')).toContainText("Re-quiz · 3 objectives");
    await page.locator('[data-todo="requiz"]').click();
    await expect(page).toHaveURL(/kind=requiz/);
    await answerAll(page, true);
    await expect(page.getByText("You answered 6 of 6 correctly.")).toBeVisible();
    const modes = await stored(page, (s) => (s.results as Array<{ mode: string }>).map((r) => r.mode));
    expect(modes).toEqual(["quick", "requiz"]);

    await page.goto("/home");
    await expect(page.locator('[data-todo="study"]')).toHaveCount(0);
    await expect(page.locator('[data-todo="requiz"]')).toHaveCount(0);
  });

  test("deep review comes due a week after the first answer and stays due until done", async ({ page }) => {
    await noModel(page);
    const answered = {
      kind: "answer",
      id: "e1",
      at: "2026-09-27T10:00:00.000Z",
      courseId: COURSE,
      topicId: "boolean-algebra",
      objectiveId: "boolean-algebra/simplify",
      questionId: "ba-1",
      tier: "retrieval",
      outcome: "correct",
      grader: "exact",
      source: "quiz",
      sessionId: "old",
    };
    const config = { ...FIXTURE_STATE.configs[COURSE], deep: { duration: "5 min", cadence: "Weekly" } };
    await seedState(page, { ...FIXTURE_STATE, configs: { [COURSE]: config }, evidence: [answered] });
    await page.goto("/home");
    const card = page.locator('[data-todo="deep"]');
    await expect(card).toContainText("Deep review · 5 min");
    await card.click();
    await expect(page).toHaveURL(/kind=deep/);
    // Only the objective the student has answered goes into a deep review.
    await expect(page.getByText("1 / 2")).toBeVisible();
    await answerAll(page, true);
    await page.goto("/home");
    await expect(page.locator('[data-todo="deep"]')).toHaveCount(0);
  });

  test("after a session, objectives short of unseen questions are topped up from the kept material text", async ({ page }) => {
    const generated = [
      { prompt: "Simplify x·x + x.", exact: ["x"] },
      { prompt: "Simplify ab + ab'.", exact: ["a"] },
    ];
    await page.route("**/api/llm/status", (route) => route.fulfill({ json: { serverModel: "claude-opus-5-5" } }));
    const steps: string[] = [];
    await page.route("**/api/pipeline/*", async (route: Route) => {
      const step = new URL(route.request().url()).pathname.split("/").pop()!;
      steps.push(step);
      const { input } = route.request().postDataJSON() as { input: Record<string, unknown> };
      if (step === "generate") {
        const objectiveId = (input.objectives as Array<{ id: string }>)[0].id;
        return route.fulfill({
          json: {
            output: {
              questions: generated.map((g) => ({
                objectiveId,
                kind: "Short answer",
                tier: "retrieval",
                prompt: g.prompt,
                options: [],
                answer: -1,
                exact: g.exact,
                rubric: null,
                explanation: "Absorption.",
                anchor: { locator: "slide 2", excerpt: "x + xy = x" },
                figureSlide: null,
              })),
            },
          },
        });
      }
      if (step === "solve") {
        const qs = input.questions as Array<{ id: string; prompt: string }>;
        return route.fulfill({ json: { output: { answers: qs.map((q) => ({ id: q.id, choice: null, text: generated.find((g) => g.prompt === q.prompt)!.exact[0] })) } } });
      }
      return route.fulfill({ status: 500, json: { error: `no stub for ${step}` } });
    });
    const material = { id: "fixture-material", courseId: COURSE, filename: "L01_Fixture.pdf", type: "Lecture", assigned: null, due: null, reflect: false };
    await seedState(page, { ...FIXTURE_STATE, materials: [material], materialPages: { "fixture-material": [{ n: 2, text: "x + xy = x (absorption)" }] } });

    await page.goto(`/quiz/${COURSE}/boolean-algebra`);
    await answerAll(page, true);
    await expect(page.locator('[data-part="top-up"]')).toHaveText("2 new questions written and checked for next time.");
    expect(steps).toEqual(["generate", "solve"]);
    const prompts = await stored(page, (s) => (s.questionBank as Record<string, Record<string, Array<{ prompt: string }>>>)[COURSE]["boolean-algebra"].map((q) => q.prompt));
    expect(prompts).toEqual(["Simplify x + xy.", "Simplify a + a'c.", ...generated.map((g) => g.prompt)]);
    const runs = await stored(page, (s) => s.runs as Array<{ kind?: string; questionsAdded: number }>);
    expect(runs).toEqual([expect.objectContaining({ kind: "top-up", questionsAdded: 2 })]);
  });
});
