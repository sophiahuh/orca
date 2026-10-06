import { expect, test, F, seedFixtureCourse, stored } from "./fixture";

/** Course overrides live on their own page and do not persist until its explicit Save action. */
test("course settings save an override through their own API", async ({ page, student }) => {
  await seedFixtureCourse(student);
  await page.goto("/course/logic-e2e");
  await page.getByRole("link", { name: "LOG settings" }).click();
  await expect(page).toHaveURL(/\/course\/logic-e2e\/settings$/);
  const slider = page.getByRole("slider", { name: "Homework weight" });
  await expect(slider).toHaveValue("25");
  const saves: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "PUT" && /\/api\/course-settings$/.test(r.url())) saves.push(r.postData() ?? "");
  });
  // Let the screen's entrance animation finish before measuring where the thumb is.
  await slider.scrollIntoViewIfNeeded();
  await page.waitForTimeout(900);
  // A drag: press on the thumb, move right in several steps (each moves the value on screen), release once.
  const box = (await slider.boundingBox())!;
  const y = box.y + box.height / 2;
  const at = (fraction: number) => box.x + box.width * fraction;
  await page.mouse.move(at(0.25), y);
  await page.mouse.down();
  for (const f of [0.3, 0.35, 0.4, 0.45, 0.5, 0.55]) await page.mouse.move(at(f), y, { steps: 3 });
  const moved = Number(await slider.inputValue());
  expect(moved).toBeGreaterThan(25);
  expect(saves).toEqual([]);
  await page.mouse.up();
  await page.waitForTimeout(100);
  const final = Number(await slider.inputValue());
  expect(saves).toHaveLength(0);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status", { name: "Saved" })).toBeVisible();
  expect(saves).toHaveLength(1);
  expect(saves[0]).toContain(`"weights":{"homework":${final}`);
  const s = await stored(page, student);
  expect(s.weights[F.course].homework).toBe(final);
});

test("Settings holds the defaults: a course without its own settings follows them", async ({ page, student }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Default Review Settings" })).toBeVisible();
  const slider = page.getByRole("slider", { name: "Homework weight" });
  await slider.focus();
  await page.keyboard.press("End");
  await slider.blur();
  // Configuration pages save only on their explicit Save (33ca8b6); the defaults' button comes before the account card's.
  await page.getByRole("button", { name: "Save" }).first().click();
  await expect(page.getByRole("status", { name: "Saved" })).toBeVisible();
  await page.waitForFunction(() => (document.documentElement.dataset.saving ?? "0") === "0");
  const top = Number(await slider.inputValue());

  await page.goto("/new-course");
  await page.getByPlaceholder("Advanced Logic Design").fill("Signals");
  await page.getByRole("button", { name: "Create Course" }).click();
  await expect(page).toHaveURL(/\/home$/);
  const s = await stored(page, student);
  expect(s.defaultWeights?.homework).toBe(top);
  expect(s.weights[s.courses[0].id].homework).toBe(top);
  expect(s.weightOverrides[s.courses[0].id], "it inherits; it has no override of its own").toBeNull();
});
