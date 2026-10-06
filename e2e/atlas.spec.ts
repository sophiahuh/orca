import { F, FIXTURE_STATE, expect, seedState, test } from "./fixture";
import { fakeCalls, fakeModel } from "./fake-model";

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
  await expect(page.locator("[data-part=topic-tooltip]")).toContainText("Boolean Algebra · New");
  await expect(page.locator("[data-part=topic-tooltip]")).toContainText("Used in 1");
  await expect(page.locator("[data-part=edge-label]")).toHaveText("used in");

  await page.locator(`[data-topic="${F.booleanAlgebra}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/quiz/${SLUG}/${F.booleanAlgebra}`));
});

test("the course page switches between Path and Atlas", async ({ page, student }) => {
  await seedState(student, FIXTURE_STATE);
  await page.goto(`/course/${SLUG}`);
  await page.locator("[data-part=atlas-switch]").getByRole("link", { name: "Atlas" }).click();
  await expect(page).toHaveURL(new RegExp(`/course/${SLUG}/atlas$`));
  await expect(page.locator("[data-part=atlas-summary]")).toHaveText("2 topics · 0 connections");
  await page.locator("[data-part=atlas-switch]").getByRole("link", { name: "Path" }).click();
  await expect(page).toHaveURL(new RegExp(`/course/${SLUG}$`));
});

test("Find connections links the course's topics with the link step and draws them", async ({ page, student }) => {
  await seedState(student, FIXTURE_STATE);
  await fakeModel({ links: [{ from: "Boolean Algebra", to: "Two's Complement", type: "related" }] });
  await page.goto(`/course/${SLUG}/atlas`);
  await expect(page.locator("[data-part=edge]")).toHaveCount(0);
  await page.locator("[data-part=find-connections]").click();
  await expect(page.locator("[data-part=find-connections-result]")).toHaveText("Found 1 new connection.");
  await expect(page.locator("[data-part=edge][data-type=related]")).toHaveCount(1);
  await expect(page.locator("[data-part=atlas-summary]")).toHaveText("2 topics · 1 connection");
  expect(await fakeCalls()).toEqual(["link"]);
  // Asking again finds nothing new: the link it already has isn't added twice.
  await page.locator("[data-part=find-connections]").click();
  await expect(page.locator("[data-part=find-connections-result]")).toHaveText("No new connections found.");
  await expect(page.locator("[data-part=edge]")).toHaveCount(1);
});
