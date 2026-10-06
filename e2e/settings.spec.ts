import { expect, test, F, seedFixtureCourse, stored } from "./fixture";

/** The weight sliders save when the student lets go, not on every step (Phase 4 review). */
test("dragging a weight slider saves once, on release, with the final value", async ({ page, student }) => {
  await seedFixtureCourse(student);
  await page.goto("/settings");
  const slider = page.getByRole("slider", { name: "Homework weight" });
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
