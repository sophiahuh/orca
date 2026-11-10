import { admin, expect, F, FIXTURE_STATE, seedFixtureCourse, stored, test } from "./fixture";

/**
 * The exam card on the course page (cram mode contract, section 5): the soonest upcoming exam
 * with its days left, scope size and verified share; Cram for this exam opens the setup (the
 * professor's words, Add material held back, worries), Confirm stores cramming and the scope,
 * and Stop cramming clears it. Edit Exams has the same switch per exam.
 */
const SLUG = FIXTURE_STATE.courses[0].slug;
const inDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const WORDS = "Only two's complement, no Boolean algebra.";

test("the exam card shows the soonest exam; Cram for this exam stores cramming and the scope, Stop cramming clears it", async ({ page, student }) => {
  await seedFixtureCourse(student);
  const examId = crypto.randomUUID();
  const seeded = await admin()
    .from("exams")
    .insert({ id: examId, owner_id: student.id, course_id: F.course, title: "Midterm", date: inDays(5), topic_ids: [F.twosComplement], cramming: false, scope: null });
  if (seeded.error) throw new Error(`Couldn't seed the exam: ${seeded.error.message}`);

  await page.goto(`/course/${SLUG}`);
  const card = page.locator("[data-part=exam-card]");
  await expect(card).toContainText("Midterm");
  await expect(card.locator("[data-part=exam-days]")).toHaveText("5 days left");
  // Two's Complement has two objectives (convert, sign-extend); nothing answered yet.
  await expect(card.locator("[data-part=exam-scope]")).toHaveText("2 objectives in scope · 0% verified");

  await card.locator("[data-part=cram-start]").click();
  const setup = page.locator("[data-part=cram-setup]");
  await expect(setup).toContainText("Cram for Midterm");
  await expect(setup.locator("[data-part=cram-add-material]")).toHaveAttribute("href", `/add-material?course=${SLUG}&type=Practice%20exam&holdBack=1`);
  await setup.locator("[data-part=professor-words]").fill(WORDS);
  await setup.getByRole("button", { name: "Objectives you're worried about" }).click();
  // The list floats over the dialog (a portal), so it's on the page, not inside the dialog.
  await page.getByRole("option", { name: "Sign-extend a number" }).getByRole("checkbox").check();
  await setup.locator("[data-part=cram-confirm]").click();
  await expect(setup).toBeHidden();

  await expect(card).toHaveAttribute("data-cramming", "1");
  await expect(card.locator("[data-part=cram-plan]")).toHaveText("5 days. Verified: 0%.");
  await expect(card.locator("[data-part=study-with-claude]")).toHaveAttribute("href", "/settings#connector");
  await expect(card).toContainText("Scope from your professor's words.");

  let state = await stored(page, student);
  let exam = state.exams.find((e) => e.id === examId)!;
  expect(exam.cramming).toBe(true);
  expect(exam.scope?.sources).toEqual(["professor"]);
  expect(exam.scope?.objectives.map((o) => [o.objectiveId, o.weight, o.evidence]).sort()).toEqual(
    [
      [F.convert, 1, [{ signal: "professor", strength: "strong", quote: WORDS }]],
      [F.signExtend, 1, [{ signal: "professor", strength: "strong", quote: WORDS }]],
    ].sort(),
  );
  // The worry is a manual struggled flag on that objective, and only that one.
  const flags = state.evidence.filter((e) => e.kind === "confusion" && e.flagSource === "manual");
  expect(flags.map((e) => e.objectiveId)).toEqual([F.signExtend]);

  // Edit scope reopens the setup with the words already there.
  await card.locator("[data-part=cram-edit]").click();
  await expect(setup.locator("[data-part=professor-words]")).toHaveValue(WORDS);
  await page.keyboard.press("Escape");
  await expect(setup).toBeHidden();

  await card.locator("[data-part=cram-stop]").click();
  await expect(card.locator("[data-part=cram-start]")).toBeVisible();
  state = await stored(page, student);
  exam = state.exams.find((e) => e.id === examId)!;
  expect(exam.cramming).toBe(false);
  expect(exam.scope?.sources).toEqual(["professor"]);

  // Edit Exams has a Cramming switch per exam, stored the same way.
  await page.locator("[data-part=edit-exams]").click();
  const toggle = page.locator("[data-part=exams-modal] [data-part=exam-cramming]").getByRole("switch", { name: "Cramming for Midterm" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(card).toHaveAttribute("data-cramming", "1");
  state = await stored(page, student);
  expect(state.exams.find((e) => e.id === examId)!.cramming).toBe(true);
});
