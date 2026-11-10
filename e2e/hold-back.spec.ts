import type { Page } from "@playwright/test";
import { expect, stored, test } from "./fixture";
import { DECK_NAME, makeDeck } from "../tests/fixtures/pdf";
import { fakeCalls, fakeModel } from "./fake-model";

/**
 * Hold-back vault (docs/superpowers/specs/2026-11-10-cram-mode-contracts.md, section 5): a past or
 * practice exam is kept hidden for a practice test. Its upload maps objectives but writes no
 * questions, and a later flag top-up skips an objective taught only there, saying why.
 */
const DECK = { name: DECK_NAME, mimeType: "application/pdf", buffer: Buffer.from(makeDeck()) };
const anchor = { locator: "slide 12", excerpt: "x + xy = x" };

const EXAM = {
  topics: [
    { localId: "t1", existingId: null, name: "Boolean Algebra", summary: "Theorems.", slideStart: 2, slideEnd: 12 },
    { localId: "t2", existingId: null, name: "Karnaugh Maps", summary: "Grouping.", slideStart: 13, slideEnd: 18 },
  ],
  objectives: [
    { localId: "o1", existingId: null, topicRef: "t1", name: "Simplify with absorption", description: "", origin: "material", places: [anchor], emphasis: null },
    { localId: "o2", existingId: null, topicRef: "t2", name: "Group ones on a K-map", description: "", origin: "material", places: [anchor], emphasis: null },
    { localId: "o3", existingId: null, topicRef: "t2", name: "Use don't-cares", description: "", origin: "material", places: [anchor], emphasis: null },
  ],
  relations: [],
};

async function createCourse(page: Page, name: string) {
  await page.goto("/new-course");
  await page.getByPlaceholder("Advanced Logic Design").fill(name);
  await page.getByRole("button", { name: "Create Course" }).click();
  await expect(page).toHaveURL(/:\d+\/$/);
}

test("a practice exam is held back by default: its upload maps objectives but writes no questions, the card says Held back, and a flag top-up skips it with a reason", async ({ page, student }) => {
  test.setTimeout(120_000);
  await fakeModel({ extract: EXAM, perObjective: 2 });
  await createCourse(page, "Logic");

  await page.goto("/add-material");
  await page.locator("[data-part=file-input]").setInputFiles(DECK);
  await expect(page.locator("[data-part=file-size]")).toBeVisible();
  // The box follows the type: off for a lecture, on for a practice exam.
  const holdBack = page.locator("[data-part=hold-back]");
  await expect(holdBack).not.toBeChecked();
  await page.getByLabel("What kind of material is this?").selectOption("Practice exam");
  await expect(holdBack).toBeChecked();
  await page.getByRole("button", { name: "Add to course" }).click();

  await expect(page).toHaveURL(/\/course\/logic\/review\?run=/, { timeout: 30_000 });
  // Mapped, not written from: no warm-up either, so nothing was added and the generate step was never called.
  const summary = page.locator("[data-part=run-summary]");
  await expect(summary).toContainText("2 new topics, 3 new objectives, 0 existing objectives covered again.", { timeout: 60_000 });
  await expect(summary.locator("[data-part=held-back]")).toHaveText("Held back");
  await expect(summary).toContainText("1 item left out");
  const calls = await fakeCalls();
  expect(calls).not.toContain("generate");

  const state = await stored(page, student);
  const course = state.courses[0];
  expect(state.materials.map((m) => [m.filename, m.type, m.heldBack])).toEqual([[DECK_NAME, "Practice exam", true]]);
  expect(Object.keys(state.objectives[course.id])).toHaveLength(3);
  expect(Object.values(state.questionBank[course.id] ?? {}).flat()).toHaveLength(0);
  expect(state.runs).toEqual([expect.objectContaining({ kind: "upload", status: "done", questionsAdded: 0 })]);
  expect(state.runs[0].dropped.map((d) => d.reason)).toEqual(["skipped: the file is held back for a practice test, so Orca mapped its objectives but wrote nothing from it"]);

  // A flag on one of its objectives asks for questions; the top-up skips it, since the exam is its only material.
  await page.goto("/course/logic/objectives");
  const flag = page.locator("[data-part=flag-hard]").first();
  await flag.getByRole("button", { name: "This is hard" }).click();
  await expect(flag).toHaveText("In review");
  await expect
    .poll(async () => (await stored(page, student)).runs.filter((r) => r.kind === "top-up" && r.status === "done").flatMap((r) => r.dropped.map((d) => d.reason)), { timeout: 60_000 })
    .toEqual(["skipped: its material is held back for a practice test, so Orca writes nothing from it"]);
  const after = await stored(page, student);
  expect(Object.values(after.questionBank[course.id] ?? {}).flat()).toHaveLength(0);
  expect(await fakeCalls()).not.toContain("generate");
});
