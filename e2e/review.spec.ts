import type { Page } from "@playwright/test";
import type { Topic } from "../src/lib/data";
import { expect, test, STORAGE_KEY, laidOut, objective, seedState, short } from "./fixture";

/** A course as an upload left it: one confirmed topic, two new ones (one maybe a duplicate), an uncertain objective. */
const ID = "logic";
const topic = (id: string, name: string, review: Topic["review"], extra: Partial<Topic> = {}): Topic => ({ id, name, aliases: [], review, pos: { x: 0, y: 0 }, ...extra });

const STATE = {
  courses: [
    {
      id: ID,
      slug: ID,
      name: "Logic",
      short: "LOG",
      variant: "circuit",
      pos: { x: 70, y: 110 },
      topics: laidOut([
        topic("A", "Boolean Algebra", "confirmed"),
        topic("B", "Karnaugh Maps", "proposed", { summary: "Grouping ones." }),
        topic("C", "K Maps", "proposed", { uncertain: { candidateId: "B", reasoning: "Both cover Karnaugh maps." } }),
      ]),
    },
  ],
  configs: { [ID]: { quick: { duration: "10 min", cadence: "Daily" }, deep: { duration: "3 hours", cadence: "Weekly" }, exam: { duration: "10 hours", cadence: "1 wk before exam" } } },
  weights: { [ID]: { homework: 25, practiceExams: 25, practiceProblems: 25, lectures: 25 } },
  objectives: {
    [ID]: {
      a1: objective("a1", "A", "Simplify with absorption", { signals: [{ materialId: "m", materialType: "Lecture", places: [{ locator: "slide 2", excerpt: "" }] }] }),
      b1: objective("b1", "B", "Group ones on a K-map", { review: "proposed" }),
      b2: objective("b2", "B", "Read binary numbers", { review: "proposed", origin: "inferred" }),
      b3: objective("b3", "B", "Form K-map groups", { review: "proposed", uncertain: { candidateId: "b1", reasoning: "Same skill, different wording." } }),
      c1: objective("c1", "C", "Use don't-cares", { review: "proposed" }),
    },
  },
  questionBank: {
    [ID]: {
      A: [short("qa1", "Boolean Algebra", "a1", "Simplify x + xy.", ["x"])],
      B: [short("qb1", "Karnaugh Maps", "b1", "How many ones in a quad?", ["4"]), short("qb3", "Karnaugh Maps", "b3", "Smallest group size?", ["1"])],
      C: [short("qc1", "K Maps", "c1", "Can a don't-care be left out?", ["yes"])],
    },
  },
  relations: { [ID]: [] },
  runs: [],
  evidence: [],
};

const stored = (page: Page) => page.evaluate((key) => JSON.parse(window.localStorage.getItem(key)!), STORAGE_KEY);

test.beforeEach(async ({ page }) => seedState(page, STATE));

test("the course page says how much is waiting for review", async ({ page }) => {
  await page.goto(`/course/${ID}`);
  await expect(page.getByRole("link", { name: "4 to review" })).toBeVisible();
  await page.getByRole("link", { name: "4 to review" }).click();
  await expect(page).toHaveURL(/\/review$/);
});

test("settling duplicates and confirming a topic", async ({ page }) => {
  await page.goto(`/course/${ID}/review`);
  const duplicates = page.locator("[data-part=duplicate]");
  await expect(duplicates).toHaveCount(2);
  await duplicates.filter({ hasText: "K Maps" }).getByRole("button", { name: "Same topic: merge" }).click();
  await duplicates.filter({ hasText: "Form K-map groups" }).getByRole("button", { name: "Keep separate" }).click();
  await expect(duplicates).toHaveCount(0);

  const card = page.locator("[data-part=new-topic]").filter({ hasText: "Karnaugh Maps" });
  await card.locator("li").filter({ hasText: "Read binary numbers" }).getByRole("button", { name: "Reject" }).click();
  await card.getByRole("button", { name: "Confirm topic" }).click();
  await expect(page.getByText("Nothing to review.")).toBeVisible();

  const s = await stored(page);
  const topics = s.courses[0].topics;
  expect(topics.find((t: Topic) => t.id === "C")).toMatchObject({ review: "archived", mergedInto: "B" });
  expect(topics.find((t: Topic) => t.id === "B")).toMatchObject({ review: "confirmed", aliases: ["K Maps"] });
  const o = s.objectives[ID];
  expect([o.b1.review, o.b2.review, o.b3.review, o.c1.review, o.c1.topicId]).toEqual(["confirmed", "archived", "confirmed", "confirmed", "B"]);
  expect(s.questionBank[ID].B.map((q: { id: string }) => q.id)).toEqual(["qb1", "qb3", "qc1"]);
});

test("renaming a new topic keeps its old name as an alias", async ({ page }) => {
  await page.goto(`/course/${ID}/review`);
  const card = page.locator("[data-part=new-topic]").filter({ hasText: "Karnaugh Maps" });
  await card.getByRole("button", { name: "Rename" }).click();
  // While editing, the name is an input's value, so find the field by its label rather than the card's text.
  const field = page.getByLabel("New name for Karnaugh Maps");
  await field.fill("Karnaugh Maps (K-Maps)");
  await field.press("Enter");
  await expect(page.locator("[data-part=new-topic]").filter({ hasText: "Karnaugh Maps (K-Maps)" })).toBeVisible();
  expect((await stored(page)).courses[0].topics[1].aliases).toEqual(["Karnaugh Maps"]);
});

test("the objective list shows status and weight, and rejects, restores, merges and un-merges", async ({ page }) => {
  await page.goto(`/course/${ID}/objectives`);
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
  expect((await stored(page)).objectives[ID].b3.mergedInto).toBe("b1");
  await row("Group ones on a K-map").getByRole("button", { name: "Undo" }).click();
  await expect(row("Form K-map groups")).toBeVisible();
});

test("questions of unreviewed objectives are tagged; rejected ones are never asked", async ({ page }) => {
  await page.goto(`/quiz/${ID}/B`);
  await expect(page.getByText("How many ones in a quad?")).toBeVisible();
  await expect(page.getByText("Unreviewed", { exact: true })).toBeVisible();

  await page.goto(`/quiz/${ID}/A`);
  await expect(page.getByText("Simplify x + xy.")).toBeVisible();
  await expect(page.getByText("Unreviewed", { exact: true })).toHaveCount(0);

  await page.goto(`/course/${ID}/objectives`);
  await page.locator('[data-objective="Group ones on a K-map"]').getByRole("button", { name: "Reject" }).click();
  await page.goto(`/quiz/${ID}/B`);
  await expect(page.getByText("Smallest group size?")).toBeVisible();
  await expect(page.getByText("How many ones in a quad?")).toHaveCount(0);
});
