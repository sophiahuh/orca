import { expect, test, F, seedFixtureCourse, seedPages } from "./fixture";

/**
 * A material that was saved and read but never got a job (its request died before one was
 * recorded) shows on the Uploads tab as "not built yet" with Build, which starts the job.
 */
test("a saved material with no job is listed on the Uploads tab, and Build starts its job", async ({ page, student }) => {
  await seedFixtureCourse(student);
  await seedPages(student, { [F.material]: [{ n: 1, text: "Boolean algebra: x + xy = x by absorption. Two's complement: invert and add one." }] });
  await page.goto("/course/logic-e2e/review?tab=uploads");
  const card = page.locator('[data-part="unbuilt-card"]');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("L01_Fixture.pdf");
  await expect(card).toContainText("no topics or questions were built from it yet");
  await card.locator('[data-part="build-material"]').click();
  await expect(page).toHaveURL(/\/course\/logic-e2e\/review\?run=/);
  // The job it started is now the material's upload card; the "not built" card is gone.
  await expect(page.locator('[data-part="unbuilt-card"]')).toHaveCount(0);
});
