import test from "node:test";
import assert from "node:assert/strict";
import type { FlaggedQuestion, Material, MaterialPages, Objective, PipelineRun, QuizQuestion, Topic } from "../../src/lib/data.ts";
import { type JobStore, deepReview, processMaterial, topUp } from "../../src/lib/jobs/jobs.ts";
import type { CallStep, Progress } from "../../src/lib/pipeline/run.ts";
import type { StepInput } from "../../src/lib/pipeline/schemas.ts";
import type { StructureRows, StructureState } from "../../src/lib/supabase/app-rows.ts";
import type { BudgetVerdict } from "../../src/lib/jobs/budget.ts";

const anchor = { locator: "slide 2", excerpt: "x + xy = x" };
const material: Material = { id: "m1", courseId: "c", filename: "L02.pdf", type: "Lecture", assigned: null, due: null, reflect: false };
const queued = (over: Partial<PipelineRun> = {}): PipelineRun => ({
  id: "run1",
  kind: "upload",
  courseId: "c",
  materialId: "m1",
  at: "2026-10-05T12:00:00.000Z",
  model: "claude-opus-5-5",
  status: "queued",
  topicsCreated: [],
  objectivesCreated: [],
  objectivesAttached: [],
  questionsAdded: 0,
  dropped: [],
  ...over,
});

/** An in-memory JobStore for one student: what the jobs saved, the progress they wrote, the run's state. */
function memoryStore(init: { run: PipelineRun; structure?: StructureState; pages?: Record<string, MaterialPages>; answered?: string[]; flagged?: FlaggedQuestion[]; lostReply?: boolean; budget?: BudgetVerdict }) {
  const run = { ...init.run };
  const structure: StructureState = init.structure ?? { topics: [], objectives: {}, bank: {}, relations: [] };
  const saves: StructureRows[] = [];
  const progress: Progress[] = [];
  const budgetAsked: number[] = [];
  const savedPages: Array<{ n: number; text: string; source: string }> = [];
  const store: JobStore = {
    run: async (id) => (id === run.id ? { ...run } : null),
    claim: async (id, p) => {
      if (id !== run.id || (run.status !== "queued" && run.status !== "waiting")) return false;
      run.status = "running";
      run.progress = p;
      return true;
    },
    progress: async (_id, p) => void progress.push(p),
    fail: async (_id, error) => {
      if (run.status !== "queued" && run.status !== "waiting" && run.status !== "running") return;
      run.status = "failed";
      run.error = error;
    },
    budget: async (pages) => {
      budgetAsked.push(pages);
      return init.budget ?? { ok: true };
    },
    wait: async (_id, verdict) => {
      if (run.status !== "running") throw new Error("only a running run waits");
      run.status = "waiting";
      run.progress = { stage: "waiting", reason: verdict.reason, message: verdict.message };
    },
    course: async (id) => (id === "c" ? { course: { id: "c", name: "Logic", short: "LOG", topics: structure.topics }, structure } : null),
    materials: async () => [material],
    pages: async (ids) => Object.fromEntries(ids.flatMap((id) => (init.pages?.[id] ? [[id, init.pages[id]]] : []))),
    savePages: async (_id, read, source) => void savedPages.push(...read.map((p) => ({ ...p, source }))),
    answered: async () => new Set(init.answered ?? []),
    flagged: async () => init.flagged ?? [],
    save: async (_course, rows) => {
      saves.push(rows);
      run.status = "done";
      if (init.lostReply) throw new Error("fetch failed");
    },
  };
  return { store, saves, progress, budgetAsked, savedPages, state: run };
}

/** A model that maps one topic and objective, writes `per` exact questions per objective and solves them right. */
function honestModel(per = 2, failOn?: string): { call: CallStep; steps: string[] } {
  const steps: string[] = [];
  const call = (async (step: string, input: unknown) => {
    steps.push(step);
    if (step === failOn) throw new Error("Anthropic is rate-limiting you. Try again in a moment.");
    if (step === "extract") {
      return {
        topics: [{ localId: "t1", existingId: null, name: "Boolean Algebra", aliases: [], summary: "Theorems.", slideStart: 1, slideEnd: 3 }],
        objectives: [{ localId: "o1", existingId: null, topicRef: "t1", name: "Simplify with absorption", description: "", aliases: [], origin: "material", places: [anchor], emphasis: null }],
        relations: [],
      };
    }
    if (step === "generate") {
      const g = input as StepInput<"generate">;
      return {
        questions: g.objectives.flatMap((o) =>
          Array.from({ length: Math.min(per, o.need) }, (_, i) => ({
            objectiveId: o.id,
            kind: "Short answer",
            tier: "retrieval",
            prompt: `${o.name}: case ${i + 1}?`,
            options: [],
            answer: -1,
            exact: [String(i + 1)],
            rubric: null,
            explanation: "Because.",
            anchor,
            figureSlide: null,
          })),
        ),
      };
    }
    if (step === "link") return { links: [] };
    throw new Error(`unexpected step ${step}`);
  }) as CallStep;
  return { call, steps };
}

const pages = { m1: [{ n: 1, text: "Boolean algebra" }, { n: 2, text: "x + xy = x" }] };
let n = 0;
const newId = () => `id${++n}`;

test("processMaterial builds the structure from the stored pages and saves it with the finished run", async () => {
  const mem = memoryStore({ run: queued(), pages });
  const out = await processMaterial({ store: mem.store, call: honestModel().call, newId }, { runId: "run1", materialId: "m1" });
  assert.equal(out.status, "done");
  assert.equal(mem.saves.length, 1);
  const rows = mem.saves[0];
  assert.deepEqual(rows.runs!.map((r) => [r.id, r.status, r.questions_added, r.progress, r.error]), [["run1", "done", 2, null, null]]);
  assert.deepEqual(rows.topics!.map((t) => [t.name, t.review]), [["Boolean Algebra", "proposed"]]);
  assert.equal(rows.objectives!.length, 1);
  assert.equal(rows.questions!.length, 2);
  assert.deepEqual(mem.progress.map((p) => p.stage), ["mapping", "matching", "writing"]);
});

test("handwritten pages are read from their images first: the text is stored, extraction reads it, and an unrenderable page keeps its own", async () => {
  const handwritten: Record<string, MaterialPages> = {
    m1: [
      { n: 1, text: "iisel cell & think", source: "needs-vision" },
      { n: 2, text: "Typed page about absorption.", source: "text" },
      { n: 3, text: "", source: "needs-vision" },
    ],
  };
  const mem = memoryStore({ run: queued(), pages: handwritten });
  const honest = honestModel();
  const sent: Array<StepInput<"transcribe">> = [];
  let extracted: StepInput<"extract"> | null = null;
  const call = (async (step: string, input: unknown) => {
    if (step === "transcribe") {
      const t = input as StepInput<"transcribe">;
      sent.push(t);
      return { pages: t.pages.map((p) => ({ n: p.n, text: `A DRAM cell stores one bit (page ${p.n}).` })) };
    }
    if (step === "extract") extracted = input as StepInput<"extract">;
    return honest.call(step as never, input as never);
  }) as CallStep;
  const render = async (_m: unknown, page: number) => (page === 3 ? null : `data:image/jpeg;base64,PAGE${page}`);
  const out = await processMaterial({ store: mem.store, call, newId, renderPage: render }, { runId: "run1", materialId: "m1" });
  assert.equal(out.status, "done");
  assert.deepEqual(sent.map((t) => t.pages.map((p) => [p.n, p.image])), [[[1, "PAGE1"]]], "only marked pages that could be drawn, without the data: prefix");
  assert.deepEqual(mem.savedPages, [{ n: 1, text: "A DRAM cell stores one bit (page 1).", source: "vision" }]);
  assert.deepEqual(extracted!.pages.map((p) => p.text), ["A DRAM cell stores one bit (page 1).", "Typed page about absorption.", ""]);
  assert.deepEqual(mem.progress.map((p) => p.stage).slice(0, 2), ["transcribing", "mapping"]);
  const dropped = mem.saves[0].runs![0].dropped as Array<{ prompt: string; reason: string }>;
  assert.ok(dropped.some((d) => d.prompt === "Page 3" && /kept the file's own text: the page couldn't be drawn/.test(d.reason)));
});

test("typed slides with a figure get its description appended to their text; decoration only leaves the text as it was", async () => {
  const slides: Record<string, MaterialPages> = {
    m1: [
      { n: 1, text: "A 2-to-1 multiplexer", source: "needs-figure" },
      { n: 2, text: "Course logistics", source: "needs-figure" },
      { n: 3, text: "Absorption: x + xy = x", source: "text" },
    ],
  };
  const mem = memoryStore({ run: queued(), pages: slides });
  const honest = honestModel();
  const asked: Array<StepInput<"describe">> = [];
  let extracted: StepInput<"extract"> | null = null;
  const call = (async (step: string, input: unknown) => {
    if (step === "describe") {
      const d = input as StepInput<"describe">;
      asked.push(d);
      return { pages: d.pages.map((p) => ({ n: p.n, figures: p.n === 1 ? "A mux with inputs A, B, select S and output Y." : "" })) };
    }
    if (step === "extract") extracted = input as StepInput<"extract">;
    return honest.call(step as never, input as never);
  }) as CallStep;
  const out = await processMaterial({ store: mem.store, call, newId, renderPage: async (_m, n) => `data:image/jpeg;base64,S${n}` }, { runId: "run1", materialId: "m1" });
  assert.equal(out.status, "done");
  assert.deepEqual(asked.map((d) => d.pages.map((p) => [p.n, p.text, p.image])), [[[1, "A 2-to-1 multiplexer", "S1"], [2, "Course logistics", "S2"]]], "the slide's text goes with its image");
  assert.deepEqual(extracted!.pages.map((p) => p.text), ["A 2-to-1 multiplexer\n\n[Figures: A mux with inputs A, B, select S and output Y.]", "Course logistics", "Absorption: x + xy = x"]);
  assert.deepEqual(mem.savedPages.map((p) => [p.n, p.source]), [[1, "figure"], [2, "figure"]], "both stored as described, so neither is sent again");
  assert.equal(mem.progress[0].stage, "figures-reading");
});

test("a failed job records why, and saves nothing", async () => {
  const mem = memoryStore({ run: queued(), pages });
  const out = await processMaterial({ store: mem.store, call: honestModel(2, "extract").call, newId }, { runId: "run1", materialId: "m1" });
  assert.deepEqual(out, { status: "failed", error: "Orca couldn't build this upload: Anthropic is rate-limiting you. Try again in a moment." });
  assert.equal(mem.state.status, "failed");
  assert.equal(mem.state.error, out.status === "failed" ? out.error : "");
  assert.equal(mem.saves.length, 0);
});

test("a material with no stored text fails saying so, without calling the model", async () => {
  const mem = memoryStore({ run: queued(), pages: {} });
  const model = honestModel();
  const out = await processMaterial({ store: mem.store, call: model.call, newId }, { runId: "run1", materialId: "m1" });
  assert.equal(out.status, "failed");
  assert.match(mem.state.error!, /no text in this file/);
  assert.deepEqual(model.steps, []);
});

test("a run that isn't queued (already taken, or finished) is left alone", async () => {
  const mem = memoryStore({ run: queued({ status: "done" }), pages });
  const model = honestModel();
  const out = await processMaterial({ store: mem.store, call: model.call, newId }, { runId: "run1", materialId: "m1" });
  assert.equal(out.status, "skipped");
  assert.deepEqual(model.steps, []);
  assert.equal(mem.saves.length, 0);
});

test("a run for another material is refused", async () => {
  const mem = memoryStore({ run: queued(), pages });
  const out = await processMaterial({ store: mem.store, call: honestModel().call, newId }, { runId: "run1", materialId: "m2" });
  assert.equal(out.status, "failed");
  assert.match(mem.state.error!, /another material/);
});

test("topUp writes questions for the session's objectives from their stored pages and records one run", async () => {
  const topic: Topic = { id: "t", name: "Boolean Algebra", aliases: [], review: "confirmed", pos: { x: 0, y: 0 } };
  const objective: Objective = { id: "o", topicId: "t", name: "Simplify", description: "", aliases: [], origin: "material", review: "confirmed", materialId: "m1", runId: "r0", signals: [{ materialId: "m1", materialType: "Lecture", places: [anchor] }] };
  const q = (id: string): QuizQuestion => ({ id, kind: "Short answer", topic: "Boolean Algebra", prompt: `${id}?`, options: [], answer: -1, exact: ["1"], explanation: "", anchor, objectiveId: "o" });
  const structure: StructureState = { topics: [topic], objectives: { o: objective }, bank: { t: [q("q1"), q("q2")] }, relations: [] };
  const mem = memoryStore({ run: queued({ kind: "top-up", materialId: null }), structure, pages, answered: ["q1"] });
  const model = honestModel(2);
  // "elsewhere" is another course's objective: ignored.
  const out = await topUp({ store: mem.store, call: model.call, newId }, { runId: "run1", objectiveIds: ["o", "elsewhere"] });
  assert.equal(out.status, "done");
  assert.deepEqual(model.steps, ["generate"]);
  const rows = mem.saves[0];
  assert.deepEqual(rows.runs!.map((r) => [r.kind, r.material_id, r.questions_added, r.status]), [["top-up", "m1", 2, "done"]]);
  assert.deepEqual(rows.questions!.map((x) => [x.prompt, x.sort_order]), [["Simplify: case 1?", 2], ["Simplify: case 2?", 3]]);
  assert.equal(rows.topics, undefined, "nothing else is written");
});

test("a save that landed but whose reply was lost leaves the run done, so a re-upload doesn't build it again", async () => {
  const mem = memoryStore({ run: queued(), pages, lostReply: true });
  const out = await processMaterial({ store: mem.store, call: honestModel().call, newId }, { runId: "run1", materialId: "m1" });
  assert.equal(out.status, "failed");
  assert.equal(mem.saves.length, 1);
  assert.equal(mem.state.status, "done");
});

test("an upload over the daily budget is held: the run goes to waiting with why, the model is never called, nothing is saved", async () => {
  const held: BudgetVerdict = { ok: false, reason: "daily-pages", message: "Daily limit reached: processing resumes tomorrow." };
  const m = memoryStore({ run: queued(), pages: { m1: [{ n: 1, text: "x + xy = x" }, { n: 2, text: "more" }] }, budget: held });
  const model = honestModel();
  const out = await processMaterial({ store: m.store, call: model.call, newId: () => "id" }, { runId: "run1", materialId: "m1" });
  assert.deepEqual(out, { status: "waiting", reason: "daily-pages" });
  assert.equal(m.state.status, "waiting");
  assert.deepEqual(m.state.progress, { stage: "waiting", reason: "daily-pages", message: held.message });
  assert.deepEqual(m.budgetAsked, [2], "asked with the pages this upload would add");
  assert.deepEqual(model.steps, []);
  assert.deepEqual(m.saves, []);
});

test("a top-up asks the budget with no pages and is held the same way", async () => {
  const held: BudgetVerdict = { ok: false, reason: "global-budget", message: "Orca's model budget for today is used up: processing resumes tomorrow." };
  const m = memoryStore({ run: queued({ kind: "top-up", materialId: null }), budget: held });
  const model = honestModel();
  const out = await topUp({ store: m.store, call: model.call, newId: () => "id" }, { runId: "run1", objectiveIds: [] });
  assert.deepEqual(out, { status: "waiting", reason: "global-budget" });
  assert.deepEqual(m.budgetAsked, [0]);
  assert.equal(m.state.status, "waiting");
  assert.deepEqual(model.steps, []);
});

test("a Dive In asks the dive questions written before and never answered first, and writes nothing when they're enough", async () => {
  const topic: Topic = { id: "t", name: "Boolean Algebra", aliases: [], review: "confirmed", pos: { x: 0, y: 0 } };
  const objective: Objective = { id: "o", topicId: "t", name: "Simplify", description: "", aliases: [], origin: "material", review: "confirmed", materialId: "m1", runId: "r0", signals: [] };
  const deepQ = (id: string): QuizQuestion => ({ id, kind: "Short answer", tier: "application", topic: "Boolean Algebra", prompt: `${id}?`, options: [], answer: -1, exact: ["1"], explanation: "", anchor, objectiveId: "o", deep: true });
  // d1 was answered in an earlier dive; d2, d3 and d4 never were. 10 minutes is 3 questions.
  const structure: StructureState = { topics: [topic], objectives: { o: objective }, bank: { t: [deepQ("d1"), deepQ("d2"), deepQ("d3"), deepQ("d4")] }, relations: [] };
  const mem = memoryStore({ run: queued({ kind: "deep-review", materialId: null, deepMinutes: 10 }), structure, pages, answered: ["d1"] });
  const model = honestModel();
  const out = await deepReview({ store: mem.store, call: model.call, newId }, { runId: "run1", objectiveIds: ["o"], minutes: 10 });
  assert.equal(out.status, "done");
  assert.deepEqual(model.steps, [], "no model call: the stock covers it");
  assert.deepEqual(mem.budgetAsked, [], "nothing is spent, so no budget is checked");
  const runRow = mem.saves[0].runs![0];
  assert.deepEqual(runRow.question_ids, ["d2", "d3", "d4"]);
  assert.equal(runRow.questions_added, 0);
  assert.equal(mem.saves[0].questions, undefined, "no questions are written");
});

test("a Dive In asks no more than its objectives can hold: 20 minutes on one objective with 4 unanswered questions writes nothing", async () => {
  const topic: Topic = { id: "t", name: "Boolean Algebra", aliases: [], review: "confirmed", pos: { x: 0, y: 0 } };
  const objective: Objective = { id: "o", topicId: "t", name: "Simplify", description: "", aliases: [], origin: "material", review: "confirmed", materialId: "m1", runId: "r0", signals: [] };
  const deepQ = (id: string): QuizQuestion => ({ id, kind: "Short answer", tier: "application", topic: "Boolean Algebra", prompt: `${id}?`, options: [], answer: -1, exact: ["1"], explanation: "", anchor, objectiveId: "o", deep: true });
  const structure: StructureState = { topics: [topic], objectives: { o: objective }, bank: { t: ["d1", "d2", "d3", "d4", "d5"].map(deepQ) }, relations: [] };
  const mem = memoryStore({ run: queued({ kind: "deep-review", materialId: null, deepMinutes: 20 }), structure, pages });
  const model = honestModel();
  const out = await deepReview({ store: mem.store, call: model.call, newId }, { runId: "run1", objectiveIds: ["o"], minutes: 20 });
  assert.equal(out.status, "done");
  assert.deepEqual(model.steps, [], "20 minutes is 5 questions, but one objective holds 4: all from the stock");
  assert.deepEqual(mem.saves[0].runs![0].question_ids, ["d1", "d2", "d3", "d4"]);
});
