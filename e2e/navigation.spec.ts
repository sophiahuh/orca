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

/** Account Settings open from the avatar in the top bar (no separate gear there); a course's sidebar gear opens its own settings. */
test("the avatar opens account Settings; a course's gear opens that course's settings", async ({ page }) => {
  await page.goto("/");
  const topBar = page.locator("[data-part=top-bar]");
  await expect(topBar.getByRole("link", { name: "Settings" })).toHaveCount(1);
  await topBar.locator("[data-part=avatar-settings]").click();
  await expect(page).toHaveURL(/\/settings$/);
  await page.goto(`/course/${SLUG}`);
  await page.getByRole("link", { name: `${FIXTURE_STATE.courses[0].short} settings` }).click();
  await expect(page).toHaveURL(new RegExp(`/course/${SLUG}/settings$`));
});
