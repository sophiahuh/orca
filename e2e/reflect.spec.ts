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

test("a reflection whose saves half-fail can be saved again without recording the same confusion twice", async ({ page, student }) => {
  await seedState(student, {
    ...FIXTURE_STATE,
    materials: [...FIXTURE_STATE.materials, { id: hw.material, courseId: F.course, filename: "HW1.pdf", type: "Homework", assigned: null, due: null, reflect: true }],
  });
  await fakeModel({
    reflect: {
      matches: [
        { name: "Convert to 2's complement", sure: true, reasoning: "converting" },
        { name: "Sign-extend a number", sure: true, reasoning: "sign extension" },
      ],
    },
  });
  // The second confusion event's save fails once; the first has landed.
  let posts = 0;
  await page.route("**/api/evidence", async (route) => {
    posts += 1;
    if (posts === 2) await route.fulfill({ status: 500, json: { error: "the database is down" } });
    else await route.continue();
  });
  const reflect = async () => {
    await page.goto(`/course/${COURSE}`);
    await page.getByRole("link", { name: "Reflect on HW1" }).click();
    await page.getByPlaceholder(/K-map groups/).fill("Converting negatives and sign extension both went wrong.");
    await page.getByRole("button", { name: "Find what this is about" }).click();
    await expect(page.locator("[data-match]")).toHaveCount(2);
    await page.getByRole("button", { name: "Save and practise 2 again" }).click();
  };
  await reflect();
  await expect(page.locator('[data-part="save-error"]')).toContainText("Couldn't save: the database is down");
  await page.waitForFunction(() => document.documentElement.dataset.saving === "0");
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.locator('[data-part="save-error"]')).toHaveCount(0);
  let state = await stored(page, student);
  expect(state.evidence.filter((e) => e.kind === "confusion")).toHaveLength(1);
  expect(state.materials.find((m) => m.id === hw.material)!.reflection).toBeUndefined();

  // Saving again sends the same event ids: the one already recorded is refused as a duplicate and
  // treated as done; the other is recorded. Two confusion events, not three.
  await reflect();
  await expect(page).toHaveURL(new RegExp(`/course/${COURSE}$`));
  await expect(page.getByRole("link", { name: "Reflect on HW1" })).toHaveCount(0);
  state = await stored(page, student);
  const confusion = state.evidence.filter((e) => e.kind === "confusion");
  expect(confusion.map((e) => e.objectiveId).sort()).toEqual([F.convert, F.signExtend].sort());
  expect(new Set(confusion.map((e) => e.id)).size).toBe(2);
  expect(state.materials.find((m) => m.id === hw.material)!.reflection!.objectiveIds.sort()).toEqual([F.convert, F.signExtend].sort());
  expect(posts).toBe(4);
});
