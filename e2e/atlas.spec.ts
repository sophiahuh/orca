import { F, FIXTURE_STATE, expect, seedState, test } from "./fixture";

/**
 * The Concept Atlas (Figma: 12 · Concept Atlas): a course's objectives on their unit rings and the
 * concept panel for a selected one, whose button starts the topic's quiz. Relations link topics
 * since 2026-10-06; the Atlas draws them once its nodes are topics.
 */
const SLUG = FIXTURE_STATE.courses[0].slug;

test("the atlas maps the course's concepts, and a selected concept opens its panel", async ({ page, student }) => {
  await seedState(student, FIXTURE_STATE);
  await page.goto(`/course/${SLUG}/atlas`);
  await expect(page.locator("[data-part=atlas-summary]")).toHaveText("LOG · 3 concepts across 2 units");
  await expect(page.locator("[data-part=concept]")).toHaveCount(3);
  await expect(page.locator("[data-part=unit-label]")).toHaveCount(2);
  // Nothing answered yet: every concept is not started, and the rail still shows what's due.
  await expect(page.locator("[data-part=concept][data-mastery=not-started]")).toHaveCount(3);
  await expect(page.getByRole("heading", { name: "Due today" })).toBeVisible();

  await page.locator(`[data-concept="${F.convert}"]`).click();
  const panel = page.locator("[data-part=concept-panel]");
  await expect(panel.getByRole("heading", { name: "Convert to 2's complement" })).toBeVisible();
  await expect(panel).toContainText("Unit 2 · Two's Complement");
  await expect(panel.locator("[data-part=concept-numbers]")).toHaveText("0% mastered · 0 of 3 questions");
  // The rest of the map dims (relations link topics now, so concepts have no links to light up).
  await expect(page.locator(`[data-concept="${F.signExtend}"]`)).toHaveCSS("opacity", "0.3");

  // Esc clears the selection.
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Due today" })).toBeVisible();

  // The one action starts the existing study flow: the unit's quiz.
  await page.locator(`[data-concept="${F.convert}"]`).click();
  await panel.locator("[data-part=review-concept]").click();
  await expect(page).toHaveURL(new RegExp(`/quiz/${SLUG}/${F.twosComplement}`));
});

test("the course page switches between Path and Atlas", async ({ page, student }) => {
  await seedState(student, FIXTURE_STATE);
  await page.goto(`/course/${SLUG}`);
  await page.locator("[data-part=atlas-switch]").getByRole("link", { name: "Atlas" }).click();
  await expect(page).toHaveURL(new RegExp(`/course/${SLUG}/atlas$`));
  await expect(page.getByRole("heading", { name: "Concept Atlas" })).toBeVisible();
  await page.locator("[data-part=atlas-switch]").getByRole("link", { name: "Path" }).click();
  await expect(page).toHaveURL(new RegExp(`/course/${SLUG}$`));
});
