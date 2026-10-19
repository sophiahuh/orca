import { F, FIXTURE_STATE, expect, seedPages, seedState, test } from "./fixture";
import { fakeCalls, fakeModel } from "./fake-model";

/**
 * The Concept Atlas (Figma: E1/E2 · Concept graph v4): the course's topics as nodes, its topic
 * relations as edges, foundations on top; hovering a topic lights its edges and labels them;
 * clicking opens its quiz.
 */
const SLUG = FIXTURE_STATE.courses[0].slug;

test("the atlas draws topics and their links, foundations on top; hovering explains a topic and clicking opens it", async ({ page, student }) => {
  await seedState(student, {
    ...FIXTURE_STATE,
    relations: { [F.course]: [{ id: crypto.randomUUID(), from: F.booleanAlgebra, to: F.twosComplement, type: "used-in", anchor: null, review: "proposed", materialId: F.material, reason: "Two's complement negation is a Boolean operation on bits." }] },
  });
  await page.goto(`/course/${SLUG}/atlas`);
  await expect(page.locator("[data-part=atlas-summary]")).toHaveText("2 topics · 1 connection");
  await expect(page.locator("[data-part=topic]")).toHaveCount(2);
  await expect(page.locator("[data-part=edge][data-type=used-in]")).toHaveCount(1);
  // Nothing answered yet: both unverified. The topic used in another sits above it.
  await expect(page.locator("[data-part=topic][data-strength=unverified]")).toHaveCount(2);
  const top = await page.locator(`[data-topic="${F.booleanAlgebra}"]`).boundingBox();
  const below = await page.locator(`[data-topic="${F.twosComplement}"]`).boundingBox();
  expect(top!.y).toBeLessThan(below!.y);
  await expect(page.getByRole("heading", { name: "Due today" })).toBeVisible();

  await page.locator(`[data-topic="${F.booleanAlgebra}"]`).hover();
  await expect(page.locator("[data-part=edge-label]")).toHaveText("used in");

  // Clicking a topic offers a dive into it.
  await page.locator(`[data-topic="${F.booleanAlgebra}"]`).click();
  await expect(page.locator("[data-part=dive-modal]")).toContainText("Dive into Boolean Algebra");
});

test("a topic's dive: the popup picks the length and the session writes harder questions for that topic only", async ({ page, student }) => {
  await seedState(student, FIXTURE_STATE);
  // The deck's stored pages: dive questions are written from where each objective is taught.
  await seedPages(student, { [F.material]: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ n, text: `Slide ${n}: logic.` })) });
  await page.goto(`/course/${SLUG}`);
  await page.locator(`[data-visual] [data-part=node]`).first().click();
  const modal = page.locator("[data-part=dive-modal]");
  await expect(modal).toContainText("Dive into Boolean Algebra");
  await modal.locator('[data-part=dive-minutes][data-minutes="10"]').click();
  await modal.locator("[data-part=dive-start]").click();
  await expect(page).toHaveURL(new RegExp(`/session/${SLUG}\\?kind=deep&topic=${F.booleanAlgebra}&minutes=10`));
  // 10 minutes is 3 questions, all for Boolean Algebra's one objective; it starts without asking again.
  await expect(page.getByText("1 / 3")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "How long do you want to study?" })).toHaveCount(0);
  await expect(page.locator("h1").first()).toContainText("Simplify an expression: deep case");
  expect(await fakeCalls()).toEqual(["deep"]);

  // Leaving without answering keeps those questions: diving into the topic again asks them, with no new model call.
  await page.goto(`/course/${SLUG}`);
  await page.locator(`[data-visual] [data-part=node]`).first().click();
  await page.locator('[data-part=dive-modal] [data-part=dive-minutes][data-minutes="10"]').click();
  await page.locator("[data-part=dive-modal] [data-part=dive-start]").click();
  await expect(page.getByText("1 / 3")).toBeVisible({ timeout: 30_000 });
  expect(await fakeCalls()).toEqual(["deep"]);
});

test("the course page switches between Path and Atlas", async ({ page, student }) => {
  await seedState(student, FIXTURE_STATE);
  await page.goto(`/course/${SLUG}`);
  await page.locator("[data-part=atlas-switch]").getByRole("link", { name: "Atlas" }).click();
  await expect(page).toHaveURL(new RegExp(`/course/${SLUG}/atlas$`));
  await expect(page.locator("[data-part=atlas-summary]")).toHaveText("2 topics · 0 connections");
  await page.locator("[data-part=atlas-switch]").getByRole("link", { name: "Path" }).click();
  await expect(page).toHaveURL(new RegExp(`/course/${SLUG}$`));
});

test("Find connections links the course's topics with the link step and draws them", async ({ page, student }) => {
  await seedState(student, FIXTURE_STATE);
  await fakeModel({ links: [{ from: "Boolean Algebra", to: "Two's Complement", type: "related" }] });
  await page.goto(`/course/${SLUG}/atlas`);
  await expect(page.locator("[data-part=edge]")).toHaveCount(0);
  await page.locator("[data-part=find-connections]").click();
  await expect(page.locator("[data-part=find-connections-result]")).toHaveText("Found 1 new connection.");
  await expect(page.locator("[data-part=edge][data-type=related]")).toHaveCount(1);
  await expect(page.locator("[data-part=atlas-summary]")).toHaveText("2 topics · 1 connection");
  expect(await fakeCalls()).toEqual(["link"]);
  // Hovering the link shows why it's there.
  // force: a link between topics in one row is a flat line (a zero-height box), though its 16 px stroke takes the pointer.
  await page.locator("[data-part=edge-hit]").hover({ force: true });
  await expect(page.locator("[data-part=edge-reason]")).toContainText("Boolean Algebra is part of how Two's Complement works.");
  // Asking again finds nothing new: the link it already has isn't added twice.
  await page.locator("[data-part=find-connections]").click();
  await expect(page.locator("[data-part=find-connections-result]")).toHaveText("No new connections found.");
  await expect(page.locator("[data-part=edge]")).toHaveCount(1);
});

test("a stuck dive can be cancelled after two minutes and started again", async ({ page, student }) => {
  await seedState(student, FIXTURE_STATE);
  await seedPages(student, { [F.material]: [1, 2, 3, 4, 5].map((n) => ({ n, text: `Slide ${n}: logic.` })) });
  // The first dive's model call hangs, as if its job had died.
  await fakeModel({ delayMs: 600_000 });
  await page.clock.install();
  await page.goto(`/session/${SLUG}?kind=deep&topic=${F.booleanAlgebra}&minutes=10`);
  await expect(page.locator("[data-part=preparing-dive]")).toContainText("Preparing your quiz");
  await expect(page.locator("[data-part=dive-slow]")).toHaveCount(0);
  // The page follows the dive's run once the server has made it; two minutes after that, it offers to cancel.
  await expect.poll(async () => (await student.db.from("pipeline_runs").select("status").eq("kind", "deep-review")).data!.map((r) => r.status)).toEqual(["running"]);
  await page.waitForTimeout(500);
  await page.clock.fastForward(121_000);
  await expect(page.locator("[data-part=dive-slow]")).toBeVisible();

  await fakeModel();
  await page.getByRole("button", { name: "Cancel and try again" }).click();
  await expect(page.getByText("1 / 3")).toBeVisible({ timeout: 30_000 });
  const { data: runs } = await student.db.from("pipeline_runs").select("id, status").eq("kind", "deep-review").order("at");
  expect(runs!.map((r) => r.status)).toEqual(["failed", "done"]);
});
