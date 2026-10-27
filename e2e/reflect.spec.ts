import path from "node:path";
import type { AnswerEvent } from "../src/lib/mastery/types";
import { expect, test, F, FIXTURE_STATE, daysAgo, seedState, stored } from "./fixture";
import { fakeCalls, fakeModel } from "./fake-model";

const COURSE = "logic-e2e";
const DECK = path.join(process.cwd(), "docs/samples/ald/L02_Combinational.pdf");
const NOTE = "Converting negatives kept going wrong, and the sign stuff.";
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

test("a homework upload's reflection sends the objectives Orca is sure of back to learning", async ({ page, student }) => {
  await seedState(student, {
    ...FIXTURE_STATE,
    // "Convert" mastered: three questions answered right over two days.
    evidence: [answer(F.tc1, daysAgo(3)), answer(F.tc2, daysAgo(3)), answer(F.tc3, daysAgo(2))],
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

  await page.goto("/add-material");
  await page.locator('input[type="file"]').setInputFiles(DECK);
  // The reflection is asked for homework only.
  await expect(page.getByPlaceholder(/K-map groups/)).toHaveCount(0);
  await page.getByLabel("What kind of material is this?").selectOption("Homework");
  await page.getByPlaceholder(/K-map groups/).fill(NOTE);
  await page.getByRole("button", { name: "Add to course" }).click();
  await expect(page).toHaveURL(/\/review\?run=/, { timeout: 30_000 });
  expect(await fakeCalls()).toContain("reflect");

  await page.goto(`/course/${COURSE}/objectives`);
  await expect(page.locator('[data-objective="Convert to 2\'s complement"]')).toContainText("Learning");

  const state = await stored(page, student);
  const homework = state.materials.find((m) => m.type === "Homework")!;
  expect(homework.reflect).toBe(true);
  expect(state.evidence.filter((e) => e.kind === "confusion")).toMatchObject([{ objectiveId: F.convert, materialId: homework.id, note: NOTE }]);
  expect(homework.reflection).toMatchObject({ note: NOTE, objectiveIds: [F.convert] });
});

test("a reflection Orca can't match is still saved, and says why", async ({ page, student }) => {
  await seedState(student, FIXTURE_STATE);
  await fakeModel({ fail: { step: "reflect", status: 400, message: "bad request" } });

  await page.goto("/add-material");
  await page.locator('input[type="file"]').setInputFiles(DECK);
  await page.getByLabel("What kind of material is this?").selectOption("Homework");
  await page.getByPlaceholder(/K-map groups/).fill(NOTE);
  await page.getByRole("button", { name: "Add to course" }).click();
  await expect(page.getByText(/Saved your reflection, but Orca couldn't match it to objectives/)).toBeVisible({ timeout: 30_000 });

  const state = await stored(page, student);
  expect(state.evidence.filter((e) => e.kind === "confusion")).toHaveLength(0);
  expect(state.materials.find((m) => m.type === "Homework")!.reflection).toMatchObject({ note: NOTE, objectiveIds: [] });
});
