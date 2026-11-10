import type { Page } from "@playwright/test";
import { expect, test, FIXTURE_STATE, seedState, stored } from "./fixture";

/** Onboarding tips: the orca points at what to do next; arrows move through them; skipped or seen, they stay gone. */
test.use({ tips: true });

const SLUG = FIXTURE_STATE.courses[0].slug;
const tip = (page: Page) => page.locator("[data-part=orca-tip]");
/** Longer than two of the engine's checks (400 ms each): time enough for a tip to have shown. */
const WOULD_HAVE_SHOWN_MS = 1200;

test("a new student is pointed at Add Course, with the rest of the page muted; doing it moves on", async ({ page, student }) => {
  await page.goto("/");
  await expect(tip(page)).toHaveAttribute("data-tip", "add-course");
  await expect(tip(page)).toContainText("Add your first one");
  await expect(page.locator("[data-part=spotlight-dim]")).toBeVisible();
  await expect(page.locator("[data-part=spotlight-ring]")).toBeVisible();
  // The muted page still works: the button the tip points at is clicked through it.
  await page.locator("[data-part=add-course]").click();
  await expect(page).toHaveURL(/\/new-course$/);
  await expect(tip(page)).toHaveAttribute("data-tip", "canvas-import");
  expect((await stored(page, student)).onboarding).toEqual({ seen: ["add-course"], skipped: false });
});

test("the arrow keys move through a page's tips and back; seen tips don't return", async ({ page, student }) => {
  await seedState(student, FIXTURE_STATE);
  await page.goto(`/course/${SLUG}`);
  await expect(tip(page)).toHaveAttribute("data-tip", "course-settings");
  await expect(page.locator("[data-part=tip-count]")).toContainText("1 of");
  await expect(page.locator("[data-part=tip-back]")).toHaveCount(0);
  await expect(page.locator("[data-part=tip-next] kbd")).toHaveText("→");

  await page.keyboard.press("ArrowRight");
  await expect(tip(page)).toHaveAttribute("data-tip", "weak-count");
  await expect(page.locator("[data-part=tip-back] kbd")).toHaveText("←");
  await page.keyboard.press("ArrowLeft");
  await expect(tip(page)).toHaveAttribute("data-tip", "course-settings");
  await page.locator("[data-part=tip-next]").click();
  await expect(tip(page)).toHaveAttribute("data-tip", "weak-count");
  // The X dismisses just this tip; the next one follows.
  await page.locator("[data-part=tip-dismiss]").click();
  await expect(tip(page)).toHaveAttribute("data-tip", "atlas-switch");

  // Through the rest of this page's tips.
  for (let i = 0; i < 8 && (await tip(page).count()) > 0; i++) {
    const id = await tip(page).getAttribute("data-tip");
    await page.keyboard.press("ArrowRight");
    // The next tip, or none after the last.
    await expect.poll(async () => ((await tip(page).count()) ? tip(page).getAttribute("data-tip") : null)).not.toBe(id);
  }
  await expect(tip(page)).toHaveCount(0);
  const seen = (await stored(page, student)).onboarding.seen;
  expect(seen).toEqual(expect.arrayContaining(["course-settings", "weak-count", "atlas-switch", "edit-exams"]));

  await page.reload();
  await expect(page.locator("[data-part=weak-count]")).toBeVisible();
  await page.waitForTimeout(WOULD_HAVE_SHOWN_MS);
  await expect(tip(page)).toHaveCount(0);
});

test("the arrow keys are left alone while typing", async ({ page, student }) => {
  await seedState(student, FIXTURE_STATE);
  await page.goto(`/course/${SLUG}`);
  await expect(tip(page)).toHaveAttribute("data-tip", "course-settings");
  await page.getByRole("textbox", { name: "Course name" }).click();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
  await expect(tip(page)).toHaveAttribute("data-tip", "course-settings");
});

test("Skip all tips asks first, then no tip shows again", async ({ page, student }) => {
  await page.goto("/");
  await expect(tip(page)).toHaveAttribute("data-tip", "add-course");
  await page.locator("[data-part=tip-skip]").click();
  await expect(page.locator("[data-part=tip-skip-confirm]")).toContainText("They won't come back");
  await page.locator("[data-part=tip-skip-no]").click();
  await expect(tip(page)).toHaveAttribute("data-tip", "add-course");

  await page.locator("[data-part=tip-skip]").click();
  await page.locator("[data-part=tip-skip-yes]").click();
  await expect(tip(page)).toHaveCount(0);
  await expect(page.locator("[data-part=spotlight-dim]")).toHaveCount(0);
  expect((await stored(page, student)).onboarding.skipped).toBe(true);

  await page.goto("/new-course");
  await expect(page.getByRole("heading", { name: /What are you/ })).toBeVisible();
  await page.waitForTimeout(WOULD_HAVE_SHOWN_MS);
  await expect(tip(page)).toHaveCount(0);
});
