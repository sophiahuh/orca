import { F, FIXTURE_STATE, daysAgo, expect, seedState, struggled, test } from "./fixture";

/** List (owner, 2026-11-10): the topics with weak spots, each with its status and a dive. */
const SLUG = FIXTURE_STATE.courses[0].slug;

test("List shows only topics with weak spots, with their status, and a row's play opens its dive", async ({ page, student }) => {
  await seedState(student, { ...FIXTURE_STATE, evidence: [struggled(F.course, F.twosComplement, F.signExtend, daysAgo(1))] });
  await page.goto(`/course/${SLUG}`);
  await page.locator("[data-part=atlas-switch]").getByRole("link", { name: "List" }).click();
  await expect(page).toHaveURL(new RegExp(`/course/${SLUG}/list$`));
  const rows = page.locator("[data-part=weak-row]");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute("data-status", "needs-review");
  await expect(rows.first()).toContainText("Two's Complement");
  await expect(rows.first().locator("[data-part=status-pill]")).toHaveText("Needs review");
  await rows.first().locator("[data-part=weak-row-play]").click();
  await expect(page.locator("[data-part=dive-modal]")).toContainText("Dive into Two's Complement");
});
