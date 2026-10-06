import { expect, test, F, seedFixtureCourse, stored } from "./fixture";

/** The weight sliders save when the student lets go, not on every step (Phase 4 review). A course's weights are set from its page. */
test("dragging a course's weight slider saves once, on release, with the final value", async ({ page, student }) => {
  await seedFixtureCourse(student);
  await page.goto("/course/logic-e2e");
  await page.getByRole("button", { name: "LOG configurations" }).click();
  const slider = page.getByRole("dialog").getByRole("slider", { name: "Homework weight" });
  await expect(slider).toHaveValue("25");
  const saves: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "PATCH" && /\/rest\/v1\/courses/.test(r.url())) saves.push(r.postData() ?? "");
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
  await page.waitForFunction(() => document.documentElement.dataset.saving === "0");
  const final = Number(await slider.inputValue());
  expect(saves).toHaveLength(1);
  expect(saves[0]).toContain(`"homework":${final}`);
  const s = await stored(page, student);
  expect(s.weights[F.course].homework).toBe(final);
  // Letting go without moving saves nothing more.
  await slider.focus();
  await slider.blur();
  await page.waitForFunction(() => document.documentElement.dataset.saving === "0");
  expect(saves).toHaveLength(1);
});

test("Settings holds the defaults: a course created after changing them starts with them", async ({ page, student }) => {
  await page.goto("/settings");
  await expect(page.getByText("Defaults for new courses")).toBeVisible();
  const slider = page.getByRole("slider", { name: "Homework weight" });
  await slider.focus();
  await page.keyboard.press("End");
  await slider.blur();
  await page.waitForFunction(() => document.documentElement.dataset.saving === "0");
  const top = Number(await slider.inputValue());

  await page.goto("/new-course");
  await page.getByPlaceholder("Advanced Logic Design").fill("Signals");
  await page.getByRole("button", { name: "Create Course" }).click();
  await expect(page).toHaveURL(/\/home$/);
  const s = await stored(page, student);
  expect(s.defaultWeights?.homework).toBe(top);
  expect(s.weights[s.courses[0].id].homework).toBe(top);
});
