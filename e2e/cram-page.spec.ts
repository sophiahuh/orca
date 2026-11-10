import { admin, expect, F, FIXTURE_STATE, fixtureMaterial, seedState, stored, test } from "./fixture";

/**
 * The cram page (cram mode contract, section 6): setup asks for the time budget (hours, days out)
 * beside the professor's words and worries; Confirm stores cramming and the budget and shows the
 * plan: the budget, the line, the topic rows with their verified share and weak spots, today, the
 * practice test status, the vault by name, Edit scope and Stop cramming. The plan is computed in
 * the browser from the store; nothing about it is stored.
 */
const SLUG = FIXTURE_STATE.courses[0].slug;
const inDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const PAST_EXAM = "Midterm 2024.pdf";

test("setup takes 6 hours with one day out; the page then shows the budget, the topic rows, the line, the vault, and Stop cramming", async ({ page, student }) => {
  // The fixture course plus a past exam held back for a practice test (listed in the vault by name).
  const pastExam = { ...fixtureMaterial(F.course), id: crypto.randomUUID(), filename: PAST_EXAM, type: "Past exam" as const, heldBack: true };
  await seedState(student, { ...FIXTURE_STATE, materials: [...FIXTURE_STATE.materials, pastExam] });
  const examId = crypto.randomUUID();
  const seeded = await admin()
    .from("exams")
    .insert({ id: examId, owner_id: student.id, course_id: F.course, title: "Midterm", date: inDays(5), topic_ids: [F.twosComplement], cramming: false, scope: null });
  if (seeded.error) throw new Error(`Couldn't seed the exam: ${seeded.error.message}`);

  await page.goto(`/course/${SLUG}/cram`);
  const setup = page.locator("[data-part=cram-setup]");
  await expect(setup).toContainText("Cram for Midterm");
  await expect(setup).toContainText("How many hours can you put in before the exam?");
  // One checkbox per remaining day: today to the day before the exam.
  await expect(setup.locator("[data-part=cram-day-out]")).toHaveCount(5);
  const dayOut = inDays(2);
  await setup.locator("[data-part=cram-hours]").fill("6");
  await setup.locator(`[data-part=cram-day-out][data-day="${dayOut}"]`).check();
  await setup.getByRole("button", { name: "Objectives you're worried about" }).click();
  await page.getByRole("option", { name: "Sign-extend a number" }).getByRole("checkbox").check();
  await setup.locator("[data-part=cram-confirm]").click();
  await expect(setup).toBeHidden();

  // The cramming view: 6 hours over 4 study days is 90 minutes a day, all on the one topic in scope.
  const cram = page.locator("[data-part=cram-page]");
  await expect(cram).toHaveAttribute("data-cramming", "1");
  await expect(page.locator("h1")).toHaveText("Cramming for Midterm");
  await expect(cram.locator("[data-part=cram-budget]")).toHaveText("6 hours left of 6");
  await expect(cram.locator("[data-part=cram-plan]")).toHaveText("5 days to the exam. Today: Two's Complement. Verified: 0%.");
  const rows = cram.locator("[data-part=cram-topic]");
  await expect(rows).toHaveCount(1);
  const row = rows.first();
  await expect(row).toHaveAttribute("data-topic", F.twosComplement);
  await expect(row).toContainText("Two's Complement");
  await expect(row.locator("[data-part=cram-topic-verified]")).toHaveText("0/2 verified");
  await expect(row.locator("[data-part=cram-topic-minutes]")).toHaveText("90 min today");
  // The worry is a struggled flag, so that objective is a weak spot under its topic.
  await expect(row.locator("[data-part=cram-weak-spot]")).toHaveCount(1);
  await expect(row.locator("[data-part=cram-weak-spot]")).toContainText("Sign-extend a number · Learning");
  await expect(cram.locator("[data-part=cram-today] [data-part=cram-today-topic]")).toHaveText("Two's Complement90 min");
  await expect(cram.locator("[data-part=cram-mock]")).toContainText("No practice test yet");
  await expect(cram.locator("[data-part=cram-vault] [data-part=cram-vault-item]")).toHaveText([PAST_EXAM]);
  await expect(cram.locator("[data-part=study-with-claude]")).toHaveAttribute("href", "/settings#connector");

  let state = await stored(page, student);
  let exam = state.exams.find((e) => e.id === examId)!;
  expect(exam.cramming).toBe(true);
  expect(exam.scope?.budget).toMatchObject({ hours: 6, daysOut: [dayOut] });
  const since = exam.scope?.budget?.since;
  expect(typeof since).toBe("string");
  expect(Math.abs(Date.now() - Date.parse(since!))).toBeLessThan(5 * 60_000);

  // Edit scope reopens the setup prefilled; confirming keeps the start of the cram.
  await cram.locator("[data-part=cram-edit]").click();
  await expect(setup.locator("[data-part=cram-hours]")).toHaveValue("6");
  await expect(setup.locator(`[data-part=cram-day-out][data-day="${dayOut}"]`)).toBeChecked();
  await setup.locator("[data-part=cram-hours]").fill("8");
  await setup.locator("[data-part=cram-confirm]").click();
  await expect(cram.locator("[data-part=cram-budget]")).toHaveText("8 hours left of 8");
  state = await stored(page, student);
  exam = state.exams.find((e) => e.id === examId)!;
  expect(exam.scope?.budget).toEqual({ hours: 8, daysOut: [dayOut], since });

  // Stop cramming: the exam is no longer cramming, and the page is back at setup.
  await cram.locator("[data-part=cram-stop]").click();
  await expect(setup).toBeVisible();
  await expect(cram).not.toHaveAttribute("data-cramming", "1");
  state = await stored(page, student);
  expect(state.exams.find((e) => e.id === examId)!.cramming).toBe(false);
});
