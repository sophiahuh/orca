/**
 * The upload pipeline: extract → match duplicates → write questions → check them. Model calls are
 * injected (`call`), so the orchestration is tested with fakes; the result is a plan that
 * `applyUploadPlan` merges into the course. Nothing here touches the store.
 */
import type { Material, Objective, ObjectiveSignal, PipelineRun, QuizQuestion, Relation, Topic } from "../data.ts";
import { gradeExact } from "../grading.ts";
import { type Named, exactMatch, normaliseName, shortlist } from "../course/match.ts";
import { QUESTIONS_PER_OBJECTIVE, promptKey } from "./questions.ts";
import type { ExtractOutput, GeneratedQuestion, StepInput, StepName, StepOutput } from "./schemas.ts";

export type CallStep = <S extends StepName>(step: S, input: StepInput<S>) => Promise<StepOutput<S>>;

export type Progress =
  | { stage: "mapping" }
  | { stage: "matching"; candidates: number }
  | { stage: "writing"; objectives: number }
  | { stage: "checking"; questions: number }
  | { stage: "figures"; slides: number };

export interface RunInput {
  course: { id: string; name: string; short: string; topics: Topic[] };
  objectives: Readonly<Record<string, Objective>>;
  bank: Readonly<Record<string, QuizQuestion[]>>;
  relations: readonly Relation[];
  material: Material;
  pages: Array<{ n: number; text: string }>;
  /** What hidden text the server dropped when it read the file; recorded on the run (decision 13). */
  hiddenText?: { items: number; pages: number[] };
  runId: string;
  model: string;
  /** ISO time of the run. */
  now: string;
}

export interface RunDeps {
  call: CallStep;
  newId: () => string;
  /** Render one slide as an image URL for a figure question; null when it can't be. */
  renderFigure?: (slide: number) => Promise<string | null>;
  onProgress?: (p: Progress) => void;
  /** Stop after the structure (topics, objectives, relations): no questions are written or checked. */
  structureOnly?: boolean;
}

export interface UploadPlan {
  newTopics: Topic[];
  /** Existing topics: names this upload used for them. */
  topicAliases: Record<string, string[]>;
  newObjectives: Objective[];
  /** Existing objectives this upload covered: extra names and this upload's signal. */
  objectiveUpdates: Record<string, { aliases: string[]; signal: ObjectiveSignal | null }>;
  relations: Relation[];
  /** topicId → new questions. */
  questions: Record<string, QuizQuestion[]>;
  run: PipelineRun;
}

const CHECK_BATCH = 30;
const OBJECTIVES_PER_CALL = 8;

/** Run `fn` over `items`, at most `limit` at a time, keeping order. */
async function pool<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Course items as the matcher and the prompts see them; merged-away items live on as aliases of their survivor. */
function asNamed<T extends { id: string; name: string; aliases: string[]; review: Topic["review"]; mergedInto?: string; description?: string }>(items: readonly T[]): Named[] {
  return items.map((i) => ({ id: i.id, name: i.name, aliases: i.aliases, review: i.review, mergedInto: i.mergedInto, description: i.description }));
}

function survivor<T extends { id: string; mergedInto?: string }>(id: string, byId: ReadonlyMap<string, T>): T | undefined {
  let current = byId.get(id);
  for (let n = 0; n < 50 && current?.mergedInto; n++) current = byId.get(current.mergedInto);
  return current;
}

type Resolution = { kind: "existing"; id: string } | { kind: "new"; uncertain?: { candidateId: string; reasoning: string } } | { kind: "dropped"; reason: string };

/**
 * Decide whether an extracted item is an existing one: the id the model reused, then exact names,
 * then (only if anything is close) one reconciliation call.
 */
async function resolve(
  kind: "topic" | "objective",
  candidate: { existingId: string | null; name: string; aliases: string[]; description: string },
  existing: readonly Named[],
  call: CallStep,
): Promise<Resolution> {
  const byId = new Map(existing.map((e) => [e.id, e]));
  const verdict = (id: string): Resolution => {
    const s = survivor(id, byId);
    if (!s) return { kind: "new" };
    return s.review === "archived" ? { kind: "dropped", reason: `the same as rejected ${kind} "${s.name}"` } : { kind: "existing", id: s.id };
  };
  if (candidate.existingId && byId.has(candidate.existingId)) return verdict(candidate.existingId);
  const exact = exactMatch([candidate.name, ...candidate.aliases], existing);
  if (exact) return exact.kind === "live" ? { kind: "existing", id: exact.id } : { kind: "dropped", reason: `the same as rejected ${kind} "${byId.get(exact.id)?.name}"` };
  const close = shortlist(candidate, existing);
  if (!close.length) return { kind: "new" };
  try {
    const r = await call("reconcile", {
      kind,
      candidate: { name: candidate.name, aliases: candidate.aliases, description: candidate.description },
      existing: close.map((c) => ({ id: c.id, name: c.name, aliases: c.aliases, description: c.description ?? "", rejected: c.review === "archived" })),
    });
    const match = r.matchId && byId.has(r.matchId) ? r.matchId : null;
    if (r.decision === "same" && match) return verdict(match);
    if (r.decision === "uncertain") return { kind: "new", uncertain: { candidateId: match ?? close[0].id, reasoning: r.reasoning } };
    return { kind: "new" };
  } catch (e) {
    return { kind: "new", uncertain: { candidateId: close[0].id, reasoning: `Couldn't check for a duplicate: ${errorText(e)}` } };
  }
}

/** Problems that make a generated question unusable, before any model checks it. */
function structuralProblem(q: GeneratedQuestion, inferred: boolean): string | null {
  if (q.kind === "Multiple choice" && (q.options.length !== 4 || q.answer < 0 || q.answer > 3)) return "multiple choice needs four options and a valid answer";
  if (q.kind === "True or false" && (q.options.length !== 2 || q.answer < 0 || q.answer > 1)) return "true/false needs two options and a valid answer";
  if (q.kind === "Short answer" && !(q.exact && q.exact.length) && !q.rubric) return "short answer with neither an exact answer nor a rubric";
  if (!inferred && !q.anchor) return "no source anchor";
  return null;
}

export async function runUpload(input: RunInput, deps: RunDeps): Promise<UploadPlan> {
  const { call, newId } = deps;
  const progress = deps.onProgress ?? (() => {});
  const dropped: PipelineRun["dropped"] = [];
  const signalFor = (places: ObjectiveSignal["places"], emphasis: ObjectiveSignal["emphasis"] | null): ObjectiveSignal | null =>
    places.length || emphasis ? { materialId: input.material.id, materialType: input.material.type, places, ...(emphasis ? { emphasis } : {}) } : null;

  const existingTopics = asNamed(input.course.topics);
  const existingObjectives = asNamed(Object.values(input.objectives));
  const listed = <T extends Named>(items: T[]) => items.filter((i) => !i.mergedInto).map((i) => ({ id: i.id, name: i.name, aliases: i.aliases, description: i.description, rejected: i.review === "archived" }));

  /* 1. Extract */
  progress({ stage: "mapping" });
  const extracted: ExtractOutput = await call("extract", {
    course: { name: input.course.name, short: input.course.short },
    material: { filename: input.material.filename, type: input.material.type },
    pages: input.pages,
    existingTopics: listed(existingTopics),
    existingObjectives: listed(existingObjectives).map((o) => ({ ...o, topicId: input.objectives[o.id].topicId })),
  });

  /* 2. Topics */
  progress({ stage: "matching", candidates: extracted.topics.length + extracted.objectives.length });
  const topicByRef = new Map<string, { kind: "existing" | "new"; id: string } | { kind: "dropped" }>();
  const newTopics: Topic[] = [];
  const topicAliases: Record<string, string[]> = {};
  const topicResolutions = await pool(extracted.topics, 4, (t) => resolve("topic", { existingId: t.existingId, name: t.name, aliases: t.aliases, description: t.summary }, existingTopics, call));
  extracted.topics.forEach((t, i) => {
    const r = topicResolutions[i];
    if (r.kind === "dropped") {
      dropped.push({ prompt: `Topic "${t.name}"`, reason: `skipped: ${r.reason}` });
      topicByRef.set(t.localId, { kind: "dropped" });
      return;
    }
    if (r.kind === "existing") {
      const existing = input.course.topics.find((x) => x.id === r.id)!;
      const extra = [t.name, ...t.aliases].filter((n) => ![existing.name, ...existing.aliases].some((a) => normaliseName(a) === normaliseName(n)));
      if (extra.length) topicAliases[r.id] = [...(topicAliases[r.id] ?? []), ...extra];
      topicByRef.set(t.localId, { kind: "existing", id: r.id });
      return;
    }
    // Two extracted topics with the same name in one upload are one topic.
    const twin = exactMatch([t.name, ...t.aliases], asNamed(newTopics));
    if (twin) {
      topicByRef.set(t.localId, { kind: "new", id: twin.id });
      return;
    }
    const topic: Topic = {
      id: newId(),
      name: t.name,
      aliases: t.aliases.filter((a) => normaliseName(a) !== normaliseName(t.name)),
      review: "proposed",
      materialId: input.material.id,
      pos: { x: 0, y: 0 },
      summary: t.summary,
      source: { filename: input.material.filename, slideStart: t.slideStart, slideEnd: Math.max(t.slideStart, t.slideEnd) },
      ...(r.uncertain ? { uncertain: r.uncertain } : {}),
    };
    newTopics.push(topic);
    topicByRef.set(t.localId, { kind: "new", id: topic.id });
  });
  const liveTopicIds = new Set(input.course.topics.filter((t) => t.review !== "archived").map((t) => t.id));
  const topicIdOf = (ref: string): string | null | "dropped" => {
    const r = topicByRef.get(ref);
    if (r) return r.kind === "dropped" ? "dropped" : r.id;
    const existing = survivor(ref, new Map(input.course.topics.map((t) => [t.id, t])));
    if (!existing) return null;
    return liveTopicIds.has(existing.id) ? existing.id : "dropped";
  };
  const confirmedTopic = (id: string) => input.course.topics.some((t) => t.id === id && t.review === "confirmed");

  /* 3. Objectives */
  const objectiveByRef = new Map<string, string>();
  const newObjectives: Objective[] = [];
  const objectiveUpdates: UploadPlan["objectiveUpdates"] = {};
  const objectiveResolutions = await pool(extracted.objectives, 4, (o) =>
    resolve("objective", { existingId: o.existingId, name: o.name, aliases: o.aliases, description: o.description }, existingObjectives, call),
  );
  extracted.objectives.forEach((o, i) => {
    const r = objectiveResolutions[i];
    const signal = o.origin === "material" ? signalFor(o.places, o.emphasis) : signalFor([], o.emphasis);
    if (r.kind === "dropped") {
      dropped.push({ prompt: `Objective "${o.name}"`, reason: `skipped: ${r.reason}` });
      return;
    }
    if (r.kind === "existing") {
      const existing = input.objectives[r.id];
      const update = (objectiveUpdates[r.id] ??= { aliases: [], signal: null });
      for (const n of [o.name, ...o.aliases]) {
        if (![existing.name, ...existing.aliases, ...update.aliases].some((a) => normaliseName(a) === normaliseName(n))) update.aliases.push(n);
      }
      if (signal) update.signal = update.signal ? { ...update.signal, places: [...update.signal.places, ...signal.places], emphasis: signal.emphasis ?? update.signal.emphasis } : signal;
      objectiveByRef.set(o.localId, r.id);
      return;
    }
    const topicId = topicIdOf(o.topicRef);
    if (topicId === null || topicId === "dropped") {
      dropped.push({ prompt: `Objective "${o.name}"`, reason: topicId === null ? `skipped: its topic "${o.topicRef}" doesn't exist` : "skipped: its topic was rejected" });
      return;
    }
    const twin = exactMatch([o.name, ...o.aliases], asNamed(newObjectives));
    if (twin) {
      const t = newObjectives.find((x) => x.id === twin.id)!;
      if (signal) t.signals = [...t.signals, signal];
      objectiveByRef.set(o.localId, twin.id);
      return;
    }
    const objective: Objective = {
      id: newId(),
      topicId,
      name: o.name,
      description: o.description,
      aliases: o.aliases.filter((a) => normaliseName(a) !== normaliseName(o.name)),
      origin: o.origin,
      review: confirmedTopic(topicId) && !r.uncertain ? "confirmed" : "proposed",
      materialId: input.material.id,
      runId: input.runId,
      signals: signal ? [signal] : [],
      ...(r.uncertain ? { uncertain: r.uncertain } : {}),
    };
    newObjectives.push(objective);
    objectiveByRef.set(o.localId, objective.id);
  });

  /* 4. Relations */
  const allObjectiveIds = new Set([...Object.keys(input.objectives), ...newObjectives.map((o) => o.id)]);
  const objectiveId = (ref: string) => objectiveByRef.get(ref) ?? (allObjectiveIds.has(ref) ? ref : null);
  const seenRelations = new Set(input.relations.map((r) => `${r.from}|${r.to}|${r.type}`));
  const relations: Relation[] = [];
  for (const r of extracted.relations) {
    const from = objectiveId(r.from);
    const to = objectiveId(r.to);
    if (!from || !to || from === to) continue;
    const key = `${from}|${to}|${r.type}`;
    if (seenRelations.has(key)) continue;
    seenRelations.add(key);
    relations.push({ id: newId(), from, to, type: r.type, anchor: r.anchor, review: "proposed", materialId: input.material.id });
  }

  const runRecord = (questions: UploadPlan["questions"]): PipelineRun => ({
    id: input.runId,
    courseId: input.course.id,
    materialId: input.material.id,
    at: input.now,
    model: input.model,
    topicsCreated: newTopics.map((t) => t.id),
    objectivesCreated: newObjectives.map((o) => o.id),
    objectivesAttached: Object.keys(objectiveUpdates),
    questionsAdded: Object.values(questions).flat().length,
    dropped,
    ...(input.hiddenText ? { hiddenText: input.hiddenText } : {}),
  });
  if (deps.structureOnly) return { newTopics, topicAliases, newObjectives, objectiveUpdates, relations, questions: {}, run: runRecord({}) };

  /* 5–7. Questions for every objective this upload touched that is short of its stock */
  const objectiveById = new Map<string, Objective>([...Object.values(input.objectives), ...newObjectives].map((o) => [o.id, o]));
  const liveQuestions = (id: string) => Object.values(input.bank).flat().filter((q) => q.objectiveId && survivor(q.objectiveId, objectiveById)?.id === id);
  const targets = [...new Set([...newObjectives.map((o) => o.id), ...Object.keys(objectiveUpdates)])]
    .map((id) => objectiveById.get(id)!)
    .filter((o) => o.review !== "archived")
    .map((o) => ({ objective: o, existing: liveQuestions(o.id), need: QUESTIONS_PER_OBJECTIVE - liveQuestions(o.id).length }))
    .filter((x) => x.need > 0);
  const written = await writeQuestions(
    {
      course: input.course,
      material: input.material,
      pages: input.pages,
      topics: new Map([...input.course.topics, ...newTopics].map((t) => [t.id, t])),
      targets,
      bank: input.bank,
    },
    deps,
  );
  dropped.push(...written.dropped);
  const questions = written.questions;

  return {
    newTopics,
    topicAliases,
    newObjectives,
    objectiveUpdates,
    relations,
    questions,
    run: runRecord(questions),
  };
}

export interface WriteTarget {
  objective: Objective;
  /** Its questions so far, so the model doesn't repeat them. */
  existing: readonly QuizQuestion[];
  need: number;
}

export interface WriteInput {
  course: { name: string; short: string };
  material: Material;
  pages: Array<{ n: number; text: string }>;
  topics: ReadonlyMap<string, Topic>;
  targets: readonly WriteTarget[];
  /** Every question the course has (topicId → questions), for spotting duplicates. */
  bank: Readonly<Record<string, readonly QuizQuestion[]>>;
}

/**
 * Write questions for objectives from one material, then check them: a blind solve, an ambiguity
 * check for choice questions and rubric agreement for prose answers. Questions that fail, duplicate
 * one the course has, or need a figure that can't be rendered are dropped with a reason.
 */
export async function writeQuestions(
  input: WriteInput,
  deps: Pick<RunDeps, "call" | "newId" | "renderFigure" | "onProgress">,
): Promise<{ questions: Record<string, QuizQuestion[]>; dropped: PipelineRun["dropped"] }> {
  const { call, newId } = deps;
  const progress = deps.onProgress ?? (() => {});
  const dropped: PipelineRun["dropped"] = [];
  /* Write */
  const touched = input.targets.map((t) => ({ o: t.objective, existing: t.existing, need: t.need }));
  progress({ stage: "writing", objectives: touched.length });
  const topicsById = input.topics;
  const byTopic = new Map<string, typeof touched>();
  for (const x of touched) byTopic.set(x.o.topicId, [...(byTopic.get(x.o.topicId) ?? []), x]);
  const jobs = [...byTopic.entries()].flatMap(([topicId, xs]) =>
    Array.from({ length: Math.ceil(xs.length / OBJECTIVES_PER_CALL) }, (_, i) => ({ topicId, xs: xs.slice(i * OBJECTIVES_PER_CALL, (i + 1) * OBJECTIVES_PER_CALL) })),
  );
  const generated = (
    await pool(jobs, 3, async ({ topicId, xs }) => {
      const topic = topicsById.get(topicId)!;
      try {
        const out = await call("generate", {
          course: { name: input.course.name, short: input.course.short },
          material: { filename: input.material.filename, type: input.material.type },
          pages: input.pages,
          topic: { name: topic.name, summary: topic.summary ?? "" },
          objectives: xs.map(({ o, existing, need }) => ({ id: o.id, name: o.name, description: o.description, origin: o.origin, need, existingPrompts: existing.map((q) => q.prompt).slice(0, 40) })),
        });
        const wanted = new Map(xs.map((x) => [x.o.id, x]));
        const kept: Array<{ topicId: string; q: QuizQuestion; figureSlide: number | null }> = [];
        const count = new Map<string, number>();
        for (const g of out.questions) {
          const target = wanted.get(g.objectiveId);
          if (!target) {
            dropped.push({ prompt: g.prompt, reason: "written for an objective it wasn't asked about" });
            continue;
          }
          if ((count.get(g.objectiveId) ?? 0) >= target.need) continue;
          const inferred = target.o.origin === "inferred";
          const problem = structuralProblem(g, inferred);
          if (problem) {
            dropped.push({ prompt: g.prompt, reason: problem });
            continue;
          }
          count.set(g.objectiveId, (count.get(g.objectiveId) ?? 0) + 1);
          const short = g.kind === "Short answer";
          kept.push({
            topicId,
            figureSlide: g.figureSlide,
            q: {
              id: newId(),
              materialId: input.material.id,
              objectiveId: g.objectiveId,
              kind: g.kind,
              tier: g.tier,
              topic: topic.name,
              prompt: g.prompt,
              options: short ? [] : g.options,
              answer: short ? -1 : g.answer,
              exact: short && g.exact && g.exact.length ? g.exact : undefined,
              rubric: short && !(g.exact && g.exact.length) && g.rubric ? g.rubric : undefined,
              explanation: g.explanation,
              // Questions for inferred objectives must not present themselves as course-specific.
              anchor: inferred ? undefined : g.anchor ?? undefined,
            },
          });
        }
        return kept;
      } catch (e) {
        dropped.push({ prompt: `Questions for "${topic.name}"`, reason: `couldn't be written: ${errorText(e)}` });
        return [];
      }
    })
  ).flat();

  /* Check: blind solve, ambiguity for choice questions, rubric agreement */
  progress({ stage: "checking", questions: generated.length });
  const slideText = new Map(input.pages.map((p) => [p.n, p.text]));
  const failures = new Map<string, string>();
  const batches = Array.from({ length: Math.ceil(generated.length / CHECK_BATCH) }, (_, i) => generated.slice(i * CHECK_BATCH, (i + 1) * CHECK_BATCH));
  await pool(batches, 2, async (batch) => {
    const forCheck = batch.map(({ q, figureSlide }) => ({ id: q.id, kind: q.kind, prompt: q.prompt, options: q.options, context: figureSlide ? (slideText.get(figureSlide) ?? null) : null }));
    const fail = (ids: string[], reason: string) => ids.forEach((id) => failures.has(id) || failures.set(id, reason));
    let solved: StepOutput<"solve">;
    try {
      solved = await call("solve", { questions: forCheck });
    } catch (e) {
      fail(batch.map((b) => b.q.id), `couldn't be checked: ${errorText(e)}`);
      return;
    }
    const answers = new Map(solved.answers.map((a) => [a.id, a]));
    const rubricItems: StepInput<"agreement">["items"] = [];
    for (const { q } of batch) {
      const a = answers.get(q.id);
      if (!a) {
        fail([q.id], "the independent check skipped it");
      } else if (q.kind !== "Short answer") {
        if (a.choice !== q.answer) fail([q.id], `an independent solve picked "${q.options[a.choice ?? -1] ?? "nothing"}", not the marked answer`);
      } else if (q.exact) {
        if (gradeExact(a.text ?? "", q.exact).outcome !== "correct") fail([q.id], `an independent solve answered "${a.text ?? ""}", not ${q.exact[0]}`);
      } else if (q.rubric) {
        rubricItems.push({ id: q.id, prompt: q.prompt, rubric: q.rubric, independentAnswer: a.text ?? "" });
      }
    }
    const choice = batch.filter(({ q }) => q.kind !== "Short answer" && !failures.has(q.id));
    await Promise.all([
      choice.length
        ? call("ambiguity", { questions: choice.map(({ q, figureSlide }) => ({ ...forCheck.find((f) => f.id === q.id)!, context: figureSlide ? (slideText.get(figureSlide) ?? null) : null, marked: q.answer })) })
            .then((r) => {
              const results = new Map(r.results.map((x) => [x.id, x]));
              for (const { q } of choice) {
                const x = results.get(q.id);
                if (!x) fail([q.id], "the ambiguity check skipped it");
                else if (x.ambiguous) fail([q.id], `ambiguous: ${x.reasoning}`);
              }
            })
            .catch((e) => fail(choice.map((c) => c.q.id), `couldn't be checked: ${errorText(e)}`))
        : null,
      rubricItems.length
        ? call("agreement", { items: rubricItems })
            .then((r) => {
              const results = new Map(r.results.map((x) => [x.id, x]));
              for (const item of rubricItems) {
                const x = results.get(item.id);
                if (!x) fail([item.id], "the answer check skipped it");
                else if (!x.agrees) fail([item.id], `an independent answer disagreed with the rubric: ${x.reasoning}`);
              }
            })
            .catch((e) => fail(rubricItems.map((i) => i.id), `couldn't be checked: ${errorText(e)}`))
        : null,
    ]);
  });

  /* Duplicates and figures */
  const seen = new Set(Object.values(input.bank).flat().map((q) => promptKey(q.prompt)));
  const passed: typeof generated = [];
  for (const g of generated) {
    const failure = failures.get(g.q.id);
    if (failure) {
      dropped.push({ prompt: g.q.prompt, reason: failure });
      continue;
    }
    const key = promptKey(g.q.prompt);
    if (seen.has(key)) {
      dropped.push({ prompt: g.q.prompt, reason: "the course already has this question" });
      continue;
    }
    seen.add(key);
    passed.push(g);
  }
  const slides = [...new Set(passed.map((p) => p.figureSlide).filter((n): n is number => n !== null && slideText.has(n)))];
  if (slides.length) progress({ stage: "figures", slides: slides.length });
  const figures = new Map<number, string | null>();
  for (const n of slides) figures.set(n, deps.renderFigure ? await deps.renderFigure(n).catch(() => null) : null);
  const questions: Record<string, QuizQuestion[]> = {};
  for (const p of passed) {
    if (p.figureSlide !== null) {
      const src = figures.get(p.figureSlide);
      if (!src) {
        dropped.push({ prompt: p.q.prompt, reason: `needs slide ${p.figureSlide} as a figure, which couldn't be rendered` });
        continue;
      }
      p.q.figure = { src, alt: `Slide ${p.figureSlide} of ${input.material.filename}` };
    }
    (questions[p.topicId] ??= []).push(p.q);
  }

  return { questions, dropped };
}
