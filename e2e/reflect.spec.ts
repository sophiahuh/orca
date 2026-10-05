import type { AnswerEvent } from "../src/lib/mastery/types";
import { expect, test, F, FIXTURE_STATE, daysAgo, ids, seedState, stored } from "./fixture";
import { fakeCalls, fakeModel } from "./fake-model";

const COURSE = "logic-e2e";
const hw = ids("material");
const answer = (questionId: string, at: string): AnswerEvent => ({
  kind: "answer",
  id: crypto.randomUUID(),
  at,
  courseId: F.course,
  topicId: F.twosComplement,
  objectiveId: F.convert,
  questionId,
  tier: null,
  outcome: "correct",
  grader: "exact",
  source: "quiz",
  sessionId: at.slice(0, 10),
});

test("a homework reflection sends the confirmed objectives back to learning", async ({ page, student }) => {
  await seedState(student, {
    ...FIXTURE_STATE,
    // "Convert" mastered: three questions answered right over two days.
    evidence: [answer(F.tc1, daysAgo(3)), answer(F.tc2, daysAgo(3)), answer(F.tc3, daysAgo(2))],
    materials: [...FIXTURE_STATE.materials, { id: hw.material, courseId: F.course, filename: "HW1.pdf", type: "Homework", assigned: null, due: null, reflect: true }],
  });
  // The fake API matches by objective name; the server sends it the course's live objectives.
  await fakeModel({
    reflect: {
      matches: [
        { name: "Convert to 2's complement", sure: true, reasoning: "“converting negatives”" },
        { name: "Sign-extend a number", sure: false, reasoning: "“sign stuff” might mean sign extension" },
      ],
    },
  });

  await page.goto(`/course/${COURSE}/objectives`);
  await expect(page.locator('[data-objective="Convert to 2\'s complement"]')).toContainText("Mastered");

  await page.goto(`/course/${COURSE}`);
  await page.getByRole("link", { name: "Reflect on HW1" }).click();
  await page.getByPlaceholder(/K-map groups/).fill("Converting negatives kept going wrong, and the sign stuff.");
  await page.getByRole("button", { name: "Find what this is about" }).click();
  await expect.poll(fakeCalls).toEqual(["reflect"]);

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

  const state = await stored(page, student);
  expect(state.evidence.filter((e) => e.kind === "confusion")).toMatchObject([
    { objectiveId: F.convert, materialId: hw.material, note: "Converting negatives kept going wrong, and the sign stuff." },
  ]);
  expect(state.materials.find((m) => m.id === hw.material)!.reflection!.objectiveIds).toEqual([F.convert]);
});
