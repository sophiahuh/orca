import { F, FIXTURE_STATE, expect, seedState, test } from "./fixture";

/**
 * The Concept Atlas (Figma: E1/E2 · Concept graph v4): the course's topics as nodes, its topic
 * relations as edges, foundations on top; hovering a topic lights its edges and shows a tooltip,
 * clicking opens its quiz.
 */
const SLUG = FIXTURE_STATE.courses[0].slug;

test("the atlas draws topics and their links, foundations on top; hovering explains a topic and clicking opens it", async ({ page, student }) => {
  await seedState(student, {
    ...FIXTURE_STATE,
    relations: { [F.course]: [{ id: crypto.randomUUID(), from: F.booleanAlgebra, to: F.twosComplement, type: "used-in", anchor: null, review: "proposed", materialId: F.material }] },
  });
  await page.goto(`/course/${SLUG}/atlas`);
  await expect(page.locator("[data-part=atlas-summary]")).toHaveText("2 topics · 1 connection");
  await expect(page.locator("[data-part=topic]")).toHaveCount(2);
  await expect(page.locator("[data-part=edge][data-type=used-in]")).toHaveCount(1);
  // Nothing answered yet: both unverified. The topic used in another sits above it.
  await expect(page.locator("[data-part=topic][data-strength=unverified]")).toHaveCount(2);
  const top = await page.locator(`[data-topic="${F.booleanAlgebra}"]`).boundingBox();
  const below = await page.locator(`[data-topic="${F.twosComplement}"]`).boundingBox();
  expect(top!.y).toBeLessThan(below!.y);
  await expect(page.getByRole("heading", { name: "Due today" })).toBeVisible();

  await page.locator(`[data-topic="${F.booleanAlgebra}"]`).hover();
  await expect(page.locator("[data-part=topic-tooltip]")).toContainText("Boolean Algebra · Unverified");
  await expect(page.locator("[data-part=topic-tooltip]")).toContainText("Used in 1 · click to open");
  await expect(page.locator("[data-part=edge-label]")).toHaveText("used in");

  await page.locator(`[data-topic="${F.booleanAlgebra}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/quiz/${SLUG}/${F.booleanAlgebra}`));
});

test("the course page switches between Path and Atlas", async ({ page, student }) => {
  await seedState(student, FIXTURE_STATE);
  await page.goto(`/course/${SLUG}`);
  await page.locator("[data-part=atlas-switch]").getByRole("link", { name: "Atlas" }).click();
  await expect(page).toHaveURL(new RegExp(`/course/${SLUG}/atlas$`));
  await expect(page.locator("[data-part=atlas-summary]")).toHaveText("2 topics · 0 connections · upload more material to connect them");
  await page.locator("[data-part=atlas-switch]").getByRole("link", { name: "Path" }).click();
  await expect(page).toHaveURL(new RegExp(`/course/${SLUG}$`));
});
