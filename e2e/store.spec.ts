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
  // …and the quiz's score isn't saved either: it would count answers that aren't in the record.
  await expect(page.locator('[data-part="save-error"]')).toHaveText(/some answers in this quiz couldn't be saved, so its score wasn't recorded|reloading your data/);
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.locator('[data-part="save-error"]')).toHaveCount(0);
  await page.unroute("**/api/evidence");
  // …nor in the database, and there is no finished session.
  const s = await stored(page, student);
  expect(s.evidence).toEqual([]);
  expect(s.results).toEqual([]);
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
      localStorage.setItem("orca:materialPages", JSON.stringify({ old: [{ n: 1, text: "kept in the browser before Task 6" }] }));
    }
  });
  await page.goto("/home");
  await expect(page.getByText("No islands yet.")).toBeVisible();
  expect(await page.evaluate(() => [localStorage.getItem("orca:v8"), localStorage.getItem("orca:v3"), localStorage.getItem("orca:materialPages")])).toEqual([null, null, null]);
});

test("an action taken while Orca reloads after a failed save is refused with its own message, not lost quietly", async ({ page, student }) => {
  await seedFixtureCourse(student);
  await page.goto(`/quiz/logic-e2e/${F.booleanAlgebra}`);
  // The first answer's save fails; the reload that follows is slowed down so the next action lands during it.
  await page.route("**/api/evidence", (route) => route.fulfill({ status: 500, json: { error: "the database is down" } }), { times: 1 });
  await page.route("**/rest/v1/rpc/my_data", async (route) => {
    await new Promise((r) => setTimeout(r, 2500));
    await route.continue();
  });
  await answerShort(page, "x");
  await expect(page.locator('[data-part="save-error"]')).toHaveText("Couldn't save: the database is down");
  await page.getByRole("button", { name: "Continue" }).click();
  await answerShort(page, "a + c");
  await expect(page.locator('[data-part="save-error"]')).toHaveText(/Orca is reloading your data after a save that failed; that change wasn't saved/);
  await page.unroute("**/rest/v1/rpc/my_data");
  await page.waitForFunction(() => document.documentElement.dataset.saving === "0");
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.locator('[data-part="save-error"]')).toHaveCount(0);
  const s = await stored(page, student);
  expect(s.evidence).toEqual([]);
});

test("reloading in the middle of a session keeps the answers given, and the rest is a fresh set that counts once", async ({ page, student }) => {
  await seedFixtureCourse(student);
  await page.route("**/api/llm/status", (route) => route.fulfill({ json: { serverModel: null } }));
  await page.goto("/session/logic-e2e?kind=quick");
  await expect(page.getByText("1 / 6")).toBeVisible();
  const first = (await page.locator("h1").first().textContent())!.trim();
  await answerShort(page, "0");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator("h1").first()).not.toHaveText(first);
  await answerShort(page, "0");
  await settled(page);
  let s = await stored(page, student);
  expect(s.evidence).toHaveLength(2);
  expect(s.results).toEqual([]);

  await page.reload();
  // The session is assembled again from what's recorded: the two answers stay, nothing is re-asked blindly.
  const count = await page.getByText(/^1 \/ \d+$/).textContent();
  const total = Number(/\/ (\d+)/.exec(count ?? "")?.[1] ?? 0);
  expect(total).toBeGreaterThan(0);
  for (let i = 0; i < total; i++) {
    await expect(page.getByPlaceholder("Type your answer")).toBeEnabled();
    await answerShort(page, "0");
    const finish = page.getByRole("button", { name: "Finish" });
    if (await finish.isVisible()) {
      await finish.click();
      break;
    }
    await page.getByRole("button", { name: "Continue" }).click();
  }
  await settled(page);
  s = await stored(page, student);
  expect(s.results).toHaveLength(1);
  expect(s.results[0].total).toBe(total);
  expect(s.evidence).toHaveLength(2 + total);
  // The abandoned run and the finished one are two sessions; nothing was counted twice.
  expect(new Set(s.evidence.map((e) => (e as { sessionId: string }).sessionId)).size).toBe(2);
});
