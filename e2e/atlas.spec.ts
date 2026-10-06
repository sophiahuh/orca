import { F, FIXTURE_STATE, expect, seedState, test } from "./fixture";

/**
 * The Concept Atlas (Figma: 12 · Concept Atlas): a course's objectives on their unit rings, its
 * relations drawn between them, and the concept panel for a selected one, whose button starts
 * the topic's quiz. Seeds the fixture course plus one relation.
 */
const SLUG = FIXTURE_STATE.courses[0].slug;

test("the atlas maps the course's concepts and connections, and a selected concept opens its panel", async ({ page, student }) => {
  await seedState(student, {
    ...FIXTURE_STATE,
    relations: { [F.course]: [{ id: crypto.randomUUID(), from: F.convert, to: F.simplify, type: "builds-on", anchor: null, review: "confirmed", materialId: F.material }] },
  });
  await page.goto(`/course/${SLUG}/atlas`);
  await expect(page.locator("[data-part=atlas-summary]")).toHaveText("LOG · 3 concepts across 2 units");
  await expect(page.locator("[data-part=concept]")).toHaveCount(3);
  await expect(page.locator("[data-part=unit-label]")).toHaveCount(2);
  await expect(page.locator("[data-part=link][data-kind=prerequisite]")).toHaveCount(1);
  // Nothing answered yet: every concept is not started, and the rail still shows what's due.
  await expect(page.locator("[data-part=concept][data-mastery=not-started]")).toHaveCount(3);
  await expect(page.getByRole("heading", { name: "Due today" })).toBeVisible();

  await page.locator(`[data-concept="${F.convert}"]`).click();
  const panel = page.locator("[data-part=concept-panel]");
  await expect(panel.getByRole("heading", { name: "Convert to 2's complement" })).toBeVisible();
  await expect(panel).toContainText("Unit 2 · Two's Complement");
  await expect(panel.locator("[data-part=concept-numbers]")).toHaveText("0% mastered · 0 of 3 questions");
  await expect(panel.locator("[data-part=connection]")).toHaveCount(1);
  await expect(panel.locator("[data-part=connection]")).toContainText("Simplify an expression");
  await expect(panel.locator("[data-part=connection]")).toContainText("Prerequisite");
  // The rest of the map dims; the connected concept stays lit.
  await expect(page.locator(`[data-concept="${F.signExtend}"]`)).toHaveCSS("opacity", "0.3");
  await expect(page.locator(`[data-concept="${F.simplify}"]`)).toHaveCSS("opacity", "1");

  // A connection in the panel selects that concept; Esc clears everything.
  await panel.locator("[data-part=connection]").click();
  await expect(panel.getByRole("heading", { name: "Simplify an expression" })).toBeVisible();
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
