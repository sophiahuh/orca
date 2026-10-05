import type { Page } from "@playwright/test";
import { expect, test, F, seedFixtureCourse, settled, signIn, stored } from "./fixture";

/**
 * The store on Supabase: what one browser saves another browser of the same student sees; a save
 * that fails is undone and says so (an answer that couldn't be saved isn't counted); the old
 * localStorage state is cleared.
 */
async function answerShort(page: Page, text: string) {
  await page.getByPlaceholder("Type your answer").fill(text);
  await page.getByRole("button", { name: "Check" }).click();
}

test("a second browser signed into the same account sees the same courses and progress", async ({ page, student, browser, baseURL }) => {
  await seedFixtureCourse(student);
  await page.goto("/new-course");
  await page.getByPlaceholder("Advanced Logic Design").fill("Signal Processing");
  await page.getByRole("button", { name: "Create Course" }).click();
  await expect(page).toHaveURL(/\/home$/);

  await page.goto(`/quiz/logic-e2e/${F.booleanAlgebra}`);
  await answerShort(page, "x");
  await expect(page.getByText("Correct.")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await answerShort(page, "a + c");
  await expect(page.getByText("Correct.")).toBeVisible();
  await settled(page);

  const other = await browser.newContext({ viewport: { width: 1194, height: 834 } });
  try {
    await signIn(other, student.email, student.password, baseURL!);
    const second = await other.newPage();
    await second.goto("/home");
    await expect(second.locator("[data-level]")).toHaveCount(2);
    await expect(second.getByText("Signal Processing")).toBeVisible();
    await expect(second.getByText("1 day streak")).toBeVisible();
    await expect(second.locator("[data-level]").first()).toHaveAttribute("data-level", "sprouting");
    await second.goto("/course/logic-e2e/objectives");
    await expect(second.locator('[data-objective="Simplify an expression"]')).toContainText("Learning");
  } finally {
    await other.close();
  }
});

test("an answer that couldn't be saved is undone, says so, and isn't counted", async ({ page, student }) => {
  await seedFixtureCourse(student);
  await page.route("**/api/evidence", (route) => route.fulfill({ status: 500, json: { error: "the database is down" } }));
  await page.goto(`/quiz/logic-e2e/${F.booleanAlgebra}`);
  await answerShort(page, "x");
  await expect(page.getByText("Correct.")).toBeVisible();
  await expect(page.locator('[data-part="save-error"]')).toHaveText("Couldn't save: the database is down");
  await page.getByRole("button", { name: "Continue" }).click();
  await answerShort(page, "a + c");
  await page.getByRole("button", { name: "Finish" }).click();

  // Neither answer counts here (the streak is computed from the answers this browser holds)…
  await page.waitForFunction(() => document.documentElement.dataset.saving === "0");
  await expect(page.locator("div").filter({ hasText: /^0 daysStreak$/ })).toBeVisible();
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.locator('[data-part="save-error"]')).toHaveCount(0);
  await page.unroute("**/api/evidence");
  // …nor in the database; the finished session itself was saved.
  const s = await stored(page, student);
  expect(s.evidence).toEqual([]);
  expect(s.results.map((r) => r.mode)).toEqual(["topic"]);
  await page.goto("/home");
  await expect(page.getByText("0 day streak")).toBeVisible();
  await expect(page.locator("[data-level]")).toHaveAttribute("data-level", "uncharted");
});

test("the browser's old local state is removed", async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("seeded")) {
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("orca:v8", JSON.stringify({ courses: [{ id: "old" }] }));
      localStorage.setItem("orca:v3", "{}");
    }
  });
  await page.goto("/home");
  await expect(page.getByText("No islands yet.")).toBeVisible();
  expect(await page.evaluate(() => [localStorage.getItem("orca:v8"), localStorage.getItem("orca:v3")])).toEqual([null, null]);
});
