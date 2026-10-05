import { expect, test, type Page } from "@playwright/test";

/** The persisted store, read straight from localStorage. */
async function storedEvidence(page: Page) {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem("orca:v5");
    if (!raw) throw new Error("No orca:v5 state in localStorage");
    return (JSON.parse(raw) as { evidence: Array<{ questionId: string; objectiveId: string; outcome: string; grader: string; sessionId: string }> }).evidence;
  });
}

async function answerShort(page: Page, text: string) {
  await page.getByPlaceholder("Type your answer").fill(text);
  await page.getByRole("button", { name: "Check" }).click();
}

test("a fresh browser starts with only the ALD sample course and nothing computed", async ({ page }) => {
  await page.goto("/home");
  await expect(page.locator("[data-level]")).toHaveCount(1);
  await expect(page.locator("[data-level]")).toHaveAttribute("data-level", "uncharted");
  await expect(page.getByText("0 day streak")).toBeVisible();
  await expect(page.getByText("Nothing due. Nice.")).toHaveCount(2);
  await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link")).toHaveCount(3);
});

test("the in-app chat is gone", async ({ page }) => {
  const response = await page.goto("/chat");
  expect(response?.status()).toBe(404);
});

test("onboarding shows all four island looks", async ({ page }) => {
  await page.goto("/");
  for (const level of ["thriving", "growing", "sprouting", "uncharted"]) {
    await expect(page.locator(`[data-level="${level}"]`).first()).toBeVisible();
  }
});

test("the ALD trail is a labelled sample with nothing locked and question gaps shown", async ({ page }) => {
  await page.goto("/course/ald");
  await expect(page.getByText("Sample course")).toBeVisible();
  await expect(page.locator('[data-visual="current"]')).toContainText("Logic Circuits & Switches");
  await expect(page.locator('[data-visual="current"]')).toContainText("1 needs more questions");
  await expect(page.locator('[data-visual="upcoming"] button').first()).toBeVisible();
  await expect(page.locator("[data-visual] button:disabled")).toHaveCount(0);
});

test("on a fresh trail START sits on the first topic and every node shows its objective count", async ({ page }) => {
  await page.goto("/course/ald");
  await expect(page.locator('[data-part="start"]')).toHaveCount(1);
  await expect(page.locator('[data-visual="current"] [data-part="start"]')).toBeVisible();
  await expect(page.locator("[data-visual]").first()).toHaveAttribute("data-visual", "current");
  const subs = page.locator('[data-part="label"] > span:nth-child(2)');
  await expect(subs.first()).toBeVisible();
  for (const sub of await subs.allTextContents()) {
    expect(sub).toMatch(/^\d+ objectives?( · \d+ needs? more questions)?$/);
  }
});

test("the calendar has no fabricated events", async ({ page }) => {
  await page.goto("/calendar");
  await expect(page.locator("[data-today]")).toBeVisible();
  await expect(page.locator('[data-part="event"]')).toHaveCount(0);
});

test("answering quiz questions records evidence and moves the trail, island and streak", async ({ page }) => {
  await page.goto("/quiz/ald/boolean-algebra");
  await answerShort(page, "x");
  await expect(page.getByText("Correct.")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await answerShort(page, "a + c");
  await expect(page.getByText("Correct.")).toBeVisible();

  const evidence = await storedEvidence(page);
  expect(evidence.map((e) => [e.questionId, e.objectiveId, e.outcome, e.grader])).toEqual([
    ["boolean-algebra-1", "boolean-algebra/simplify", "correct", "exact"],
    ["boolean-algebra-2", "boolean-algebra/simplify", "correct", "exact"],
  ]);
  expect(new Set(evidence.map((e) => e.sessionId)).size, "one session per quiz visit").toBe(1);

  await page.goto("/home");
  await expect(page.getByText("1 day streak")).toBeVisible();
  await expect(page.locator("[data-level]")).toHaveAttribute("data-level", "sprouting");

  await page.goto("/course/ald");
  const current = page.locator('[data-visual="current"]');
  await expect(current).toContainText("Boolean Algebra");
  await expect(current).toContainText("0 of 4 objectives mastered");
});

test("answers on two topics show progress on both trail nodes", async ({ page }) => {
  await page.goto("/quiz/ald/boolean-algebra");
  await answerShort(page, "x");
  await expect(page.getByText("Correct.")).toBeVisible();
  await page.goto("/quiz/ald/binary-and-twos-complement");
  await answerShort(page, "1010");
  await expect(page.getByText("Correct.")).toBeVisible();

  const evidence = await storedEvidence(page);
  expect(evidence.map((e) => e.objectiveId)).toEqual(["boolean-algebra/simplify", "binary-and-twos-complement/convert"]);
  expect(new Set(evidence.map((e) => e.sessionId)).size, "each quiz visit is its own session").toBe(2);

  await page.goto("/course/ald");
  for (const name of ["Boolean Algebra", "Binary & 2's Complement"]) {
    const label = page.locator('[data-part="label"]').filter({ hasText: name });
    await expect(label).toContainText(/\d+ of \d+ objectives mastered/);
  }
  await page.goto("/home");
  await expect(page.locator("[data-level]")).toHaveAttribute("data-level", "sprouting");
});

test("a new course starts uncharted with no placeholder topics", async ({ page }) => {
  await page.goto("/new-course");
  await page.getByPlaceholder("Advanced Logic Design").fill("Test Course");
  await page.getByRole("button", { name: "Create Course" }).click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.locator("[data-level]")).toHaveCount(2);
  await page.goto("/course/test-course");
  await expect(page.getByText("This island is uncharted.")).toBeVisible();
});
