import type { AnswerEvent } from "../src/lib/mastery/types";
import { expect, test, FIXTURE_STATE, seedState } from "./fixture";

/** Thumbs up / down on questions: saved per student, and a thumbs down before answering skips the question. */
const SLUG = FIXTURE_STATE.courses[0].slug;
const bank = Object.values(FIXTURE_STATE.questionBank[FIXTURE_STATE.courses[0].id]).flat();
const answers = new Map(bank.map((q) => [q.prompt, q.exact![0]]));

test.beforeEach(async ({ student, page }) => {
  await seedState(student, FIXTURE_STATE);
  await page.route("**/api/llm/status", (route) => route.fulfill({ json: { serverModel: null } }));
});

test("a thumbs down before answering opens the popup (reason and note), skips the question without recording an answer, and is saved", async ({ page, student }) => {
  await page.goto(`/session/${SLUG}?kind=quick`);
  await expect(page.getByPlaceholder("Type your answer")).toBeEnabled();
  const first = (await page.locator("h1").first().textContent())!.trim();
  await page.getByRole("button", { name: "Flag as a bad question" }).click();
  const dialog = page.locator("[data-part=flag-dialog]");
  await dialog.getByRole("button", { name: "Unclear" }).click();
  await dialog.getByPlaceholder(/The key says/).fill("It never says how many bits to use.");
  await dialog.getByRole("button", { name: "Save and skip" }).click();
  await expect(page.locator("h1").first()).not.toHaveText(first);
  await expect.poll(async () => (await student.db.from("question_feedback").select("question_id, rating, reason, note")).data).toEqual([
    { question_id: bank.find((q) => q.prompt === first)!.id, rating: "down", reason: "unclear", note: "It never says how many bits to use." },
  ]);
  const { data: evidence } = await student.db.from("evidence_events").select("question_id");
  expect((evidence ?? []).map((e) => e.question_id)).not.toContain(bank.find((q) => q.prompt === first)!.id);
});

test("after answering, a thumbs up is saved; tapping it again clears it", async ({ page, student }) => {
  await page.goto(`/session/${SLUG}?kind=quick`);
  await expect(page.getByPlaceholder("Type your answer")).toBeEnabled();
  const prompt = (await page.locator("h1").first().textContent())!.trim();
  await page.getByPlaceholder("Type your answer").fill(answers.get(prompt)!);
  await page.getByRole("button", { name: "Check" }).click();
  await page.getByRole("button", { name: "Good question" }).click();
  await expect.poll(async () => (await student.db.from("question_feedback").select("rating")).data).toEqual([{ rating: "up" }]);
  await page.getByRole("button", { name: "Good question" }).click();
  await expect.poll(async () => (await student.db.from("question_feedback").select("rating")).data).toEqual([]);
  const { data: evidence } = await student.db.from("evidence_events").select("kind");
  expect((evidence as Array<Pick<AnswerEvent, "kind">>).length).toBe(1);
});
