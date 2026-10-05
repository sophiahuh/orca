import type { Page } from "@playwright/test";
import { expect, test, STORAGE_KEY, seedFixtureCourse } from "./fixture";

/** The persisted store, read straight from localStorage. */
async function storedEvidence(page: Page) {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (!raw) throw new Error(`No ${key} state in localStorage`);
    return (JSON.parse(raw) as { evidence: Array<{ questionId: string; objectiveId: string; outcome: string; grader: string; sessionId: string }> }).evidence;
  }, STORAGE_KEY);
}

async function answerShort(page: Page, text: string) {
  await page.getByPlaceholder("Type your answer").fill(text);
  await page.getByRole("button", { name: "Check" }).click();
}

test.describe("a fresh browser", () => {
  test("starts with no courses and nothing computed", async ({ page }) => {
    await page.goto("/home");
    await expect(page.getByText("No islands yet.")).toBeVisible();
    await expect(page.locator("[data-level]")).toHaveCount(0);
    await expect(page.getByText("0 day streak")).toBeVisible();
    await expect(page.getByText("Nothing due. Nice.")).toHaveCount(2);
    await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link")).toHaveCount(3);
  });

  test("asks for a course before taking material", async ({ page }) => {
    await page.goto("/add-material");
    await expect(page.getByText("No course to add material to.")).toBeVisible();
    await page.getByRole("link", { name: "Add Course" }).click();
    await expect(page).toHaveURL(/\/new-course$/);
  });

  test("has no in-app chat", async ({ page }) => {
    const response = await page.goto("/chat");
    expect(response?.status()).toBe(404);
  });

  test("onboarding shows all four island looks", async ({ page }) => {
    await page.goto("/");
    for (const level of ["thriving", "growing", "sprouting", "uncharted"]) {
      await expect(page.locator(`[data-level="${level}"]`).first()).toBeVisible();
    }
  });

  test("the calendar has no fabricated events", async ({ page }) => {
    await page.goto("/calendar");
    await expect(page.locator("[data-today]")).toBeVisible();
    await expect(page.locator('[data-part="event"]')).toHaveCount(0);
  });

  test("a new course starts uncharted with no placeholder topics", async ({ page }) => {
    await page.goto("/new-course");
    await page.getByPlaceholder("Advanced Logic Design").fill("Test Course");
    await page.getByRole("button", { name: "Create Course" }).click();
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.locator("[data-level]")).toHaveCount(1);
    await expect(page.locator("[data-level]")).toHaveAttribute("data-level", "uncharted");
    await page.goto("/course/test-course");
    await expect(page.getByText("This island is uncharted.")).toBeVisible();
  });
});

test.describe("a course with uploaded questions", () => {
  test.beforeEach(async ({ page }) => seedFixtureCourse(page));

  test("the trail has nothing locked, START on the first topic, and objective counts with question gaps", async ({ page }) => {
    await page.goto("/course/logic-e2e");
    await expect(page.locator('[data-part="start"]')).toHaveCount(1);
    await expect(page.locator("[data-visual]").first()).toHaveAttribute("data-visual", "current");
    await expect(page.locator('[data-visual="current"]')).toContainText("Boolean Algebra");
    await expect(page.locator('[data-visual="current"]')).toContainText("1 objective · 1 needs more questions");
    await expect(page.locator('[data-visual="upcoming"]')).toContainText("2 objectives · 1 needs more questions");
    await expect(page.locator('[data-visual="upcoming"] button').first()).toBeVisible();
    await expect(page.locator("[data-visual] button:disabled")).toHaveCount(0);
  });

  test("answering quiz questions records evidence and moves the trail, island and streak", async ({ page }) => {
    await page.goto("/quiz/logic-e2e/boolean-algebra");
    await answerShort(page, "x");
    await expect(page.getByText("Correct.")).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    await answerShort(page, "a + c");
    await expect(page.getByText("Correct.")).toBeVisible();

    const evidence = await storedEvidence(page);
    expect(evidence.map((e) => [e.questionId, e.objectiveId, e.outcome, e.grader])).toEqual([
      ["ba-1", "boolean-algebra/simplify", "correct", "exact"],
      ["ba-2", "boolean-algebra/simplify", "correct", "exact"],
    ]);
    expect(new Set(evidence.map((e) => e.sessionId)).size, "one session per quiz visit").toBe(1);

    await page.goto("/home");
    await expect(page.getByText("1 day streak")).toBeVisible();
    await expect(page.locator("[data-level]")).toHaveAttribute("data-level", "sprouting");

    await page.goto("/course/logic-e2e");
    const current = page.locator('[data-visual="current"]');
    await expect(current).toContainText("Boolean Algebra");
    await expect(current).toContainText("0 of 1 objectives mastered");
  });

  test("answers on two topics show progress on both trail nodes", async ({ page }) => {
    await page.goto("/quiz/logic-e2e/boolean-algebra");
    await answerShort(page, "x");
    await expect(page.getByText("Correct.")).toBeVisible();
    await page.goto("/quiz/logic-e2e/twos-complement");
    await answerShort(page, "1010");
    await expect(page.getByText("Correct.")).toBeVisible();

    const evidence = await storedEvidence(page);
    expect(evidence.map((e) => e.objectiveId)).toEqual(["boolean-algebra/simplify", "twos-complement/convert"]);
    expect(new Set(evidence.map((e) => e.sessionId)).size, "each quiz visit is its own session").toBe(2);

    await page.goto("/course/logic-e2e");
    for (const name of ["Boolean Algebra", "Two's Complement"]) {
      const label = page.locator('[data-part="label"]').filter({ hasText: name });
      await expect(label).toContainText(/\d+ of \d+ objectives mastered/);
    }
  });
});
