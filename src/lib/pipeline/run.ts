/**
 * The upload pipeline: extract → match duplicates → write questions. Model calls are
 * injected (`call`), so the orchestration is tested with fakes; the result is a plan that
 * `applyUploadPlan` merges into the course. Nothing here touches the store.
 */
import type { Material, Objective, ObjectiveSignal, PipelineRun, QuizQuestion, Relation, Topic } from "../data.ts";
import { type Named, exactMatch, normaliseName, shortlist } from "../course/match.ts";
import { locatorPages } from "../course/study.ts";
import { sanitize } from "../untrusted/sanitize.ts";
import { screen } from "../untrusted/screen.ts";
import { urlsIn, validateFields } from "../untrusted/validate.ts";
import { linkReason, linkTopics, liveDirectional } from "./link.ts";
import { DIRECTIONAL, KIND_RANK, LOOP_REASON, closesLoop, pairKey } from "../course/links.ts";
import { QUESTIONS_PER_OBJECTIVE, promptKey } from "./questions.ts";
import { DEEP_TEXT, type ExtractOutput, type GeneratedQuestion, type StepInput, type StepName, type StepOutput } from "./schemas.ts";

export type CallStep = <S extends StepName>(step: S, input: StepInput<S>) => Promise<StepOutput<S>>;

export type Progress =
  | { stage: "transcribing"; pages: number }
  | { stage: "mapping" }
  | { stage: "matching"; candidates: number }
  | { stage: "writing"; objectives: number }
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

const OBJECTIVES_PER_CALL = 8;

/** Run `fn` over `items`, at most `limit` at a time, keeping order. */
async function pool<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
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
    // Model prose shown on the review screen: sanitised like every generated string (decision 13).
    if (r.decision === "uncertain") return { kind: "new", uncertain: { candidateId: match ?? close[0].id, reasoning: shown(r.reasoning) } };
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

/** Dropped-list reasons that begin like this were refused by the output validators (decision 13). */
export const REFUSED_PREFIX = "refused: ";

/** Model text that is only shown (a dropped prompt, a check's reasoning): sanitised, never trusted to be short. */
const shown = (text: string, max = 240) => sanitize(text, max).text;

/** What the validators need to know about the material: which slides exist and which URLs it contains. */
export interface MaterialFacts {
  pages: ReadonlySet<number>;
  allowedUrls: ReadonlySet<string>;
}

export function materialFacts(pages: ReadonlyArray<{ n: number; text: string }>): MaterialFacts {
  return { pages: new Set(pages.map((p) => p.n)), allowedUrls: urlsIn(pages.map((p) => p.text).join("\n")) };
}

/** An anchor that names slides must name ones the material has; one that names something else (a problem number) can't be checked and is kept. */
function anchorExists(locator: string, facts: MaterialFacts): boolean {
  const named = locatorPages(locator);
  return named.length === 0 || named.every((n) => facts.pages.has(n));
}

const TEXT_RULE = (facts: MaterialFacts, maxChars = 1200) => ({ maxChars, allowedUrls: facts.allowedUrls });
const SHORT_RULE = (facts: MaterialFacts) => ({ maxChars: 240, allowedUrls: facts.allowedUrls });

/** The pattern screen over every page of the material, each hit tagged with its slide and its severity. */
export function screenMaterial(pages: ReadonlyArray<{ n: number; text: string }>): NonNullable<PipelineRun["security"]>["screen"] {
  const hits: NonNullable<PipelineRun["security"]>["screen"] = [];
  for (const p of pages) {
    for (const h of screen(p.text).hits) {
      if (hits.length >= 40) return hits;
      hits.push({ check: h.check, severity: h.severity, quote: `slide ${p.n}: ${h.quote}`.slice(0, 240) });
    }
  }
  return hits;
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
  const facts = materialFacts(input.pages);
  // Decision 13: the material is screened for instruction-like text before anything is built from it; a hit never blocks.
  const materialScreen = screenMaterial(input.pages);
  const extracted: ExtractOutput = await call("extract", {
    course: { name: input.course.name, short: input.course.short },
    material: { filename: input.material.filename, type: input.material.type },
    pages: input.pages,
    existingTopics: listed(existingTopics),
    existingObjectives: listed(existingObjectives).map((o) => ({ ...o, topicId: input.objectives[o.id].topicId })),
  });
  const instructionsFound = (extracted.instructionsFound ?? []).map((q) => sanitize(q, 240).text).filter((q) => q.length > 0);
  const refuse = (what: string, reason: string) => dropped.push({ prompt: what, reason: `${REFUSED_PREFIX}${reason}` });

  /* 2. Topics */
  progress({ stage: "matching", candidates: extracted.topics.length + extracted.objectives.length });
  const topicByRef = new Map<string, { kind: "existing" | "new"; id: string } | { kind: "dropped" }>();
  const newTopics: Topic[] = [];
  const topicAliases: Record<string, string[]> = {};
  // Validators first (decision 13): a topic whose text holds a URL the material doesn't, HTML, a link or an instruction is refused, never repaired.
  const topicTexts = extracted.topics.map((t) => validateFields({ name: t.name, summary: t.summary, ...Object.fromEntries(t.aliases.map((a, i) => [`alias ${i + 1}`, a])) }, SHORT_RULE(facts)));
  const topicResolutions = await pool(extracted.topics, 4, (t, i) =>
    topicTexts[i].ok ? resolve("topic", { existingId: t.existingId, name: t.name, aliases: t.aliases, description: t.summary }, existingTopics, call) : Promise.resolve<Resolution>({ kind: "dropped", reason: "" }),
  );
  extracted.topics.forEach((t, i) => {
    const r = topicResolutions[i];
    const text = topicTexts[i];
    if (!text.ok) {
      refuse(`Topic "${sanitize(t.name, 60).text}"`, text.reason);
      topicByRef.set(t.localId, { kind: "dropped" });
      return;
    }
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
  const objectiveTexts = extracted.objectives.map((o) =>
    validateFields(
      {
        name: o.name,
        description: o.description,
        ...Object.fromEntries(o.aliases.map((a, i) => [`alias ${i + 1}`, a])),
        ...Object.fromEntries(o.places.map((pl, i) => [`place ${i + 1}`, pl.excerpt])),
        ...(o.emphasis ? { emphasis: o.emphasis.quote } : {}),
      },
      { maxChars: 400, allowedUrls: facts.allowedUrls },
    ),
  );
  const objectiveResolutions = await pool(extracted.objectives, 4, (o, i) =>
    objectiveTexts[i].ok ? resolve("objective", { existingId: o.existingId, name: o.name, aliases: o.aliases, description: o.description }, existingObjectives, call) : Promise.resolve<Resolution>({ kind: "dropped", reason: "" }),
  );
  extracted.objectives.forEach((o, i) => {
    const r = objectiveResolutions[i];
    const text = objectiveTexts[i];
    if (!text.ok) {
      refuse(`Objective "${sanitize(o.name, 120).text}"`, text.reason);
      return;
    }
    // A place that names slides the material doesn't have is left out (the objective stays).
    const places = o.places.filter((pl) => {
      const ok = anchorExists(pl.locator, facts);
      if (!ok) refuse(`A place of objective "${o.name}"`, `names ${pl.locator}, which this material doesn't have`);
      return ok;
    });
    const signal = o.origin === "material" ? signalFor(places, o.emphasis) : signalFor([], o.emphasis);
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

  /* 4. Relations between topics (new and existing; a merged topic's links go to its survivor) */
  const linkTopic = (ref: string) => {
    const id = topicIdOf(ref);
    return id === null || id === "dropped" ? null : id;
  };
  // One link per pair of topics: a pair the course links already is skipped; within this upload the most specific kind comes first.
  const linkedPairs = new Set(input.relations.filter((r) => r.review !== "archived").map((r) => pairKey(r.from, r.to)));
  const relations: Relation[] = [];
  const directional = liveDirectional(input.relations, [...input.course.topics, ...newTopics]);
  for (const r of [...extracted.relations].sort((a, b) => KIND_RANK[a.type] - KIND_RANK[b.type])) {
    const from = linkTopic(r.from);
    const to = linkTopic(r.to);
    if (!from || !to || from === to) continue;
    if (linkedPairs.has(pairKey(from, to))) continue;
    const reason = linkReason(r.reason);
    if (!reason.ok) {
      refuse(`A ${r.type} relation`, reason.reason);
      continue;
    }
    if (DIRECTIONAL.has(r.type) && closesLoop(directional, from, to)) {
      dropped.push({ prompt: `A ${r.type} relation`, reason: LOOP_REASON });
      continue;
    }
    if (r.anchor) {
      const v = validateFields({ excerpt: r.anchor.excerpt }, SHORT_RULE(facts));
      if (!v.ok || !anchorExists(r.anchor.locator, facts)) {
        refuse(`A ${r.type} relation`, v.ok ? `its anchor names ${r.anchor.locator}, which this material doesn't have` : v.reason);
        continue;
      }
    }
    linkedPairs.add(pairKey(from, to));
    if (DIRECTIONAL.has(r.type)) directional.push({ from, to, type: r.type });
    relations.push({ id: newId(), from, to, type: r.type, anchor: r.anchor, review: "proposed", materialId: input.material.id, reason: reason.text });
  }

  /* 5. A focused pass for links (the link step): this upload's new topics against every topic. Extraction
     links only what the slides spell out; this one may use the subject. A failure costs only the links. */
  if (newTopics.length) {
    try {
      const linked = await linkTopics(
        {
          course: input.course,
          topics: [...input.course.topics, ...newTopics],
          newIds: new Set(newTopics.map((t) => t.id)),
          existing: input.relations,
          fromThisRun: relations,
          materialId: input.material.id,
        },
        { call, newId },
      );
      const replaced = new Set(linked.replaced);
      relations.splice(0, relations.length, ...relations.filter((r) => !replaced.has(r.id)), ...linked.links);
      dropped.push(...linked.dropped);
    } catch (e) {
      dropped.push({ prompt: "Links between topics", reason: `couldn't be found: ${errorText(e)}` });
    }
  }

  const runRecord = (questions: UploadPlan["questions"]): PipelineRun => ({
    id: input.runId,
    courseId: input.course.id,
    materialId: input.material.id,
    at: input.now,
    model: input.model,
    status: "done",
    topicsCreated: newTopics.map((t) => t.id),
    objectivesCreated: newObjectives.map((o) => o.id),
    objectivesAttached: Object.keys(objectiveUpdates),
    questionsAdded: Object.values(questions).flat().length,
    dropped,
    ...(input.hiddenText ? { hiddenText: input.hiddenText } : {}),
    security: {
      screen: materialScreen,
      instructionsFound,
      refused: dropped.filter((d) => d.reason.startsWith(REFUSED_PREFIX)).length,
      // Each refusal is logged as a `generated` security event by the database trigger (decision 13).
      refusedItems: dropped.filter((d) => d.reason.startsWith(REFUSED_PREFIX)).slice(0, 40).map((d) => ({ what: d.prompt.slice(0, 120), reason: d.reason.slice(REFUSED_PREFIX.length, REFUSED_PREFIX.length + 110) })),
    },
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
  /** Deep-review questions (the "deep" step: longer, harder short answers), marked `deep`. */
  deep?: boolean;
}

/**
 * Write questions for objectives from one material. They aren't checked by a second model call
 * (owner's decision, 2026-10-06); code still refuses what breaks the rules (wrong objective, bad
 * structure, untrusted-text rules, anchors to slides the material lacks), and duplicates of a
 * question the course has or questions whose figure can't be rendered are dropped with a reason.
 */
export async function writeQuestions(
  input: WriteInput,
  deps: Pick<RunDeps, "call" | "newId" | "renderFigure" | "onProgress">,
): Promise<{ questions: Record<string, QuizQuestion[]>; dropped: PipelineRun["dropped"] }> {
  const { call, newId } = deps;
  const progress = deps.onProgress ?? (() => {});
  const dropped: PipelineRun["dropped"] = [];
  const facts = materialFacts(input.pages);
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
        const out = await call(input.deep ? "deep" : "generate", {
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
            dropped.push({ prompt: shown(g.prompt, 1200), reason: "written for an objective it wasn't asked about" });
            continue;
          }
          if ((count.get(g.objectiveId) ?? 0) >= target.need) continue;
          const inferred = target.o.origin === "inferred";
          const problem = structuralProblem(g, inferred);
          if (problem) {
            dropped.push({ prompt: shown(g.prompt, 1200), reason: problem });
            continue;
          }
          // Decision 13: every string the model wrote is sanitised and refused for a URL the material
          // doesn't have, HTML, a link or instruction-like text; an anchor must name slides that exist.
          const texts = validateFields(
            {
              prompt: g.prompt,
              explanation: g.explanation,
              ...Object.fromEntries(g.options.map((o, i) => [`option ${i + 1}`, o])),
              ...Object.fromEntries((g.exact ?? []).map((e, i) => [`exact answer ${i + 1}`, e])),
              ...Object.fromEntries((g.rubric?.requiredIdeas ?? []).map((e, i) => [`required idea ${i + 1}`, e])),
              ...Object.fromEntries((g.rubric?.acceptableAlternatives ?? []).map((e, i) => [`alternative ${i + 1}`, e])),
              ...Object.fromEntries((g.rubric?.knownMisconceptions ?? []).flatMap((m, i) => [[`misconception ${i + 1}`, m.description], ...m.indicativePhrasing.map((ph, j) => [`misconception ${i + 1} phrasing ${j + 1}`, ph])])),
              ...(g.anchor ? { "anchor excerpt": g.anchor.excerpt } : {}),
            },
            TEXT_RULE(facts, input.deep ? DEEP_TEXT : undefined),
          );
          if (!texts.ok) {
            dropped.push({ prompt: shown(g.prompt, 1200), reason: `${REFUSED_PREFIX}${texts.reason}` });
            continue;
          }
          if (g.anchor && !anchorExists(g.anchor.locator, facts)) {
            dropped.push({ prompt: shown(g.prompt, 1200), reason: `${REFUSED_PREFIX}its anchor names ${shown(g.anchor.locator, 60)}, which this material doesn't have` });
            continue;
          }
          if (g.figureSlide !== null && !facts.pages.has(g.figureSlide)) {
            dropped.push({ prompt: shown(g.prompt, 1200), reason: `${REFUSED_PREFIX}needs slide ${g.figureSlide}, which this material doesn't have` });
            continue;
          }
          count.set(g.objectiveId, (count.get(g.objectiveId) ?? 0) + 1);
          const short = g.kind === "Short answer";
          const v = texts.values;
          kept.push({
            topicId,
            figureSlide: g.figureSlide,
            q: {
              id: newId(),
              materialId: input.material.id,
              objectiveId: g.objectiveId,
              ...(input.deep ? { deep: true } : {}),
              kind: g.kind,
              tier: g.tier,
              topic: topic.name,
              prompt: v.prompt,
              options: short ? [] : g.options.map((_, i) => v[`option ${i + 1}`]),
              answer: short ? -1 : g.answer,
              exact: short && g.exact && g.exact.length ? g.exact.map((_, i) => v[`exact answer ${i + 1}`]) : undefined,
              rubric:
                short && !(g.exact && g.exact.length) && g.rubric
                  ? {
                      requiredIdeas: g.rubric.requiredIdeas.map((_, i) => v[`required idea ${i + 1}`]),
                      acceptableAlternatives: g.rubric.acceptableAlternatives.map((_, i) => v[`alternative ${i + 1}`]),
                      knownMisconceptions: g.rubric.knownMisconceptions.map((m, i) => ({ description: v[`misconception ${i + 1}`], indicativePhrasing: m.indicativePhrasing.map((_, j) => v[`misconception ${i + 1} phrasing ${j + 1}`]) })),
                    }
                  : undefined,
              explanation: v.explanation,
              // Questions for inferred objectives must not present themselves as course-specific.
              anchor: inferred ? undefined : g.anchor ? { locator: g.anchor.locator, excerpt: v["anchor excerpt"] } : undefined,
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

  const slideText = new Map(input.pages.map((p) => [p.n, p.text]));

  /* Duplicates and figures */
  const seen = new Set(Object.values(input.bank).flat().map((q) => promptKey(q.prompt)));
  const passed: typeof generated = [];
  for (const g of generated) {
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
  await pool(slides, 4, async (n) => figures.set(n, deps.renderFigure ? await deps.renderFigure(n).catch(() => null) : null));
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
