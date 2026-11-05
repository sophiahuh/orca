import { COURSE_SLUG, expect, seedFixtureCourse, stored, test } from "./fixture";

/** Weak points first (docs/superpowers/specs/2026-11-04-weak-points-first-design.md): only flagged or missed objectives come due. */

test("nothing flagged: no quick review is due, the island and the course say so", async ({ page, student }) => {
  await seedFixtureCourse(student);
  await page.goto("/");
  await expect(page.locator('[data-part="island-note"]')).toHaveText("No weak spots flagged yet");
  await expect(page.getByText("Quick review ·")).toHaveCount(0);
  await page.goto(`/course/${COURSE_SLUG}`);
  await expect(page.getByText("No weak spots flagged yet")).toBeVisible();
  await expect(page.locator('[data-part="topic-ring"]')).toHaveCount(0);
});

test("This is hard on an objective makes it due, and its topic shows a ring", async ({ page, student }) => {
  await seedFixtureCourse(student);
  await page.goto(`/course/${COURSE_SLUG}/objectives`);
  const flag = page.locator('[data-part="flag-hard"]').first();
  await flag.getByRole("button", { name: "This is hard" }).click();
  await expect(flag).toHaveText("In review");
  await page.goto(`/course/${COURSE_SLUG}`);
  await expect(page.locator('[data-part="topic-ring"]')).toHaveCount(1);
  await expect(page.getByText("0 of 1 weak spots mastered")).toBeVisible();
  await expect(page.getByText("Quick review ·")).toBeVisible();
  const after = await stored(page, student);
  expect(after.evidence.filter((e) => e.kind === "confusion" && e.flagSource === "manual")).toHaveLength(1);
});

test("This topic is hard flags every objective in the topic", async ({ page, student }) => {
  await seedFixtureCourse(student);
  await page.goto(`/course/${COURSE_SLUG}`);
  await page.locator('[data-part="node"]').nth(1).click();
  await page.locator('[data-part="flag-topic"]').click();
  await expect(page.locator('[data-part="topic-ring"]')).toHaveCount(1);
  await expect(page.getByText("0 of 2 weak spots mastered")).toBeVisible();
});
