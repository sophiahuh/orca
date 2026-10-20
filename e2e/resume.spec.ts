import type { Page } from "@playwright/test";
import { expect, test, FIXTURE_STATE, seedState, stored } from "./fixture";

/** Leaving a quick review partway and coming back offers to pick up where it left off. */
const SLUG = FIXTURE_STATE.courses[0].slug;
const bank = Object.values(FIXTURE_STATE.questionBank[FIXTURE_STATE.courses[0].id]).flat();
const answers = new Map(bank.map((q) => [q.prompt, q.exact![0]]));

async function answerOne(page: Page) {
  await expect(page.getByPlaceholder("Type your answer")).toBeEnabled();
  const prompt = (await page.locator("h1").first().textContent())!.trim();
  await page.getByPlaceholder("Type your answer").fill(answers.get(prompt)!);
  await page.getByRole("button", { name: "Check" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator("h1").first()).not.toHaveText(prompt);
}

test.beforeEach(async ({ student, page }) => {
  await seedState(student, FIXTURE_STATE);
  await page.route("**/api/llm/status", (route) => route.fulfill({ json: { serverModel: null } }));
});

test("a quick review left partway is offered again: Resume carries on, and finishing records one session", async ({ page, student }) => {
  await page.goto(`/session/${SLUG}?kind=quick`);
  await expect(page.getByText("1 / 6")).toBeVisible();
  await answerOne(page);
  await answerOne(page);
  await expect.poll(async () => (await student.db.from("session_progress").select("position, correct")).data).toEqual([{ position: 2, correct: 2 }]);

  await page.goto(`/course/${SLUG}`);
  await page.goto(`/session/${SLUG}?kind=quick`);
  await expect(page.locator("[data-part=resume-session]")).toContainText("2 of 6 questions done");
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByText("3 / 6")).toBeVisible();
  for (let i = 0; i < 3; i++) await answerOne(page);
  await expect(page.getByPlaceholder("Type your answer")).toBeEnabled();
  const prompt = (await page.locator("h1").first().textContent())!.trim();
  await page.getByPlaceholder("Type your answer").fill(answers.get(prompt)!);
  await page.getByRole("button", { name: "Check" }).click();
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByText("You answered 6 of 6 correctly.")).toBeVisible();
  await expect.poll(async () => (await stored(page, student)).results.map((r) => [r.mode, r.correct, r.total])).toEqual([["quick", 6, 6]]);
  await expect.poll(async () => (await student.db.from("session_progress").select("kind")).data).toEqual([]);
});

test("Start a new one drops the unfinished session", async ({ page, student }) => {
  await page.goto(`/session/${SLUG}?kind=quick`);
  await answerOne(page);
  await expect.poll(async () => (await student.db.from("session_progress").select("position")).data).toEqual([{ position: 1 }]);
  await page.goto(`/course/${SLUG}`);
  await page.goto(`/session/${SLUG}?kind=quick`);
  await page.getByRole("button", { name: "Start a new one" }).click();
  await expect.poll(async () => (await student.db.from("session_progress").select("position")).data).toEqual([]);
});
