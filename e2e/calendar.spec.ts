import { expect, F, FIXTURE_STATE, seedState, test } from "./fixture";

/** The calendar: "+n more" expands that week to show everything; the course filter shows one course's entries. */
const day = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
})();

test("+n more expands the week, and Filter by course narrows the calendar to one course", async ({ page, student }) => {
  const other = { ...FIXTURE_STATE.courses[0], id: crypto.randomUUID(), slug: "signals", name: "Signals and Systems", short: "SIG", topics: [] };
  const exam = (title: string, courseId: string) => ({ id: crypto.randomUUID(), date: day, kind: "exam" as const, title, courseId });
  await seedState(student, {
    ...FIXTURE_STATE,
    courses: [...FIXTURE_STATE.courses, other],
    events: [exam("Logic quiz 1", F.course), exam("Logic quiz 2", F.course), exam("Logic quiz 3", F.course), exam("Signals midterm", other.id)],
  });
  await page.goto("/calendar");
  const today = page.locator("[data-today]");
  // Four exams plus today's quick review for the fixture course: two show, the rest fold away.
  await expect(today.locator("[data-part=event]")).toHaveCount(2);
  await today.locator("[data-part=more]").click();
  await expect(today.locator("[data-part=event]")).toHaveCount(5);
  await expect(today.locator("[data-part=more]")).toHaveText("Show less");

  await page.getByLabel("Filter by course").selectOption({ label: "Signals and Systems" });
  await expect(page.locator("[data-part=event]")).toHaveText(["Signals midterm"]);
  await page.getByLabel("Filter by course").selectOption({ label: "All courses" });
  await expect(today.locator("[data-part=event]")).toHaveCount(5);
});
