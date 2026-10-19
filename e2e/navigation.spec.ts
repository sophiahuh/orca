import type { Page } from "@playwright/test";
import { expect, test, FIXTURE_STATE, seedState } from "./fixture";

/** Back buttons go to the page the student came from; opened directly, to the page they sit under. */
const SLUG = FIXTURE_STATE.courses[0].slug;
const back = (page: Page) => page.getByRole("link", { name: "Back", exact: true }).first().click();

test.beforeEach(async ({ student }) => seedState(student, FIXTURE_STATE));

test("Back returns to the page you came from, not a fixed one", async ({ page }) => {
  await page.goto(`/course/${SLUG}`);
  // The calendar sits under the courses map, but it was opened from this course: Back comes here.
  await page.getByRole("link", { name: "Calendar", exact: true }).click();
  await expect(page).toHaveURL(/\/calendar$/);
  await back(page);
  await expect(page).toHaveURL(new RegExp(`/course/${SLUG}$`));
});

test("opened directly, Back goes to the page it sits under", async ({ page }) => {
  await page.goto(`/course/${SLUG}/objectives`);
  await back(page);
  await expect(page).toHaveURL(new RegExp(`/course/${SLUG}$`));
  // The course page took the objectives page's place, so Back from it doesn't return there: it has no
  // earlier page either, so it goes to the map.
  await back(page);
  await expect(page).toHaveURL(/:\d+\/$/);
});
