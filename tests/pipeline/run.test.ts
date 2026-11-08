import test from "node:test";
import assert from "node:assert/strict";
import type { Material, Objective, QuizQuestion, Topic } from "../../src/lib/data.ts";
import { type CallStep, type RunInput, runUpload } from "../../src/lib/pipeline/run.ts";
import { applyUploadPlan } from "../../src/lib/pipeline/apply.ts";
import type { GeneratedQuestion, StepInput, StepName, StepOutput } from "../../src/lib/pipeline/schemas.ts";
import { type ExtractOutput, mapAnswer, objectivesAnswer } from "../support/extract-scenario.ts";

/** Step handlers, plus `extract`: what the whole file holds, answered part by part (map) and topic by topic (objectives). */
type Handlers = { [S in StepName]?: (input: StepInput<S>) => StepOutput<S> | Promise<StepOutput<S>> } & { extract?: () => ExtractOutput };

/** A fake model: each step answers from its handler; calls are recorded. */
function fakeModel(h: Handlers) {
  const calls: Array<{ step: StepName; input: unknown }> = [];
  const call: CallStep = async (step, input) => {
    calls.push({ step, input });
    if (step === "map" && !h.map && h.extract) return mapAnswer(h.extract(), input as StepInput<"map">) as StepOutput<typeof step>;
    if (step === "objectives" && !h.objectives && h.extract) return objectivesAnswer(h.extract(), input as StepInput<"objectives">) as StepOutput<typeof step>;
    const handler = h[step as StepName] as ((i: typeof input) => StepOutput<typeof step>) | undefined;
    // The link step runs after every upload with new topics; unless a test says otherwise it finds nothing.
    if (!handler && step === "link") return { links: [] } as StepOutput<typeof step>;
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
  materials: [{ id: "mat", filename: "L02.pdf" }],
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

/**
 * Weak points first: an upload writes questions only for objectives marked in it. Tests about question
 * writing mark every objective: each page is read from its image and wholly marked (`markedPages`,
 * with a marker description), and each objective names a passage on its topic's first page.
 */
const markedPages = (ps: RunInput["pages"]): RunInput["pages"] => ps.map((p) => ({ ...p, text: `[marked: ★] ${p.text} [/marked]`, source: "vision" }));
const marking = (ps: RunInput["pages"] = pages) => ({ pages: markedPages(ps), markers: "★ = lost" });
function markAll(e: ExtractOutput, quote = "text about logic"): ExtractOutput {
  const first = (ref: string) => e.topics.find((t) => t.localId === ref || t.existingId === ref)?.slideStart ?? 1;
  return { ...e, objectives: e.objectives.map((o) => ({ ...o, struggled: [{ page: first(o.topicRef), quote }] })) };
}

const lectureExtract: ExtractOutput = {
  topics: [
    { localId: "t1", existingId: null, name: "Boolean Algebra", summary: "Theorems.", slideStart: 1, slideEnd: 2 },
    { localId: "t2", existingId: null, name: "Karnaugh Maps", summary: "Grouping.", slideStart: 3, slideEnd: 4 },
  ],
  objectives: [
    { localId: "o1", existingId: null, topicRef: "t1", name: "Simplify with absorption", description: "", origin: "material", places: [anchor], emphasis: null },
    { localId: "o2", existingId: null, topicRef: "t2", name: "Group ones on a K-map", description: "", origin: "material", places: [{ locator: "slide 3", excerpt: "groups" }], emphasis: { kind: "tested", quote: "on the exam" } },
    { localId: "o3", existingId: null, topicRef: "t2", name: "Read binary numbers", description: "", origin: "inferred", places: [], emphasis: null },
  ],
  relations: [
    { from: "t1", to: "t2", type: "used-in", anchor: null, reason: "K-maps group terms using Boolean algebra's absorption." },
    { from: "t2", to: "nope", type: "related", anchor: null, reason: "Points at a topic that isn't there." },
  ],
  instructionsFound: [],
};

test("a first lecture creates proposed topics and objectives with signals, relations and questions", async () => {
  const model = fakeModel({
    extract: () => markAll(lectureExtract),
    link: () => ({
      links: [
        { from: "t1", to: "t2", type: "used-in", reason: "K-maps group terms using Boolean algebra's absorption." },
        { from: "t2", to: "t1", type: "related", reason: "K-maps find by picture what algebra finds by rules." },
        { from: "t1", to: "t1", type: "related", reason: "Linked to itself, so dropped." },
        { from: "t9", to: "t1", type: "related", reason: "From a topic that doesn't exist." },
      ],
    }),
    generate: (i) => ({
      questions: i.objectives.flatMap((o) =>
        o.name.startsWith("Simplify") ? [short(o.id, "Simplify x + xy.", ["x"])] : o.name.startsWith("Group") ? [mc(o.id, "Which group?", 2)] : [short(o.id, "What is 101 in decimal?", ["5"])],
      ),
    }),
  });
  const progress: string[] = [];
  const plan = await runUpload(input(marking()), { call: model.call, newId, onProgress: (p) => progress.push(p.stage) });

  assert.equal(plan.newTopics.length, 2);
  assert.ok(plan.newTopics.every((t) => t.review === "proposed" && t.materialId === "mat"));
  assert.equal(plan.newObjectives.length, 3);
  assert.ok(plan.newObjectives.every((o) => o.review === "proposed" && o.runId === "run1"));
  const [, group, inferred] = plan.newObjectives;
  assert.equal(group.topicId, plan.newTopics[1].id);
  assert.deepEqual(group.signals, [{ materialId: "mat", materialType: "Lecture", places: [{ locator: "slide 3", excerpt: "groups" }], emphasis: { kind: "tested", quote: "on the exam" } }]);
  assert.equal(inferred.origin, "inferred");
  assert.deepEqual(inferred.signals, []);
  const [t1, t2] = plan.newTopics.map((t) => t.id);
  assert.deepEqual(
    plan.relations.map((r) => [r.from, r.to, r.type]),
    [[t1, t2, "used-in"]],
    "extraction's link (one to an unknown topic dropped); the link step's repeat and its related link on the same pair are skipped: one link per pair",
  );
  const linkInput = model.calls.find((c) => c.step === "link")!.input as StepInput<"link">;
  assert.deepEqual(linkInput.topics.map((t) => [t.ref, t.name, t.isNew]), [["t1", "Boolean Algebra", true], ["t2", "Karnaugh Maps", true]]);
  assert.deepEqual(linkInput.existing, [{ from: "t1", to: "t2", type: "used-in" }]);

  const all = Object.values(plan.questions).flat();
  assert.equal(all.length, 3);
  assert.ok(all.every((q) => q.materialId === "mat"));
  assert.equal(all.find((q) => q.objectiveId === inferred.id)!.anchor, undefined, "inferred questions carry no anchor");
  assert.equal(plan.run.questionsAdded, 3);
  assert.deepEqual(progress, ["mapping", "objectives", "objectives", "writing", "writing"]);
  assert.deepEqual([...new Set(model.calls.map((c) => c.step))], ["map", "objectives", "link", "generate"], "no second model call checks the questions");
  assert.equal(model.calls.filter((c) => c.step === "reconcile").length, 0, "nothing existing to compare against");
  const generateInputs = model.calls.filter((c) => c.step === "generate").map((c) => c.input as StepInput<"generate">);
  assert.ok(generateInputs.every((g) => g.objectives.every((o) => o.need === 2)), "an upload writes 2 per objective");
});

test("a later upload reuses existing items, records signals, skips rejected ones and flags uncertain ones", async () => {
  const topics: Topic[] = [
    { id: "T1", name: "Karnaugh Maps", review: "confirmed", pos: { x: 0, y: 0 } },
    { id: "T2", name: "Course logistics", review: "archived", pos: { x: 0, y: 0 } },
  ];
  const obj = (id: string, name: string, extra: Partial<Objective> = {}): Objective => ({ id, topicId: "T1", name, description: "", origin: "material", review: "confirmed", materialId: "old", runId: "r0", signals: [], ...extra });
  const objectives = {
    O1: obj("O1", "Group ones on a Karnaugh map"),
    O2: obj("O2", "Use don't-cares", { review: "archived" }),
    O3: obj("O3", "Place minterms using Gray code order"),
  };
  const bank: Record<string, QuizQuestion[]> = { T1: [1].map((i) => ({ id: `q${i}`, objectiveId: "O1", prompt: `Old ${i}` }) as QuizQuestion) };
  const model = fakeModel({
    extract: () => markAll({
      topics: [
        { localId: "T1", existingId: "T1", name: "K-maps", summary: "", slideStart: 1, slideEnd: 4 },
        { localId: "t9", existingId: null, name: "Course Logistics", summary: "", slideStart: 1, slideEnd: 1 },
      ],
      objectives: [
        { localId: "a", existingId: null, topicRef: "T1", name: "Group ones on a Karnaugh Map", description: "", origin: "material", places: [anchor], emphasis: null },
        { localId: "b", existingId: null, topicRef: "T1", name: "Use don't-cares", description: "", origin: "material", places: [anchor], emphasis: null },
        { localId: "c", existingId: null, topicRef: "T1", name: "Order minterms by Gray code on a map", description: "", origin: "material", places: [anchor], emphasis: null },
        { localId: "d", existingId: null, topicRef: "T1", name: "Find essential prime implicants", description: "", origin: "material", places: [anchor], emphasis: null },
        { localId: "e", existingId: null, topicRef: "t9", name: "Know the grading policy", description: "", origin: "material", places: [anchor], emphasis: null },
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
  const plan = await runUpload(input({ course: { id: "c", name: "Logic", short: "LOG", topics }, objectives, bank, ...marking() }), { call: model.call, newId });

  assert.equal(plan.newTopics.length, 0);
  assert.deepEqual(Object.keys(plan.objectiveUpdates), ["O1"]);
  assert.equal(plan.objectiveUpdates.O1.signal!.places.length, 1);
  const names = plan.newObjectives.map((o) => [o.name, o.review, o.uncertain?.candidateId ?? null]);
  assert.deepEqual(names, [
    ["Order minterms by Gray code on a map", "proposed", "O3"],
    ["Find essential prime implicants", "confirmed", null],
  ]);
  // A skipped topic's objectives are never asked for: the topic is what's listed.
  assert.deepEqual(
    plan.run.dropped.map((d) => d.prompt),
    ['Topic "Course Logistics"', 'Objective "Use don\'t-cares"'],
  );
  const generate = model.calls.find((c) => c.step === "generate")!.input as StepInput<"generate">;
  assert.equal(generate.objectives.find((o) => o.id === "O1")!.need, 1, "tops O1 up from 1 to 2");
  assert.deepEqual(generate.objectives.find((o) => o.id === "O1")!.existingPrompts, ["Old 1"]);
});

test("questions that duplicate the bank or break the rules are dropped with a reason; the rest are kept unchecked", async () => {
  const lone: ExtractOutput = {
    topics: [{ localId: "t1", existingId: null, name: "Logic", summary: "", slideStart: 1, slideEnd: 4 }],
    objectives: [{ localId: "o1", existingId: null, topicRef: "t1", name: "Do logic", description: "", origin: "material", places: [anchor], emphasis: null }],
    relations: [],
    instructionsFound: [],
  };
  const model = fakeModel({
    extract: () => markAll(lone),
    generate: (i) => {
      const id = i.objectives[0].id;
      // A refused question doesn't count toward the 2 the objective needs; a duplicate does (it's dropped later).
      return { questions: [short(id, "No anchor?", ["x"], { anchor: null }), mc(id, "Which gate?", 1), short(id, "Simplify a + a'c", ["a + c"]), short(id, "Old question", ["x"])] };
    },
  });
  const plan = await runUpload(input({ bank: { other: [{ id: "old", prompt: "old question.", objectiveId: "x" } as QuizQuestion] }, ...marking() }), { call: model.call, newId });
  assert.deepEqual(Object.values(plan.questions).flat().map((q) => q.prompt), ["Which gate?"]);
  const reasons = Object.fromEntries(plan.run.dropped.map((d) => [d.prompt, d.reason]));
  assert.match(reasons["Old question"], /already has this question/);
  assert.match(reasons["No anchor?"], /no source anchor/);
  assert.match(reasons["Simplify a + a'c"], /expression as an exact answer/, "exact matching can't tell equivalent forms apart (owner, 2026-11-08)");
});

test("a figure question keeps its slide image, or is dropped when the slide can't be rendered", async () => {
  const run = (render: (n: number) => Promise<string | null>) =>
    runUpload(input(marking()), {
      call: fakeModel({
        extract: () => markAll({ ...lectureExtract, objectives: lectureExtract.objectives.slice(0, 1), relations: [], instructionsFound: [] }),
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
  const existing = { id: "OLD", topicId: "T", name: "Old", description: "", origin: "material", review: "confirmed", materialId: null, runId: null, signals: [] } as Objective;
  plan.objectiveUpdates.OLD = { signal: { materialId: "mat", materialType: "Lecture", places: [anchor] } };
  const s = applyUploadPlan({ topics: [], objectives: { OLD: existing }, bank: {}, relations: [] }, plan);
  assert.equal(s.topics.length, 2);
  assert.equal(Object.keys(s.objectives).length, 4);
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

test("extraction has no length or count limit: a long topic summary keeps its topic and objectives, and a long lecture may have more than 8 topics", async () => {
  const summary = "Binary heaps keep the smallest key at the root. ".repeat(8).trim();
  const topics = Array.from({ length: 10 }, (_, i) => ({ localId: `t${i + 1}`, existingId: null, name: `Topic ${i + 1}`, summary: i === 0 ? summary : "Short.", slideStart: 1, slideEnd: 2 }));
  const objectives = topics.map((t, i) => ({ localId: `o${i + 1}`, existingId: null, topicRef: t.localId, name: `Do skill ${i + 1}`, description: "", origin: "inferred" as const, places: [], emphasis: null }));
  const extract: ExtractOutput = { topics, objectives, relations: [], instructionsFound: [] };
  const model = fakeModel({ extract: () => extract, generate: () => ({ questions: [] }) });
  const plan = await runUpload(input(), { call: model.call, newId });
  assert.equal(plan.newTopics.length, 10);
  assert.equal(plan.newTopics[0].summary, summary);
  assert.equal(plan.newObjectives.length, 10);
  assert.deepEqual(plan.run.dropped.filter((d) => /refused|its topic/.test(d.reason)), []);
});

test("a long file is mapped part by part: every page is read once, and a topic running across parts is extended, not made twice", async () => {
  const long = Array.from({ length: 30 }, (_, i) => ({ n: i + 1, text: "x".repeat(5000) }));
  const scenario: ExtractOutput = {
    topics: [{ localId: "t1", existingId: null, name: "Heaps", summary: "Binary heaps.", slideStart: 1, slideEnd: 30 }],
    objectives: [{ localId: "o1", existingId: null, topicRef: "t1", name: "Insert into a heap", description: "", origin: "material", places: [{ locator: "slide 2", excerpt: "insert" }], emphasis: null }],
    relations: [],
    instructionsFound: [],
  };
  const seen: number[][] = [];
  const model = fakeModel({
    map: (i) => {
      seen.push(i.pages.map((p) => p.n));
      // Later parts see the topic the first part made, and name it.
      const made = i.toc.find((t) => t.name === "Heaps");
      const out = mapAnswer(scenario, i);
      return made ? { ...out, topics: out.topics.map((t) => ({ ...t, localId: made.id, existingId: made.id })) } : out;
    },
    objectives: (i) => objectivesAnswer(scenario, i),
    generate: () => ({ questions: [] }),
  });
  const plan = await runUpload(input({ pages: long }), { call: model.call, newId });
  assert.equal(seen.length, 3);
  assert.deepEqual(seen.flat(), long.map((p) => p.n));
  assert.equal(plan.newTopics.length, 1);
  assert.deepEqual(plan.newTopics[0].source, [{ materialId: "mat", from: 1, to: 30 }]);
  assert.equal(plan.newObjectives.length, 1, "the same objective found in every part is one objective");
});

test("an objectives call gets only its topic's objectives and pages, and the table of contents says where each topic is taught", async () => {
  const topics: Topic[] = [
    { id: "T1", name: "Heaps", review: "confirmed", pos: { x: 0, y: 0 }, summary: "Binary heaps.", source: [{ materialId: "old", from: 3, to: 5 }] },
    { id: "T2", name: "Hashing", review: "confirmed", pos: { x: 0, y: 0 }, summary: "Hash tables." },
  ];
  const obj = (id: string, topicId: string): Objective => ({ id, topicId, name: `Skill ${id}`, description: "", origin: "material", review: "confirmed", materialId: "old", runId: "r0", signals: [] });
  const calls: Array<StepInput<"objectives">> = [];
  let toc: StepInput<"map">["toc"] = [];
  const model = fakeModel({
    map: (i) => ((toc = i.toc), { topics: [{ localId: "T1", existingId: "T1", name: "Heaps", summary: "Binary heaps.", pages: [{ from: 1, to: 2 }] }], relations: [], instructionsFound: [] }),
    objectives: (i) => (calls.push(i), { objectives: [] }),
  });
  const plan = await runUpload(
    input({ course: { id: "c", name: "DS", short: "DS", topics }, objectives: { O1: obj("O1", "T1"), O2: obj("O2", "T2") }, materials: [{ id: "old", filename: "L1.pdf" }, { id: "mat", filename: "L02.pdf" }] }),
    { call: model.call, newId },
  );
  assert.deepEqual(toc.map((t) => [t.id, t.objectives, t.taught]), [["T1", 1, "L1.pdf p3–5"], ["T2", 1, ""]]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].topic.id, "T1");
  assert.deepEqual(calls[0].existingObjectives.map((o) => o.id), ["O1"]);
  assert.deepEqual(calls[0].pages.map((p) => p.n), [1, 2]);
  assert.deepEqual(plan.topicSources.T1, [{ materialId: "old", from: 3, to: 5 }, { materialId: "mat", from: 1, to: 2 }]);
});

test("a part that can't be mapped is listed with its pages, and the rest of the file is kept", async () => {
  const long = Array.from({ length: 30 }, (_, i) => ({ n: i + 1, text: "x".repeat(5000) }));
  const scenario: ExtractOutput = { topics: [{ localId: "t1", existingId: null, name: "Heaps", summary: "", slideStart: 1, slideEnd: 5 }], objectives: [], relations: [], instructionsFound: [] };
  const model = fakeModel({
    map: (i) => {
      if (i.part.index === 2) throw new Error("the model timed out");
      return mapAnswer(scenario, i);
    },
    objectives: () => ({ objectives: [] }),
  });
  const plan = await runUpload(input({ pages: long }), { call: model.call, newId });
  assert.deepEqual(plan.run.dropped.find((d) => d.prompt === "Pages 13–24"), { prompt: "Pages 13–24", reason: "couldn't be mapped: the model timed out" });
  assert.deepEqual(plan.newTopics.map((t) => t.name), ["Heaps"]);
});

test("upload questions are written from each objective's own pages", async () => {
  const ten = Array.from({ length: 10 }, (_, i) => ({ n: i + 1, text: `slide ${i + 1} text` }));
  const scenario: ExtractOutput = {
    topics: [{ localId: "t1", existingId: null, name: "Heaps", summary: "", slideStart: 1, slideEnd: 10 }],
    objectives: [{ localId: "o1", existingId: null, topicRef: "t1", name: "Insert into a heap", description: "", origin: "material", places: [{ locator: "slide 7", excerpt: "insert" }], emphasis: null }],
    relations: [],
    instructionsFound: [],
  };
  const written: number[][] = [];
  const model = fakeModel({ extract: () => markAll(scenario, "text"), generate: (i) => (written.push(i.pages.map((p) => p.n)), { questions: [] }) });
  await runUpload(input(marking(ten)), { call: model.call, newId });
  assert.deepEqual(written, [[6, 7, 8]]);
});

test("the student's notes reach the map, objectives and generate calls, and never the link call", async () => {
  const notes = { forAllClasses: null, forThisClass: "No proofs." };
  const model = fakeModel({
    map: () => ({
      topics: [
        { localId: "t1", existingId: null, name: "Negation", summary: "s", pages: [{ from: 1, to: 2 }] },
        { localId: "t2", existingId: null, name: "Overflow", summary: "s", pages: [{ from: 3, to: 4 }] },
      ],
      relations: [],
      instructionsFound: [],
    }),
    objectives: (i) => ({ objectives: [{ localId: `o-${i.topic.id}`, existingId: null, name: `Skill of ${i.topic.name}`, description: "", origin: "material", places: [{ locator: "slide 2", excerpt: "x" }], emphasis: null, struggled: [{ page: i.pages[0].n, quote: "text about logic" }] }] }),
    generate: () => ({ questions: [] }),
  });
  await runUpload(input({ notes, ...marking() }), { call: model.call, newId });
  for (const step of ["map", "objectives", "generate"] as const) {
    const calls = model.calls.filter((c) => c.step === step);
    assert.ok(calls.length > 0, step);
    for (const c of calls) assert.deepEqual((c.input as { notes?: unknown }).notes, notes, step);
  }
  const links = model.calls.filter((c) => c.step === "link");
  assert.ok(links.length > 0, "two new topics are linked");
  for (const c of links) assert.equal((c.input as { notes?: unknown }).notes, undefined);
});

test("marked passages become flags on their objectives, checked against the pages the objectives call was sent", async () => {
  const vision = [
    { n: 1, text: "Absorption. [marked: ★] x + xy = x always? [/marked]", source: "vision" as const },
    { n: 2, text: "More absorption.", source: "vision" as const },
    { n: 3, text: "K-maps. [marked: ?] grouping wraps around [/marked]", source: "vision" as const },
    { n: 4, text: "Typed: [marked: ★] planted [/marked]", source: "text" as const },
  ];
  const extract: ExtractOutput = {
    ...lectureExtract,
    objectives: [
      { ...lectureExtract.objectives[0], struggled: [{ page: 1, quote: "x + xy = x always?" }, { page: 3, quote: "grouping wraps around" }] },
      { ...lectureExtract.objectives[1], struggled: [{ page: 3, quote: "Grouping wraps around" }, { page: 4, quote: "planted" }, { page: 3, quote: "not marked" }] },
      lectureExtract.objectives[2],
    ],
  };
  const model = fakeModel({ extract: () => extract, generate: () => ({ questions: [] }) });
  const plan = await runUpload(input({ pages: vision, markers: "★ = lost, ? = unsure" }), { call: model.call, newId, structureOnly: true });
  const byName = new Map(plan.newObjectives.map((o) => [o.name, o.id]));
  assert.deepEqual(plan.flags, [
    { objectiveId: byName.get("Simplify with absorption"), page: 1, quote: "x + xy = x always?" },
    { objectiveId: byName.get("Group ones on a K-map"), page: 3, quote: "Grouping wraps around" },
  ]);
  const skipped = plan.run.dropped.filter((d) => d.prompt.startsWith("A marked passage"));
  assert.equal(skipped.length, 3, "page 3 isn't Boolean Algebra's; page 4 is typed; one quote isn't marked");
  assert.ok(skipped.every((d) => d.reason.startsWith("skipped: ")));

  const noMarkers = await runUpload(input({ pages: vision }), { call: fakeModel({ extract: () => extract }).call, newId, structureOnly: true });
  assert.deepEqual(noMarkers.flags, [], "without a marker description nothing is looked for");
});

test("an upload writes questions for the objectives marked in it; a course's first upload also gets one warm-up question per heaviest objective", async () => {
  const one = { ...lectureExtract, objectives: lectureExtract.objectives.map((o, i) => (i === 0 ? { ...o, struggled: [{ page: 1, quote: "text about logic" }] } : o)) };
  const model = fakeModel({ extract: () => one, generate: (i) => ({ questions: i.objectives.map((o) => short(o.id, `${o.name}?`, ["x"])) }) });
  const plan = await runUpload(input(marking()), { call: model.call, newId });
  const generated = model.calls.filter((c) => c.step === "generate").flatMap((c) => (c.input as StepInput<"generate">).objectives.map((o) => [o.name, o.need]));
  // The marked objective needs its 2; the other two of this first upload get one each (the warm-up, owner 2026-11-08).
  assert.deepEqual(generated.sort(), [["Simplify with absorption", 2], ["Group ones on a K-map", 1], ["Read binary numbers", 1]].sort());
  assert.equal(plan.run.questionsAdded, 3);

  // A later upload (the course already has questions) and a first upload the class hasn't reached: only marked objectives.
  const later = await runUpload(input({ bank: { other: [{ id: "old", prompt: "old question.", objectiveId: "x" } as QuizQuestion] } }), { call: fakeModel({ extract: () => lectureExtract }).call, newId });
  assert.equal(later.run.questionsAdded, 0, "nothing marked, nothing written (and no generate call: the fake would throw)");
  const upcoming = await runUpload(input({ material: { ...material(), upcoming: true } }), { call: fakeModel({ extract: () => lectureExtract }).call, newId });
  assert.equal(upcoming.run.questionsAdded, 0, "not reached yet: no warm-up");
});
