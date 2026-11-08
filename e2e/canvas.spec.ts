import { expect, test, F } from "./fixture";

/**
 * Canvas import, browser side. The server's own checks run for real (the site must be https and
 * reachable); the Canvas-backed answers are played back by routing Orca's own API, since no Canvas
 * site is reachable from a test (the server module is tested in tests/canvas/ and by a smoke run).
 */

test("Settings → Canvas refuses a site Orca can't send a token to, with the reason", async ({ page }) => {
  await page.goto("/settings");
  const card = page.locator('[data-part="canvas-connection"]');
  await card.locator('[data-part="canvas-site"]').fill("http://canvas.test");
  await card.locator('[data-part="canvas-token"]').fill("7~abcdefghijklmnopqrstuvwxyz0123456789");
  await card.locator('[data-part="canvas-connect"]').click();
  await expect(card.getByRole("alert")).toHaveText(/https address with no path/);
  await card.locator('[data-part="canvas-site"]').fill("https://canvas.invalid");
  await card.locator('[data-part="canvas-connect"]').click();
  await expect(card.getByRole("alert")).toHaveText(/isn't a Canvas site Orca can reach/);
  await expect(card.locator('[data-part="canvas-connect"]')).toBeEnabled();
});

test("connected, Settings says who, and offers the import; the import page lists courses and imports one", async ({ page }) => {
  // Orca's Canvas routes, as they'd answer with a connected account.
  await page.route("**/api/canvas", (route) => route.fulfill({ json: { connected: true, baseUrl: "https://courseworks2.columbia.edu", canvasUser: "Sophia Test", lastUsedAt: null } }));
  await page.route("**/api/canvas/courses", (route) =>
    route.fulfill({ json: { courses: [{ id: "77", name: "Logic Fixture", code: "ELEN 3331", term: "Fall 2026", linkedCourseId: null }, { id: "78", name: "Signals", code: "ELEN 3801", term: "Fall 2026", linkedCourseId: null }] } }),
  );
  const imports: string[] = [];
  await page.route("**/api/canvas/import", (route) => {
    imports.push(route.request().postData() ?? "");
    return route.fulfill({
      json: {
        course: { id: F.course, slug: "logic-e2e", name: "Logic Fixture", created: false },
        exams: 1,
        events: 2,
        syllabus: true,
        files: { added: 2, duplicates: 0, failed: 0, skipped: 1, remaining: 0, skippedNames: ["Old scan.pdf"], total: 3 },
      },
    });
  });

  await page.goto("/settings");
  const card = page.locator('[data-part="canvas-connection"]');
  await expect(card.locator('[data-part="canvas-status"]')).toHaveText(/Connected as Sophia Test/);
  await card.locator('[data-part="canvas-import-link"]').click();
  await expect(page).toHaveURL(/\/import\/canvas$/);

  const courses = page.locator('[data-part="canvas-course"]');
  await expect(courses).toHaveCount(2);
  await expect(courses.first()).toContainText("ELEN 3331 · Fall 2026");
  await courses.first().locator('[data-part="canvas-import"]').click();
  await expect(courses.first().locator('[data-part="canvas-summary"]')).toHaveText(/Updated Logic Fixture · 1 exam · 2 assignments on the calendar · syllabus · files: 2 added, 1 skipped \(Old scan\.pdf\)\./);
  expect(imports).toEqual([JSON.stringify({ canvasCourseId: "77" })]);
  await expect(courses.first().locator('[data-part="canvas-import"]')).toHaveText("Update");
});

test("the import page says when Canvas isn't connected", async ({ page }) => {
  await page.goto("/import/canvas");
  await expect(page.locator('[data-part="canvas-not-connected"]')).toBeVisible();
  await page.locator('[data-part="canvas-not-connected"]').getByRole("link", { name: "Connect it in Settings" }).click();
  await expect(page).toHaveURL(/\/settings$/);
});

test("New course offers the Canvas import", async ({ page }) => {
  await page.goto("/new-course");
  await page.locator('[data-part="import-from-canvas"]').click();
  await expect(page).toHaveURL(/\/import\/canvas$/);
});
