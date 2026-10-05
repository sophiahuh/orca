import type { Page, Route } from "@playwright/test";
import path from "node:path";
import { expect, test, STORAGE_KEY } from "./fixture";

/**
 * The upload pipeline end to end in the browser: a real ALD deck read by pdf.js, with the model
 * steps answered by stubs at /api/pipeline/*. What's under test is the orchestration and the
 * store, not the model's judgement (scripts/score-extraction.ts covers that with a real key).
 */
const DECK = path.join(process.cwd(), "docs/samples/ald/L02_Combinational.pdf");
const anchor = { locator: "slide 12", excerpt: "x + xy = x" };

type Handler = (input: Record<string, unknown>) => unknown;

async function stubModel(page: Page, handlers: Record<string, Handler>) {
  await page.route("**/api/llm/status", (route) => route.fulfill({ json: { serverModel: "claude-opus-5-5" } }));
  await page.route("**/api/pipeline/*", async (route: Route) => {
    const step = new URL(route.request().url()).pathname.split("/").pop()!;
    const handler = handlers[step];
    if (!handler) return route.fulfill({ status: 500, json: { error: `no stub for ${step}` } });
    const { input } = route.request().postDataJSON() as { input: Record<string, unknown> };
    return route.fulfill({ json: { output: handler(input), model: "claude-opus-5-5" } });
  });
}

const shortQ = (objectiveId: string, prompt: string, exact: string) => ({
  objectiveId,
  kind: "Short answer",
  tier: "retrieval",
  prompt,
  options: [],
  answer: -1,
  exact: [exact],
  rubric: null,
  explanation: "Because.",
  anchor,
  figureSlide: null,
});

/** Answers every generate call with `perObjective` short questions per objective, and solves them all correctly. */
function honestGenerator(perObjective: number) {
  const answers = new Map<string, string>();
  return {
    generate: (input: Record<string, unknown>) => {
      const objectives = input.objectives as Array<{ id: string; name: string; need: number }>;
      return {
        questions: objectives.flatMap((o) =>
          Array.from({ length: Math.min(perObjective, o.need) }, (_, i) => {
            const prompt = `${o.name}: case ${i + 1}?`;
            answers.set(prompt, String(i + 1));
            return shortQ(o.id, prompt, String(i + 1));
          }),
        ),
      };
    },
    solve: (input: Record<string, unknown>) => ({
      answers: (input.questions as Array<{ id: string; prompt: string }>).map((q) => ({ id: q.id, choice: null, text: answers.get(q.prompt) ?? "?" })),
    }),
  };
}

async function createCourse(page: Page, name: string) {
  await page.goto("/new-course");
  await page.getByPlaceholder("Advanced Logic Design").fill(name);
  await page.getByRole("button", { name: "Create Course" }).click();
  await expect(page).toHaveURL(/\/home$/);
}

async function upload(page: Page, type = "Lecture") {
  await page.goto("/add-material");
  await page.locator('input[type="file"]').setInputFiles(DECK);
  await expect(page.getByText(/slides · text read on this device/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: type, exact: true }).click();
  await page.getByRole("button", { name: /generate quizzes/ }).click();
}

async function stored(page: Page) {
  return page.evaluate((key) => JSON.parse(window.localStorage.getItem(key)!), STORAGE_KEY);
}

test("a lecture upload maps topics and objectives, writes checked questions and lands them on the trail", async ({ page }) => {
  const gen = honestGenerator(2);
  await stubModel(page, {
    extract: () => ({
      topics: [
        { localId: "t1", existingId: null, name: "Boolean Algebra", aliases: [], summary: "Theorems.", slideStart: 10, slideEnd: 20 },
        { localId: "t2", existingId: null, name: "Karnaugh Maps", aliases: ["K-Maps"], summary: "Grouping.", slideStart: 30, slideEnd: 40 },
      ],
      objectives: [
        { localId: "o1", existingId: null, topicRef: "t1", name: "Simplify with absorption", description: "", aliases: [], origin: "material", places: [anchor], emphasis: null },
        { localId: "o2", existingId: null, topicRef: "t2", name: "Group ones on a K-map", description: "", aliases: [], origin: "material", places: [anchor], emphasis: null },
        { localId: "o3", existingId: null, topicRef: "t2", name: "Use don't-cares", description: "", aliases: [], origin: "material", places: [anchor], emphasis: null },
      ],
      relations: [{ from: "o2", to: "o1", type: "builds-on", anchor: null }],
    }),
    ...gen,
  });
  await createCourse(page, "Logic");
  await upload(page);
  await expect(page.getByText("Added 2 topics, 3 objectives and 6 questions.")).toBeVisible({ timeout: 30_000 });

  const state = await stored(page);
  const course = state.courses[0];
  expect(course.topics.map((t: { name: string; review: string }) => [t.name, t.review])).toEqual([
    ["Boolean Algebra", "proposed"],
    ["Karnaugh Maps", "proposed"],
  ]);
  expect(Object.values(state.objectives[course.id]).map((o) => (o as { review: string }).review)).toEqual(["proposed", "proposed", "proposed"]);
  expect(state.relations[course.id]).toHaveLength(1);
  expect(state.runs).toHaveLength(1);
  expect(state.materials[0].filename).toBe("L02_Combinational.pdf");

  await expect(page).toHaveURL(/\/course\/logic\/review\?run=/);
  await expect(page.locator("[data-part=run-summary]")).toContainText("2 new topics, 3 new objectives, 0 existing objectives covered again, 6 questions added.");
  await expect(page.locator("[data-part=new-topic]")).toHaveCount(2);
  await page.goto("/course/logic");
  await expect(page.locator("[data-part=label]").first()).toContainText("Boolean Algebra");
  await page.goto(`/quiz/logic/${course.topics[0].id}`);
  await expect(page.getByText("Simplify with absorption: case 1?")).toBeVisible();
});

test("re-uploading the same deck adds nothing new", async ({ page }) => {
  const gen = honestGenerator(6);
  let existing: { topics: Array<{ id: string }>; objectives: Array<{ id: string; topicId: string }> } | null = null;
  await stubModel(page, {
    extract: (input) => {
      const topics = input.existingTopics as Array<{ id: string; name: string }>;
      const objectives = input.existingObjectives as Array<{ id: string; name: string; topicId: string }>;
      // Second time round, the model reuses the ids it was shown, as the prompt asks.
      if (topics.length) existing = { topics, objectives };
      return topics.length
        ? {
            topics: topics.map((t) => ({ localId: t.id, existingId: t.id, name: t.name, aliases: [], summary: "", slideStart: 1, slideEnd: 2 })),
            objectives: objectives.map((o) => ({ localId: o.id, existingId: o.id, topicRef: o.topicId, name: o.name, description: "", aliases: [], origin: "material", places: [anchor], emphasis: null })),
            relations: [],
          }
        : {
            topics: [{ localId: "t1", existingId: null, name: "Boolean Algebra", aliases: [], summary: "", slideStart: 1, slideEnd: 2 }],
            objectives: [{ localId: "o1", existingId: null, topicRef: "t1", name: "Simplify with absorption", description: "", aliases: [], origin: "material", places: [anchor], emphasis: null }],
            relations: [],
          };
    },
    ...gen,
  });
  await createCourse(page, "Logic");
  await upload(page);
  await expect(page.getByText("Added 1 topic, 1 objective and 6 questions.")).toBeVisible({ timeout: 30_000 });
  await upload(page);
  await expect(page.getByText("Added 0 topics, 0 objectives and 0 questions.")).toBeVisible({ timeout: 30_000 });
  expect(existing).not.toBeNull();
  const state = await stored(page);
  expect(state.runs[1].objectivesAttached).toHaveLength(1);
  expect(Object.values(state.objectives[state.courses[0].id])[0]).toMatchObject({ signals: [{ places: [anchor] }, { places: [anchor] }] });
});
