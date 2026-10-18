import type { Topic } from "../src/lib/data";
import { type SeedState, admin, expect, test, fixtureMaterial, ids, laidOut, objective, seedState, short, stored } from "./fixture";

/** A course as an upload left it: one confirmed topic, two new ones (one maybe a duplicate), an uncertain objective. */
const SLUG = "logic";
const id = ids("course", "A", "B", "C", "a1", "b1", "b2", "b3", "c1", "qa1", "qb1", "qb3", "qc1");
const ID = id.course;
const topic = (id: string, name: string, review: Topic["review"], extra: Partial<Topic> = {}): Topic => ({ id, name, aliases: [], review, pos: { x: 0, y: 0 }, ...extra });

const STATE: SeedState = {
  courses: [
    {
      id: ID,
      slug: SLUG,
      name: "Logic",
      short: "LOG",
      variant: "circuit",
      pos: { x: 70, y: 110 },
      topics: laidOut([
        topic(id.A, "Boolean Algebra", "confirmed"),
        topic(id.B, "Karnaugh Maps", "proposed", { summary: "Grouping ones." }),
        topic(id.C, "K Maps", "proposed", { uncertain: { candidateId: id.B, reasoning: "Both cover Karnaugh maps." } }),
      ]),
    },
  ],
  configs: { [ID]: { quick: { duration: "10 min", cadence: "Daily" }, deep: { duration: "3 hours", cadence: "Weekly" }, exam: { duration: "10 hours", cadence: "1 wk before exam" } } },
  weights: { [ID]: { homework: 25, practiceExams: 25, practiceProblems: 25, lectures: 25 } },
  materials: [fixtureMaterial(ID)],
  objectives: {
    [ID]: {
      [id.a1]: objective(id.a1, id.A, "Simplify with absorption", { signals: [{ materialId: "m", materialType: "Lecture", places: [{ locator: "slide 2", excerpt: "" }] }] }),
      [id.b1]: objective(id.b1, id.B, "Group ones on a K-map", { review: "proposed" }),
      [id.b2]: objective(id.b2, id.B, "Read binary numbers", { review: "proposed", origin: "inferred" }),
      [id.b3]: objective(id.b3, id.B, "Form K-map groups", { review: "proposed", uncertain: { candidateId: id.b1, reasoning: "Same skill, different wording." } }),
      [id.c1]: objective(id.c1, id.C, "Use don't-cares", { review: "proposed" }),
    },
  },
  questionBank: {
    [ID]: {
      [id.A]: [short(id.qa1, "Boolean Algebra", id.a1, "Simplify x + xy.", ["x"])],
      [id.B]: [short(id.qb1, "Karnaugh Maps", id.b1, "How many ones in a quad?", ["4"]), short(id.qb3, "Karnaugh Maps", id.b3, "Smallest group size?", ["1"])],
      [id.C]: [short(id.qc1, "K Maps", id.c1, "Can a don't-care be left out?", ["yes"])],
    },
  },
};

// The uploads test seeds its own state (with runs).
test.beforeEach(async ({ student }, info) => {
  if (!info.title.startsWith("the course's uploads")) await seedState(student, STATE);
});

test("the course page always has Uploads and Review, with counts when there's something in them", async ({ page }) => {
  await page.goto(`/course/${SLUG}`);
  await expect(page.locator("[data-part=uploads-link]")).toHaveText("Uploads");
  await expect(page.getByRole("link", { name: "Review, 4 to review" })).toHaveText("Review4");
  await page.getByRole("link", { name: "Review, 4 to review" }).click();
  await expect(page).toHaveURL(/\/review\?tab=review$/);
  await expect(page.locator("[data-part=duplicate]")).toHaveCount(2);
});

test("the course's uploads: the button counts the one building, and the Uploads tab lists every upload, newest first", async ({ page, student }) => {
  const material = STATE.materials![0];
  const run = (status: "done" | "running" | "failed", minutesAgo: number, extra: object = {}) => ({
    id: crypto.randomUUID(),
    kind: "upload" as const,
    courseId: ID,
    materialId: material.id,
    at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    model: "claude-opus-5-5",
    status,
    topicsCreated: [],
    objectivesCreated: [],
    objectivesAttached: [],
    questionsAdded: status === "done" ? 6 : 0,
    dropped: [],
    ...extra,
  });
  await seedState(student, { ...STATE, runs: [run("done", 60), run("failed", 30, { error: "The model didn't answer." }), run("running", 1, { progress: { stage: "writing" } })] });
  await page.goto(`/course/${SLUG}`);
  const button = page.getByRole("link", { name: "Uploads, 1 building" });
  await expect(button).toHaveText("Uploads1");
  await button.click();
  await expect(page).toHaveURL(/\/review\?tab=uploads$/);
  const cards = page.locator("[data-part=upload-card]");
  await expect(cards).toHaveCount(3);
  await expect(cards.locator("[data-part=upload-status]")).toHaveText(["Building", "Failed", "Added"]);
  await expect(cards.nth(1)).toContainText("The model didn't answer.");
  await expect(cards.nth(2)).toContainText("6 questions added.");
  await page.locator("[data-tab=review]").click();
  await expect(page.locator("[data-part=duplicate]")).toHaveCount(2);
});

test("the course's uploads: one still running past its 40-minute limit is marked failed by the server when the page sees it", async ({ page, student }) => {
  const runId = crypto.randomUUID();
  await seedState(student, {
    ...STATE,
    runs: [{ id: runId, kind: "upload", courseId: ID, materialId: STATE.materials![0].id, at: new Date(Date.now() - 45 * 60_000).toISOString(), model: "claude-opus-5-5", status: "running", topicsCreated: [], objectivesCreated: [], objectivesAttached: [], questionsAdded: 0, dropped: [] }],
  });
  // Its job claimed it 45 minutes ago and died (as when the dev server restarts mid-upload).
  const { error } = await admin().from("pipeline_runs").update({ started_at: new Date(Date.now() - 45 * 60_000).toISOString() }).eq("id", runId);
  expect(error).toBeNull();
  await page.goto(`/course/${SLUG}/review?tab=uploads`);
  const card = page.locator("[data-part=upload-card]");
  await expect(card.locator("[data-part=upload-status]")).toHaveText("Failed", { timeout: 15_000 });
  await expect(card).toContainText("Orca's job stopped without finishing. Upload the file again to retry.");
  expect((await stored(page, student)).runs.map((r) => r.status)).toEqual(["failed"]);
});

test("settling duplicates and confirming a topic", async ({ page, student }) => {
  await page.goto(`/course/${SLUG}/review`);
  const duplicates = page.locator("[data-part=duplicate]");
  await expect(duplicates).toHaveCount(2);
  await duplicates.filter({ hasText: "K Maps" }).getByRole("button", { name: "Same topic: merge" }).click();
  await duplicates.filter({ hasText: "Form K-map groups" }).getByRole("button", { name: "Keep separate" }).click();
  await expect(duplicates).toHaveCount(0);

  const card = page.locator("[data-part=new-topic]").filter({ hasText: "Karnaugh Maps" });
  await card.locator("li").filter({ hasText: "Read binary numbers" }).getByRole("button", { name: "Reject" }).click();
  await card.getByRole("button", { name: "Confirm topic" }).click();
  await expect(page.getByText("Nothing to review.")).toBeVisible();

  const s = await stored(page, student);
  const topics = s.courses[0].topics;
  expect(topics.find((t: Topic) => t.id === id.C)).toMatchObject({ review: "archived", mergedInto: id.B });
  expect(topics.find((t: Topic) => t.id === id.B)).toMatchObject({ review: "confirmed", aliases: ["K Maps"] });
  const o = s.objectives[ID];
  expect([o[id.b1].review, o[id.b2].review, o[id.b3].review, o[id.c1].review, o[id.c1].topicId]).toEqual(["confirmed", "archived", "confirmed", "confirmed", id.B]);
  expect(s.questionBank[ID][id.B].map((q: { id: string }) => q.id)).toEqual([id.qb1, id.qb3, id.qc1]);
});

test("renaming a new topic keeps its old name as an alias", async ({ page, student }) => {
  await page.goto(`/course/${SLUG}/review`);
  const card = page.locator("[data-part=new-topic]").filter({ hasText: "Karnaugh Maps" });
  await card.getByRole("button", { name: "Rename" }).click();
  // While editing, the name is an input's value, so find the field by its label rather than the card's text.
  const field = page.getByLabel("New name for Karnaugh Maps");
  await field.fill("Karnaugh Maps (K-Maps)");
  await field.press("Enter");
  await expect(page.locator("[data-part=new-topic]").filter({ hasText: "Karnaugh Maps (K-Maps)" })).toBeVisible();
  expect((await stored(page, student)).courses[0].topics[1].aliases).toEqual(["Karnaugh Maps"]);
});

test("the objective list shows status and weight, and rejects, restores, merges and un-merges", async ({ page, student }) => {
  await page.goto(`/course/${SLUG}/objectives`);
  const row = (name: string) => page.locator(`[data-objective="${name}"]`);
  await expect(row("Simplify with absorption")).toContainText("Confirmed");
  await expect(row("Simplify with absorption")).toContainText(/Not started · weight \d\.\d\d/);
  await expect(row("Read binary numbers")).toContainText("Inferred, not in the material");
  await expect(row("Read binary numbers")).toContainText("weight 1.00");

  await row("Use don't-cares").getByRole("button", { name: "Reject" }).click();
  await expect(row("Use don't-cares")).toHaveCount(0);
  const topicC = page.locator("[data-part=topic-objectives]").filter({ hasText: "K Maps" });
  await topicC.getByRole("button", { name: "Restore" }).click();
  await expect(row("Use don't-cares")).toContainText("Confirmed");

  await row("Form K-map groups").getByLabel("Merge Form K-map groups into").selectOption({ label: "Group ones on a K-map" });
  await expect(row("Form K-map groups")).toHaveCount(0);
  await expect(row("Group ones on a K-map")).toContainText("Merged Form K-map groups");
  expect((await stored(page, student)).objectives[ID][id.b3].mergedInto).toBe(id.b1);
  await row("Group ones on a K-map").getByRole("button", { name: "Undo" }).click();
  await expect(row("Form K-map groups")).toBeVisible();
});

test("questions of unreviewed objectives are tagged; rejected ones are never asked", async ({ page }) => {
  await page.goto(`/quiz/${SLUG}/${id.B}`);
  await expect(page.getByText("How many ones in a quad?")).toBeVisible();
  await expect(page.getByText("Unreviewed", { exact: true })).toBeVisible();

  await page.goto(`/quiz/${SLUG}/${id.A}`);
  await expect(page.getByText("Simplify x + xy.")).toBeVisible();
  await expect(page.getByText("Unreviewed", { exact: true })).toHaveCount(0);

  await page.goto(`/course/${SLUG}/objectives`);
  await page.locator('[data-objective="Group ones on a K-map"]').getByRole("button", { name: "Reject" }).click();
  await page.goto(`/quiz/${SLUG}/${id.B}`);
  await expect(page.getByText("Smallest group size?")).toBeVisible();
  await expect(page.getByText("How many ones in a quad?")).toHaveCount(0);
});

test("when a save fails, the change queued behind it is cancelled too and the screen matches the database", async ({ page, student }) => {
  await page.goto(`/course/${SLUG}/review`);
  const duplicates = page.locator("[data-part=duplicate]");
  await expect(duplicates).toHaveCount(2);
  let calls = 0;
  await page.route("**/rest/v1/rpc/save_structure", async (route) => {
    calls += 1;
    // The first save is slow and then fails, so the second action is queued behind it.
    await new Promise((r) => setTimeout(r, 800));
    await route.fulfill({ status: 500, json: { message: "the database is down", code: "XX000" } });
  });
  await duplicates.filter({ hasText: "K Maps" }).getByRole("button", { name: "Same topic: merge" }).click();
  await duplicates.filter({ hasText: "Form K-map groups" }).getByRole("button", { name: "Keep separate" }).click();
  await expect(duplicates).toHaveCount(0);

  await expect(page.locator('[data-part="save-error"]')).toContainText("Couldn't save: the database is down");
  await page.waitForFunction(() => document.documentElement.dataset.saving === "0");
  expect(calls, "the save queued behind the failed one never ran").toBe(1);
  // Both changes are gone from the screen, as they are from the database.
  await expect(duplicates).toHaveCount(2);
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.locator('[data-part="save-error"]')).toHaveCount(0);
  const s = await stored(page, student);
  expect(s.courses[0].topics.find((t: Topic) => t.id === id.C)).toMatchObject({ review: "proposed", uncertain: { candidateId: id.B } });
  expect(s.objectives[ID][id.b3].uncertain).toMatchObject({ candidateId: id.b1 });
});
