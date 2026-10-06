import test from "node:test";
import assert from "node:assert/strict";
import type { Material, Objective, QuizQuestion, Topic } from "../../src/lib/data.ts";
import { type CallStep, type RunInput, runUpload } from "../../src/lib/pipeline/run.ts";
import { applyUploadPlan } from "../../src/lib/pipeline/apply.ts";
import type { ExtractOutput, GeneratedQuestion, StepInput, StepName, StepOutput } from "../../src/lib/pipeline/schemas.ts";

type Handlers = { [S in StepName]?: (input: StepInput<S>) => StepOutput<S> | Promise<StepOutput<S>> };

/** A fake model: each step answers from its handler; calls are recorded. */
function fakeModel(h: Handlers) {
  const calls: Array<{ step: StepName; input: unknown }> = [];
  const call: CallStep = async (step, input) => {
    calls.push({ step, input });
    const handler = h[step] as ((i: typeof input) => StepOutput<typeof step>) | undefined;
    if (!handler) throw new Error(`unexpected ${step} call`);
    return handler(input);
  };
  return { call, calls };
}

let n = 0;
const newId = () => `id${++n}`;
const material = (type: Material["type"] = "Lecture"): Material => ({ id: "mat", courseId: "c", filename: "L02.pdf", type, assigned: null, due: null, reflect: false });
const pages = [1, 2, 3, 4].map((i) => ({ n: i, text: `slide ${i} text about logic` }));
const input = (over: Partial<RunInput> = {}): RunInput => ({
  course: { id: "c", name: "Logic", short: "LOG", topics: [] },
  objectives: {},
  bank: {},
  relations: [],
  material: material(),
  pages,
  runId: "run1",
  model: "test-model",
  now: "2026-10-05T12:00:00Z",
  ...over,
});
const anchor = { locator: "slide 2", excerpt: "x + xy = x" };
const short = (objectiveId: string, prompt: string, exact: string[], extra: Partial<GeneratedQuestion> = {}): GeneratedQuestion => ({
  objectiveId,
  kind: "Short answer",
  tier: "retrieval",
  prompt,
  options: [],
  answer: -1,
  exact,
  rubric: null,
  explanation: "Because.",
  anchor,
  figureSlide: null,
  ...extra,
});
const mc = (objectiveId: string, prompt: string, answer: number, extra: Partial<GeneratedQuestion> = {}): GeneratedQuestion => ({
  objectiveId,
  kind: "Multiple choice",
  tier: "retrieval",
  prompt,
  options: ["A", "B", "C", "D"],
  answer,
  exact: null,
  rubric: null,
  explanation: "Because.",
  anchor,
  figureSlide: null,
  ...extra,
});

const lectureExtract: ExtractOutput = {
  topics: [
    { localId: "t1", existingId: null, name: "Boolean Algebra", aliases: [], summary: "Theorems.", slideStart: 1, slideEnd: 2 },
    { localId: "t2", existingId: null, name: "Karnaugh Maps", aliases: ["K-Maps"], summary: "Grouping.", slideStart: 3, slideEnd: 4 },
  ],
  objectives: [
    { localId: "o1", existingId: null, topicRef: "t1", name: "Simplify with absorption", description: "", aliases: [], origin: "material", places: [anchor], emphasis: null },
    { localId: "o2", existingId: null, topicRef: "t2", name: "Group ones on a K-map", description: "", aliases: [], origin: "material", places: [{ locator: "slide 3", excerpt: "groups" }], emphasis: { kind: "tested", quote: "on the exam" } },
    { localId: "o3", existingId: null, topicRef: "t2", name: "Read binary numbers", description: "", aliases: [], origin: "inferred", places: [], emphasis: null },
  ],
  relations: [
    { from: "o2", to: "o1", type: "builds-on", anchor: null },
    { from: "o2", to: "nope", type: "builds-on", anchor: null },
  ],
  instructionsFound: [],
};

test("a first lecture creates proposed topics and objectives with signals, relations and questions", async () => {
  const model = fakeModel({
    extract: () => lectureExtract,
    generate: (i) => ({
      questions: i.objectives.flatMap((o) =>
        o.name.startsWith("Simplify") ? [short(o.id, "Simplify x + xy.", ["x"])] : o.name.startsWith("Group") ? [mc(o.id, "Which group?", 2)] : [short(o.id, "What is 101 in decimal?", ["5"])],
      ),
    }),
  });
  const progress: string[] = [];
  const plan = await runUpload(input(), { call: model.call, newId, onProgress: (p) => progress.push(p.stage) });

  assert.equal(plan.newTopics.length, 2);
  assert.ok(plan.newTopics.every((t) => t.review === "proposed" && t.materialId === "mat"));
  assert.deepEqual(plan.newTopics[1].aliases, ["K-Maps"]);
  assert.equal(plan.newObjectives.length, 3);
  assert.ok(plan.newObjectives.every((o) => o.review === "proposed" && o.runId === "run1"));
  const [simplify, group, inferred] = plan.newObjectives;
  assert.equal(group.topicId, plan.newTopics[1].id);
  assert.deepEqual(group.signals, [{ materialId: "mat", materialType: "Lecture", places: [{ locator: "slide 3", excerpt: "groups" }], emphasis: { kind: "tested", quote: "on the exam" } }]);
  assert.equal(inferred.origin, "inferred");
  assert.deepEqual(inferred.signals, []);
  assert.deepEqual(plan.relations.map((r) => [r.from, r.to, r.type]), [[group.id, simplify.id, "builds-on"]], "the relation to an unknown objective is dropped");

  const all = Object.values(plan.questions).flat();
  assert.equal(all.length, 3);
  assert.ok(all.every((q) => q.materialId === "mat"));
  assert.equal(all.find((q) => q.objectiveId === inferred.id)!.anchor, undefined, "inferred questions carry no anchor");
  assert.equal(plan.run.questionsAdded, 3);
  assert.deepEqual(progress, ["mapping", "matching", "writing"]);
  assert.deepEqual([...new Set(model.calls.map((c) => c.step))], ["extract", "generate"], "no second model call checks the questions");
  assert.equal(model.calls.filter((c) => c.step === "reconcile").length, 0, "nothing existing to compare against");
  const generateInputs = model.calls.filter((c) => c.step === "generate").map((c) => c.input as StepInput<"generate">);
  assert.ok(generateInputs.every((g) => g.objectives.every((o) => o.need === 6)));
});

test("a later upload reuses existing items, records aliases and signals, skips rejected ones and flags uncertain ones", async () => {
  const topics: Topic[] = [
    { id: "T1", name: "Karnaugh Maps", aliases: [], review: "confirmed", pos: { x: 0, y: 0 } },
    { id: "T2", name: "Course logistics", aliases: [], review: "archived", pos: { x: 0, y: 0 } },
  ];
  const obj = (id: string, name: string, extra: Partial<Objective> = {}): Objective => ({ id, topicId: "T1", name, description: "", aliases: [], origin: "material", review: "confirmed", materialId: "old", runId: "r0", signals: [], ...extra });
  const objectives = {
    O1: obj("O1", "Group ones on a Karnaugh map"),
    O2: obj("O2", "Use don't-cares", { review: "archived" }),
    O3: obj("O3", "Place minterms using Gray code order"),
  };
  const bank: Record<string, QuizQuestion[]> = { T1: [1, 2, 3, 4, 5].map((i) => ({ id: `q${i}`, objectiveId: "O1", prompt: `Old ${i}` }) as QuizQuestion) };
  const model = fakeModel({
    extract: () => ({
      topics: [
        { localId: "T1", existingId: "T1", name: "K-maps", aliases: [], summary: "", slideStart: 1, slideEnd: 4 },
        { localId: "t9", existingId: null, name: "Course Logistics", aliases: [], summary: "", slideStart: 1, slideEnd: 1 },
      ],
      objectives: [
        { localId: "a", existingId: null, topicRef: "T1", name: "Group ones on a Karnaugh Map", description: "", aliases: ["Form K-map groups"], origin: "material", places: [anchor], emphasis: null },
        { localId: "b", existingId: null, topicRef: "T1", name: "Use don't-cares", description: "", aliases: [], origin: "material", places: [anchor], emphasis: null },
        { localId: "c", existingId: null, topicRef: "T1", name: "Order minterms by Gray code on a map", description: "", aliases: [], origin: "material", places: [anchor], emphasis: null },
        { localId: "d", existingId: null, topicRef: "T1", name: "Find essential prime implicants", description: "", aliases: [], origin: "material", places: [anchor], emphasis: null },
        { localId: "e", existingId: null, topicRef: "t9", name: "Know the grading policy", description: "", aliases: [], origin: "material", places: [anchor], emphasis: null },
      ],
      relations: [],
      instructionsFound: [],
    }),
    reconcile: (i) =>
      i.candidate.name.startsWith("Order minterms")
        ? { decision: "uncertain", matchId: "O3", reasoning: "Close to Gray-code placement" }
        : { decision: "new", matchId: null, reasoning: "Different skill" },
    generate: () => ({ questions: [] }),
  });
  const plan = await runUpload(input({ course: { id: "c", name: "Logic", short: "LOG", topics }, objectives, bank }), { call: model.call, newId });

  assert.equal(plan.newTopics.length, 0);
  assert.deepEqual(plan.topicAliases, { T1: ["K-maps"] });
  assert.deepEqual(Object.keys(plan.objectiveUpdates), ["O1"]);
  assert.deepEqual(plan.objectiveUpdates.O1.aliases, ["Form K-map groups"]);
  assert.equal(plan.objectiveUpdates.O1.signal!.places.length, 1);
  const names = plan.newObjectives.map((o) => [o.name, o.review, o.uncertain?.candidateId ?? null]);
  assert.deepEqual(names, [
    ["Order minterms by Gray code on a map", "proposed", "O3"],
    ["Find essential prime implicants", "confirmed", null],
  ]);
  assert.deepEqual(
    plan.run.dropped.map((d) => d.prompt),
    ['Topic "Course Logistics"', 'Objective "Use don\'t-cares"', 'Objective "Know the grading policy"'],
  );
  const generate = model.calls.find((c) => c.step === "generate")!.input as StepInput<"generate">;
  assert.equal(generate.objectives.find((o) => o.id === "O1")!.need, 1, "tops O1 up from 5 to 6");
  assert.deepEqual(generate.objectives.find((o) => o.id === "O1")!.existingPrompts, ["Old 1", "Old 2", "Old 3", "Old 4", "Old 5"]);
});

test("questions that duplicate the bank or break the rules are dropped with a reason; the rest are kept unchecked", async () => {
  const lone: ExtractOutput = {
    topics: [{ localId: "t1", existingId: null, name: "Logic", aliases: [], summary: "", slideStart: 1, slideEnd: 4 }],
    objectives: [{ localId: "o1", existingId: null, topicRef: "t1", name: "Do logic", description: "", aliases: [], origin: "material", places: [anchor], emphasis: null }],
    relations: [],
    instructionsFound: [],
  };
  const model = fakeModel({
    extract: () => lone,
    generate: (i) => {
      const id = i.objectives[0].id;
      return { questions: [mc(id, "Which gate?", 1), short(id, "Old question", ["x"]), short(id, "No anchor?", ["x"], { anchor: null })] };
    },
  });
  const plan = await runUpload(input({ bank: { other: [{ id: "old", prompt: "old question.", objectiveId: "x" } as QuizQuestion] } }), { call: model.call, newId });
  assert.deepEqual(Object.values(plan.questions).flat().map((q) => q.prompt), ["Which gate?"]);
  const reasons = Object.fromEntries(plan.run.dropped.map((d) => [d.prompt, d.reason]));
  assert.match(reasons["Old question"], /already has this question/);
  assert.match(reasons["No anchor?"], /no source anchor/);
});

test("a figure question keeps its slide image, or is dropped when the slide can't be rendered", async () => {
  const run = (render: (n: number) => Promise<string | null>) =>
    runUpload(input(), {
      call: fakeModel({
        extract: () => ({ ...lectureExtract, objectives: lectureExtract.objectives.slice(0, 1), relations: [], instructionsFound: [] }),
        generate: (i) => ({ questions: [mc(i.objectives[0].id, "In the figure, which gate?", 1, { figureSlide: 2 })] }),
      }).call,
      newId,
      renderFigure: render,
    });
  const ok = await run(async (s) => `data:image/png;base64,slide${s}`);
  assert.deepEqual(Object.values(ok.questions).flat()[0].figure, { src: "data:image/png;base64,slide2", alt: "Slide 2 of L02.pdf" });
  const missing = await run(async () => null);
  assert.equal(missing.run.questionsAdded, 0);
  assert.match(missing.run.dropped[0].reason, /slide 2 .* couldn't be rendered/);
});

test("applying a plan adds topics, objectives, questions and relations and updates existing objectives", async () => {
  const plan = await runUpload(input(), {
    call: fakeModel({ extract: () => lectureExtract, generate: () => ({ questions: [] }) }).call,
    newId,
  });
  const existing = { id: "OLD", topicId: "T", name: "Old", description: "", aliases: [], origin: "material", review: "confirmed", materialId: null, runId: null, signals: [] } as Objective;
  plan.objectiveUpdates.OLD = { aliases: ["Older"], signal: { materialId: "mat", materialType: "Lecture", places: [anchor] } };
  const s = applyUploadPlan({ topics: [], objectives: { OLD: existing }, bank: {}, relations: [] }, plan);
  assert.equal(s.topics.length, 2);
  assert.equal(Object.keys(s.objectives).length, 4);
  assert.deepEqual(s.objectives.OLD.aliases, ["Older"]);
  assert.equal(s.objectives.OLD.signals.length, 1);
  assert.equal(s.relations.length, 1);
  assert.throws(() => applyUploadPlan({ topics: [], objectives: {}, bank: {}, relations: [] }, plan), /isn't in the course/);
});

test("the run record carries the hidden text the server dropped from the file", async () => {
  const model = fakeModel({ extract: () => ({ ...lectureExtract, relations: [], instructionsFound: [] }) });
  const hiddenText = { items: 2, pages: [4] };
  const plan = await runUpload(input({ hiddenText }), { call: model.call, newId, structureOnly: true });
  assert.deepEqual(plan.run.hiddenText, hiddenText);
  assert.equal((await runUpload(input(), { call: fakeModel({ extract: () => ({ ...lectureExtract, relations: [], instructionsFound: [] }) }).call, newId, structureOnly: true })).run.hiddenText, undefined);
});
