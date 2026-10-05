import test from "node:test";
import assert from "node:assert/strict";
import type { Material, MaterialPages, Objective, PipelineRun, QuizQuestion, Topic } from "../../src/lib/data.ts";
import { type JobStore, processMaterial, topUp } from "../../src/lib/jobs/jobs.ts";
import type { CallStep, Progress } from "../../src/lib/pipeline/run.ts";
import type { StepInput } from "../../src/lib/pipeline/schemas.ts";
import type { StructureRows, StructureState } from "../../src/lib/supabase/app-rows.ts";

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
function memoryStore(init: { run: PipelineRun; structure?: StructureState; pages?: Record<string, MaterialPages>; answered?: string[] }) {
  const run = { ...init.run };
  const structure: StructureState = init.structure ?? { topics: [], objectives: {}, bank: {}, relations: [] };
  const saves: StructureRows[] = [];
  const progress: Progress[] = [];
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
      run.status = "failed";
      run.error = error;
    },
    course: async (id) => (id === "c" ? { course: { id: "c", name: "Logic", short: "LOG", topics: structure.topics }, structure } : null),
    materials: async () => [material],
    pages: async (ids) => Object.fromEntries(ids.flatMap((id) => (init.pages?.[id] ? [[id, init.pages[id]]] : []))),
    answered: async () => new Set(init.answered ?? []),
    save: async (_course, rows) => {
      saves.push(rows);
      run.status = "done";
    },
  };
  return { store, saves, progress, state: run };
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
    if (step === "solve") {
      const s = input as StepInput<"solve">;
      return { answers: s.questions.map((q) => ({ id: q.id, choice: null, text: /case (\d+)\?$/.exec(q.prompt)?.[1] ?? "?" })) };
    }
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
  assert.deepEqual(mem.progress.map((p) => p.stage), ["mapping", "matching", "writing", "checking"]);
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
  assert.deepEqual(model.steps, ["generate", "solve"]);
  const rows = mem.saves[0];
  assert.deepEqual(rows.runs!.map((r) => [r.kind, r.material_id, r.questions_added, r.status]), [["top-up", "m1", 2, "done"]]);
  assert.deepEqual(rows.questions!.map((x) => [x.prompt, x.sort_order]), [["Simplify: case 1?", 2], ["Simplify: case 2?", 3]]);
  assert.equal(rows.topics, undefined, "nothing else is written");
});
