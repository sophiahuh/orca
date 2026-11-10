import { admin, expect, F, FIXTURE_STATE, fixtureMaterial, ids, objective, seedState, stored, test } from "./fixture";
import { NOT_IN_FILES } from "../src/lib/course/exam-card";

/**
 * The cram page (cram mode contract, section 6 and its per-day addendum): setup asks which files
 * the exam covers (the materials picked narrow the scope) and for the time budget, hours for each
 * remaining day (0 for a day off; the days are stored, the total derived) beside the professor's
 * words and worries; Confirm stores cramming and the budget and shows the
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
const weekday = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });

test("setup picks the files and the hours for each day, one at 0; the page then shows the budget by day, the topic rows, the line, the vault, and Stop cramming", async ({ page, student }) => {
  // The fixture course plus a second deck (one more Two's Complement objective comes from it) and a past exam held back for a practice test (listed in the vault by name).
  const id = ids("deck2", "overflow");
  const deck2 = { ...fixtureMaterial(F.course), id: id.deck2, filename: "L02_Fixture.pdf" };
  const pastExam = { ...fixtureMaterial(F.course), id: crypto.randomUUID(), filename: PAST_EXAM, type: "Past exam" as const, heldBack: true };
  await seedState(student, {
    ...FIXTURE_STATE,
    materials: [...FIXTURE_STATE.materials, deck2, pastExam],
    objectives: { [F.course]: { ...FIXTURE_STATE.objectives[F.course], [id.overflow]: objective(id.overflow, F.twosComplement, "Detect overflow", { materialId: id.deck2 }) } },
  });
  const examId = crypto.randomUUID();
  const seeded = await admin()
    .from("exams")
    .insert({ id: examId, owner_id: student.id, course_id: F.course, title: "Midterm", date: inDays(5), topic_ids: [F.twosComplement], cramming: false, scope: null });
  if (seeded.error) throw new Error(`Couldn't seed the exam: ${seeded.error.message}`);

  await page.goto(`/course/${SLUG}/cram`);
  const setup = page.locator("[data-part=cram-setup]");
  await expect(setup).toContainText("Cram for Midterm");
  // The files: one checkbox per material; lectures ticked, the past exam shown held back and unticked. The count follows the pick.
  const files = setup.locator("[data-part=cram-materials] [data-part=cram-material]");
  await expect(files).toHaveCount(3);
  await expect(setup.locator(`[data-part=cram-material][data-id="${F.material}"]`)).toBeChecked();
  await expect(setup.locator(`[data-part=cram-material][data-id="${id.deck2}"]`)).toBeChecked();
  await expect(setup.locator(`[data-part=cram-material][data-id="${pastExam.id}"]`)).not.toBeChecked();
  await expect(setup.locator("[data-part=cram-materials]")).toContainText(`${PAST_EXAM}Past exam · held back`);
  await expect(setup.locator("[data-part=cram-scope-size]")).toHaveText("3 of 3 objectives in scope.");
  await setup.locator(`[data-part=cram-material][data-id="${id.deck2}"]`).uncheck();
  await expect(setup.locator("[data-part=cram-scope-size]")).toHaveText("2 of 3 objectives in scope.");
  await setup.locator(`[data-part=cram-material][data-id="${F.material}"]`).uncheck();
  await expect(setup.locator("[data-part=cram-scope-size]")).toHaveText("Nothing picked, so all 3 objectives are in scope.");
  await setup.locator(`[data-part=cram-material][data-id="${F.material}"]`).check();
  await expect(setup.locator("[data-part=cram-scope-size]")).toHaveText("2 of 3 objectives in scope.");
  // Hours by day: one row per remaining day (today to the day before the exam), each prefilled from the course's exam review duration (10 hours) over the 5 days; "Same for every day" fills every row.
  await expect(setup).toContainText("How much time each day?");
  await expect(setup.locator("[data-part=cram-hours]")).toHaveValue("2");
  const rowsOfDays = setup.locator("[data-part=cram-day]");
  await expect(rowsOfDays).toHaveCount(5);
  await expect(rowsOfDays.first()).toHaveAttribute("data-day", inDays(0));
  await expect(rowsOfDays.first()).toHaveAttribute("data-today", "1");
  await expect(rowsOfDays.last()).toHaveAttribute("data-day", inDays(4));
  const hoursOn = (day: string) => setup.locator(`[data-part=cram-day][data-day="${day}"] [data-part=cram-day-hours]`);
  await expect(hoursOn(inDays(3))).toHaveValue("2");
  await expect(setup.locator("[data-part=cram-hours-total]")).toHaveText(`10 hours before ${weekday(inDays(5))}, 5 study days`);
  await setup.locator("[data-part=cram-hours]").fill("3");
  await expect(hoursOn(inDays(3))).toHaveValue("3");
  await expect(setup.locator("[data-part=cram-hours-total]")).toHaveText(`15 hours before ${weekday(inDays(5))}, 5 study days`);
  // Days differ: today 2 hours, tomorrow an hour and a half, the day after off; the rest stay at 3.
  const dayOut = inDays(2);
  await hoursOn(inDays(0)).fill("2");
  await hoursOn(inDays(1)).fill("1.5");
  await hoursOn(dayOut).fill("0");
  await expect(setup.locator("[data-part=cram-hours-total]")).toHaveText(`9.5 hours before ${weekday(inDays(5))}, 4 study days`);
  // A quarter hour isn't allowed: Confirm waits for a half-hour step.
  await hoursOn(inDays(4)).fill("2.25");
  await expect(setup).toContainText("in half hours");
  await expect(setup.locator("[data-part=cram-confirm]")).toBeDisabled();
  await hoursOn(inDays(4)).fill("3");
  await expect(setup.locator("[data-part=cram-confirm]")).toBeEnabled();
  await setup.getByRole("button", { name: "Objectives you're worried about" }).click();
  await page.getByRole("option", { name: "Sign-extend a number" }).getByRole("checkbox").check();
  await setup.locator("[data-part=cram-confirm]").click();
  await expect(setup).toBeHidden();

  // The cramming view: 9.5 hours over 4 study days, today's 2 hours all on the one topic in scope (two of its three objectives: the second deck's is out); the days show their hours, today highlighted.
  const cram = page.locator("[data-part=cram-page]");
  await expect(cram).toHaveAttribute("data-cramming", "1");
  await expect(page.locator("h1")).toHaveText("Cramming for Midterm");
  await expect(cram.locator("[data-part=cram-budget]")).toHaveText("9.5 hours left of 9.5");
  await expect(cram.locator("[data-part=cram-spent]")).toHaveText("0 min studied in Orca since you started · 4 study days left · 120 min left today");
  const chips = cram.locator("[data-part=cram-days] [data-part=cram-day]");
  await expect(chips).toHaveCount(5);
  await expect(chips.first()).toHaveAttribute("data-today", "1");
  await expect(chips.first()).toHaveAttribute("data-hours", "2");
  await expect(cram.locator(`[data-part=cram-days] [data-part=cram-day][data-day="${dayOut}"]`)).toHaveAttribute("data-hours", "0");
  await expect(cram.locator(`[data-part=cram-days] [data-part=cram-day][data-day="${inDays(1)}"]`)).toContainText("1.5 h");
  await expect(cram.locator("[data-part=cram-plan]")).toHaveText("5 days to the exam. Today: Two's Complement. Verified: 0%.");
  const rows = cram.locator("[data-part=cram-topic]");
  await expect(rows).toHaveCount(1);
  const row = rows.first();
  await expect(row).toHaveAttribute("data-topic", F.twosComplement);
  await expect(row).toContainText("Two's Complement");
  await expect(row.locator("[data-part=cram-topic-verified]")).toHaveText("0/2 verified");
  await expect(row.locator("[data-part=cram-topic-minutes]")).toHaveText("120 min today");
  // The worry is a struggled flag, so that objective is a weak spot under its topic.
  await expect(row.locator("[data-part=cram-weak-spot]")).toHaveCount(1);
  await expect(row.locator("[data-part=cram-weak-spot]")).toContainText("Sign-extend a number · Learning");
  await expect(cram.locator("[data-part=cram-today] [data-part=cram-today-topic]")).toHaveText("Two's Complement120 min");
  await expect(cram.locator("[data-part=cram-mock]")).toContainText("No practice test yet");
  await expect(cram.locator("[data-part=cram-vault] [data-part=cram-vault-item]")).toHaveText([PAST_EXAM]);
  await expect(cram.locator("[data-part=study-with-claude]")).toHaveAttribute("href", "/settings#connector");

  let state = await stored(page, student);
  let exam = state.exams.find((e) => e.id === examId)!;
  expect(exam.cramming).toBe(true);
  // The budget stores the days; the total and the days out derive from them.
  expect(exam.scope?.budget).toMatchObject({ hours: 9.5, daysOut: [dayOut], perDay: { [inDays(0)]: 2, [inDays(1)]: 1.5, [dayOut]: 0, [inDays(3)]: 3, [inDays(4)]: 3 } });
  const since = exam.scope?.budget?.since;
  expect(typeof since).toBe("string");
  expect(Math.abs(Date.now() - Date.parse(since!))).toBeLessThan(5 * 60_000);
  // The scope: the picked deck is stored; its objectives weigh 1 (no words, so no quote), the second deck's weighs 0 and says why.
  expect(exam.scope?.materialIds).toEqual([F.material]);
  expect(exam.scope?.objectives.map((o) => [o.objectiveId, o.weight, o.evidence]).sort()).toEqual(
    [
      [F.convert, 1, []],
      [F.signExtend, 1, []],
      [id.overflow, 0, [{ signal: "professor", strength: "strong", quote: NOT_IN_FILES }]],
    ].sort(),
  );

  // Edit scope reopens the setup prefilled (the pick, each day's hours); confirming keeps the start of the cram.
  await cram.locator("[data-part=cram-edit]").click();
  await expect(setup.locator(`[data-part=cram-material][data-id="${F.material}"]`)).toBeChecked();
  await expect(setup.locator(`[data-part=cram-material][data-id="${id.deck2}"]`)).not.toBeChecked();
  await expect(hoursOn(inDays(1))).toHaveValue("1.5");
  await expect(hoursOn(dayOut)).toHaveValue("0");
  await expect(hoursOn(inDays(4))).toHaveValue("3");
  await setup.locator("[data-part=cram-hours]").fill("3");
  await expect(hoursOn(dayOut)).toHaveValue("3");
  await expect(setup.locator("[data-part=cram-hours-total]")).toHaveText(`15 hours before ${weekday(inDays(5))}, 5 study days`);
  await setup.locator("[data-part=cram-confirm]").click();
  await expect(cram.locator("[data-part=cram-budget]")).toHaveText("15 hours left of 15");
  state = await stored(page, student);
  exam = state.exams.find((e) => e.id === examId)!;
  expect(exam.scope?.budget).toEqual({ hours: 15, daysOut: [], since, perDay: Object.fromEntries([0, 1, 2, 3, 4].map((n) => [inDays(n), 3])) });

  // Stop cramming: the exam is no longer cramming, and the page is back at setup.
  await cram.locator("[data-part=cram-stop]").click();
  await expect(setup).toBeVisible();
  await expect(cram).not.toHaveAttribute("data-cramming", "1");
  state = await stored(page, student);
  expect(state.exams.find((e) => e.id === examId)!.cramming).toBe(false);
});
