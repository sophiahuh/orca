import { expect, test } from "@playwright/test";
import { FIXTURE_STATE, STORAGE_KEY, seedState } from "./fixture";

const COURSE = "logic-e2e";
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const answer = (questionId: string, at: string) => ({
  kind: "answer",
  id: `${questionId}-${at}`,
  at,
  courseId: COURSE,
  topicId: "twos-complement",
  objectiveId: "twos-complement/convert",
  questionId,
  tier: null,
  outcome: "correct",
  grader: "exact",
  source: "quiz",
  sessionId: at.slice(0, 10),
});

test("a homework reflection sends the confirmed objectives back to learning", async ({ page }) => {
  await seedState(page, {
    ...FIXTURE_STATE,
    // "Convert" mastered: three questions answered right over two days.
    evidence: [answer("tc-1", daysAgo(3)), answer("tc-2", daysAgo(3)), answer("tc-3", daysAgo(2))],
    materials: [{ id: "hw1", courseId: COURSE, filename: "HW1.pdf", type: "Homework", assigned: null, due: null, reflect: true }],
  });
  await page.route("**/api/pipeline/reflect", async (route) => {
    const { input } = route.request().postDataJSON() as { input: { note: string; objectives: Array<{ id: string }> } };
    expect(input.note).toContain("sign");
    expect(input.objectives.map((o) => o.id)).toContain("twos-complement/convert");
    await route.fulfill({
      json: {
        output: {
          matches: [
            { objectiveId: "twos-complement/convert", sure: true, reasoning: "“converting negatives”" },
            { objectiveId: "twos-complement/sign-extend", sure: false, reasoning: "“sign stuff” might mean sign extension" },
            { objectiveId: "made-up", sure: true, reasoning: "not a real objective" },
          ],
        },
      },
    });
  });

  await page.goto(`/course/${COURSE}/objectives`);
  await expect(page.locator('[data-objective="Convert to 2\'s complement"]')).toContainText("Mastered");

  await page.goto(`/course/${COURSE}`);
  await page.getByRole("link", { name: "Reflect on HW1" }).click();
  await page.getByPlaceholder(/K-map groups/).fill("Converting negatives kept going wrong, and the sign stuff.");
  await page.getByRole("button", { name: "Find what this is about" }).click();

  const sure = page.locator('[data-match="Convert to 2\'s complement"] input');
  const unsure = page.locator('[data-match="Sign-extend a number"] input');
  await expect(sure).toBeChecked();
  await expect(unsure).not.toBeChecked();
  await expect(page.getByText("Not sure: check if this is right")).toBeVisible();
  await expect(page.locator("[data-match]")).toHaveCount(2);
  await page.getByRole("button", { name: "Save and practise 1 again" }).click();

  await expect(page).toHaveURL(new RegExp(`/course/${COURSE}$`));
  await expect(page.getByRole("link", { name: "Reflect on HW1" })).toHaveCount(0);
  await page.goto(`/course/${COURSE}/objectives`);
  await expect(page.locator('[data-objective="Convert to 2\'s complement"]')).toContainText("Learning");

  const state = await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key)!), STORAGE_KEY);
  expect(state.evidence.filter((e: { kind: string }) => e.kind === "confusion")).toMatchObject([
    { objectiveId: "twos-complement/convert", materialId: "hw1", note: "Converting negatives kept going wrong, and the sign stuff." },
  ]);
  expect(state.materials[0].reflection.objectiveIds).toEqual(["twos-complement/convert"]);
});
