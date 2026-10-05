import test from "node:test";
import assert from "node:assert/strict";
import type { Material, Objective, QuizQuestion, Topic } from "../../src/lib/data.ts";
import type { CallStep } from "../../src/lib/pipeline/run.ts";
import { type TopUpInput, pagesFor, runTopUp, topUpTargets } from "../../src/lib/pipeline/topup.ts";
import { locatorPages } from "../../src/lib/course/study.ts";
import type { GeneratedQuestion, StepInput } from "../../src/lib/pipeline/schemas.ts";

const material = (id: string): Material => ({ id, courseId: "c", filename: `${id}.pdf`, type: "Lecture", assigned: null, due: null, reflect: false });
const topic: Topic = { id: "t", name: "Two's complement", aliases: [], review: "confirmed", pos: { x: 0, y: 0 }, summary: "Signed numbers" };
const objective = (id: string, extra: Partial<Objective> = {}): Objective => ({
  id,
  topicId: "t",
  name: `Objective ${id}`,
  description: "",
  aliases: [],
  origin: "material",
  review: "confirmed",
  materialId: "L1",
  runId: "r",
  signals: [{ materialId: "L1", materialType: "Lecture", places: [{ locator: "slide 2", excerpt: "x" }] }],
  ...extra,
});
const q = (id: string, objectiveId: string, prompt = `Question ${id}?`): QuizQuestion => ({
  id,
  kind: "Short answer",
  tier: "retrieval",
  topic: "Two's complement",
  prompt,
  options: [],
  answer: -1,
  exact: ["1"],
  explanation: "",
  anchor: { locator: "slide 2", excerpt: "x" },
  objectiveId,
});

const base = (over: Partial<TopUpInput> = {}): TopUpInput => ({
  course: { id: "c", name: "Logic", short: "LOG", topics: [topic] },
  objectives: { a: objective("a"), b: objective("b") },
  bank: { t: [q("a1", "a"), q("a2", "a"), q("a3", "a"), q("a4", "a"), q("b1", "b"), q("b2", "b"), q("b3", "b")] },
  materials: [material("L1")],
  materialPages: { L1: [{ n: 2, text: "Two's complement: invert and add one." }] },
  objectiveIds: ["a", "b"],
  answered: new Set(["a1", "a2"]),
  runId: "top1",
  model: "test-model",
  now: "2026-10-05T12:00:00Z",
  ...over,
});

test("only objectives under 3 unseen questions are topped up, back to 6 unseen", () => {
  const { byMaterial, skipped } = topUpTargets(base());
  assert.deepEqual(skipped, []);
  assert.deepEqual(byMaterial.get("L1")!.map((t) => [t.objective.id, t.need, t.existing.length]), [["a", 4, 4]]);
});

test("merged objectives top up their survivor; archived ones never", () => {
  const objectives = { a: objective("a"), old: objective("old", { mergedInto: "a", review: "archived" }), b: objective("b", { review: "archived" }) };
  const { byMaterial } = topUpTargets(base({ objectives, objectiveIds: ["old", "b"], bank: { t: [q("x1", "old")] }, answered: new Set() }));
  assert.deepEqual(byMaterial.get("L1")!.map((t) => [t.objective.id, t.need]), [["a", 5]]);
});

test("the material that covers it most is used; without kept text the student is told why", () => {
  const covered = objective("a", {
    signals: [
      { materialId: "L1", materialType: "Lecture", places: [{ locator: "slide 2", excerpt: "x" }] },
      { materialId: "L2", materialType: "Lecture", places: [{ locator: "slide 5", excerpt: "y" }, { locator: "slide 6", excerpt: "z" }] },
    ],
  });
  const input = base({ objectives: { a: covered }, materials: [material("L1"), material("L2")], materialPages: { L1: [{ n: 2, text: "" }], L2: [{ n: 5, text: "" }, { n: 6, text: "" }] }, objectiveIds: ["a"] });
  assert.deepEqual([...topUpTargets(input).byMaterial.keys()], ["L2"]);
  assert.deepEqual(topUpTargets({ ...input, materialPages: {} }).skipped, [{ objectiveId: "a", reason: "its material's text isn't stored (it was added without its file); upload the file again" }]);
  const authored = objective("a", { materialId: null, signals: [] });
  assert.deepEqual(topUpTargets({ ...input, objectives: { a: authored } }).skipped, [{ objectiveId: "a", reason: "no course material to write from" }]);
});

test("runTopUp writes and checks questions, drops duplicates and failures, and records a top-up run", async () => {
  const generated = (objectiveId: string, prompt: string, exact: string): GeneratedQuestion => ({
    objectiveId,
    kind: "Short answer",
    tier: "retrieval",
    prompt,
    options: [],
    answer: -1,
    exact: [exact],
    rubric: null,
    explanation: "Because.",
    anchor: { locator: "slide 2", excerpt: "invert and add one" },
    figureSlide: null,
  });
  const calls: string[] = [];
  const call = (async (step: string, input: unknown) => {
    calls.push(step);
    if (step === "generate") {
      const g = input as StepInput<"generate">;
      assert.equal(g.objectives[0].need, 4);
      assert.ok(g.objectives[0].existingPrompts.includes("Question a1?"));
      assert.equal(g.pages[0].text, "Two's complement: invert and add one.");
      return { questions: [generated("a", "Negate 0101 in 4 bits.", "1011"), generated("a", "Question a1?", "1"), generated("a", "Negate 0001.", "1111")] };
    }
    if (step === "solve") {
      const s = input as StepInput<"solve">;
      return { answers: s.questions.map((x) => ({ id: x.id, choice: null, text: x.prompt.startsWith("Negate 0101") ? "1011" : x.prompt === "Question a1?" ? "1" : "0000" })) };
    }
    throw new Error(`unexpected ${step}`);
  }) as CallStep;
  let n = 0;
  const plan = await runTopUp(base(), { call, newId: () => `new${++n}` });
  assert.deepEqual(plan.questions.t.map((x) => x.prompt), ["Negate 0101 in 4 bits."]);
  assert.equal(plan.questions.t[0].materialId, "L1");
  assert.equal(plan.run.kind, "top-up");
  assert.equal(plan.run.id, "top1");
  assert.equal(plan.run.materialId, "L1");
  assert.equal(plan.run.status, "done");
  assert.equal(plan.run.questionsAdded, 1);
  assert.deepEqual(plan.run.objectivesAttached, ["a"]);
  assert.deepEqual(plan.run.dropped.map((d) => d.reason), ["the course already has this question", 'an independent solve answered "0000", not 1111']);
  assert.deepEqual(calls, ["generate", "solve"]);
});

test("nothing needed, nothing called", async () => {
  const call = (async () => {
    throw new Error("no calls expected");
  }) as CallStep;
  const plan = await runTopUp(base({ answered: new Set() }), { call, newId: () => "x" });
  assert.deepEqual(plan.questions, {});
  assert.deepEqual(plan.skipped, []);
  assert.deepEqual([plan.run.materialId, plan.run.questionsAdded, plan.run.dropped], [null, 0, []]);
});

test("an objective that can't be topped up is in the run's left-out list, saying why", async () => {
  const call = (async () => {
    throw new Error("no calls expected");
  }) as CallStep;
  const plan = await runTopUp(base({ materialPages: {} }), { call, newId: () => "x" });
  assert.deepEqual(plan.run.dropped, [{ prompt: 'Objective "Objective a"', reason: "skipped: its material's text isn't stored (it was added without its file); upload the file again" }]);
});

test("locators name pages or slides; anything else names none", () => {
  assert.deepEqual(locatorPages("slide 14"), [14]);
  assert.deepEqual(locatorPages("Slides 3–5"), [3, 4, 5]);
  assert.deepEqual(locatorPages("p. 212"), [212]);
  assert.deepEqual(locatorPages("pages 40-41"), [40, 41]);
  assert.deepEqual(locatorPages("problem 3"), []);
});

test("a top-up sends only the anchored pages and their neighbours, never a whole long file", () => {
  const book = Array.from({ length: 100 }, (_, i) => ({ n: i + 1, text: `page ${i + 1}` }));
  const anchored = objective("a", { signals: [{ materialId: "L1", materialType: "Lecture", places: [{ locator: "slide 10", excerpt: "" }, { locator: "slides 40-41", excerpt: "" }] }] });
  assert.deepEqual(pagesFor(anchored, topic, material("L1"), book)!.map((p) => p.n), [9, 10, 11, 39, 40, 41, 42]);

  const unanchored = objective("a", { signals: [] });
  const fromTopic = { ...topic, source: { filename: "L1.pdf", slideStart: 20, slideEnd: 22 } };
  assert.deepEqual(pagesFor(unanchored, fromTopic, material("L1"), book)!.map((p) => p.n), [20, 21, 22], "its topic's range in this file");
  assert.equal(pagesFor(unanchored, topic, material("L1"), book), null, "a long file with no anchors is not sent whole");
  assert.equal(pagesFor(unanchored, topic, material("L1"), book.slice(0, 30))!.length, 30, "a short one is");

  const plan = topUpTargets(base({ objectives: { a: anchored }, objectiveIds: ["a"], materialPages: { L1: book } }));
  assert.deepEqual(plan.pages.get("L1")!.map((p) => p.n), [9, 10, 11, 39, 40, 41, 42]);
  const skipped = topUpTargets(base({ objectives: { a: unanchored }, objectiveIds: ["a"], materialPages: { L1: book } })).skipped;
  assert.deepEqual(skipped, [{ objectiveId: "a", reason: "Orca doesn't know where in L1.pdf it's taught, and the file is too long to send whole" }]);
});
