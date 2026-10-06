import { expect, F, FIXTURE_STATE, seedState, stored, test } from "./fixture";

/** Edit Exams on a course page: add, rename, move, scope to topics and delete a course's exams (the exams table); the calendar follows. */
const SLUG = FIXTURE_STATE.courses[0].slug;
const inDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

test("a course's exams are added, listed by date, renamed, moved and deleted, and the calendar follows", async ({ page, student }) => {
  await seedState(student, FIXTURE_STATE);
  await page.goto(`/course/${SLUG}`);
  await page.locator("[data-part=edit-exams]").click();
  const modal = page.locator("[data-part=exams-modal]");
  await expect(modal).toContainText("No exams yet.");

  await modal.getByLabel("New exam name").fill("Final");
  await modal.getByLabel("New exam date").fill(inDays(20));
  // The topics it covers are optional; this one covers Boolean Algebra.
  await modal.locator("form").getByRole("button", { name: "Boolean Algebra" }).click();
  await modal.getByRole("button", { name: "Add New Exam" }).click();
  await modal.getByLabel("New exam name").fill("Midterm");
  await modal.getByLabel("New exam date").fill(inDays(5));
  await modal.getByRole("button", { name: "Add New Exam" }).click();
  // Chronological, whatever order they were added in.
  await expect(modal.locator("[data-part=exam]").getByLabel("Exam name").first()).toHaveValue("Midterm");
  await expect(modal.locator("[data-part=exam]").getByLabel("Exam name").nth(1)).toHaveValue("Final");

  const midterm = modal.locator("[data-part=exam]").first();
  await midterm.getByLabel("Exam name").fill("Midterm 1");
  await midterm.getByLabel("Exam name").press("Enter");
  await midterm.getByLabel("Exam date").fill(inDays(6));
  await midterm.getByRole("button", { name: "Two's Complement" }).click();
  let exams = (await stored(page, student)).exams;
  expect(exams.find((e) => e.title === "Final")!.topicIds).toEqual([F.booleanAlgebra]);
  await modal.getByRole("button", { name: "Delete Final" }).click();
  await expect(modal.locator("[data-part=exam]")).toHaveCount(1);

  exams = (await stored(page, student)).exams;
  expect(exams.map((e) => [e.title, e.date, e.courseId, e.topicIds])).toEqual([["Midterm 1", inDays(6), F.course, [F.twosComplement]]]);

  await page.keyboard.press("Escape");
  await page.goto("/calendar");
  await expect(page.locator('[data-part="event"]', { hasText: "Midterm 1" })).toHaveCount(1);
});
