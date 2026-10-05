/**
 * Assembling a session from the question stock at the moment the student presses start
 * (docs/MASTERY-PLAN.md §3, roadmap "Questions are generated ahead, sessions are assembled at
 * start"). Pure: the caller passes ranked objectives, their questions and what the student has seen.
 */
import type { Duration, MaterialType, QuestionTier, QuizQuestion, Weights } from "../data.ts";
import { sliderFor } from "../course/weights.ts";
import type { EvidenceEvent, ObjectiveState, ObjectiveStatus } from "./types.ts";

/** Seconds a student needs per question, by what it asks for. */
export const QUESTION_SECONDS = { choice: 30, exact: 45, sentence: 90 } as const;

export type SessionQuestion = Pick<QuizQuestion, "id" | "kind" | "tier" | "exact" | "rubric" | "materialId">;

export function questionSeconds(q: Pick<QuizQuestion, "kind" | "exact">): number {
  if (q.kind !== "Short answer") return QUESTION_SECONDS.choice;
  return q.exact?.length ? QUESTION_SECONDS.exact : QUESTION_SECONDS.sentence;
}

export function durationSeconds(d: Duration): number {
  const m = /^(\d+) (min|hours?)$/.exec(d);
  if (!m) throw new Error(`Unknown duration "${d}"`);
  return Number(m[1]) * (m[2] === "min" ? 60 : 3600);
}

/** An objective that could go into a session, already ranked (highest priority first). */
export interface SessionCandidate {
  objectiveId: string;
  topicId: string;
  status: ObjectiveStatus;
  /** ISO time its spaced check is due; null unless mastered or fading. */
  dueAt: string | null;
  questions: readonly SessionQuestion[];
}

export interface SessionItem {
  questionId: string;
  objectiveId: string;
  topicId: string;
  /** The student has answered this question before (the objective had no unseen ones left). */
  seenBefore: boolean;
}

export interface AssembledSession {
  items: SessionItem[];
  budgetSeconds: number;
  plannedSeconds: number;
}

export interface SessionContext {
  /** questionId → ISO time of the student's latest answer to it. */
  lastSeen: ReadonlyMap<string, string>;
  budgetSeconds: number;
  now: Date;
  dayKey: (iso: string) => string;
}

const DEEP_TIERS: readonly QuestionTier[] = ["application", "connection", "transfer", "mechanism"];

/** The next question to ask from one objective: unseen first (in stock order), else the one seen longest ago. */
function pick(questions: readonly SessionQuestion[], used: ReadonlySet<string>, lastSeen: ReadonlyMap<string, string>, prefer?: (q: SessionQuestion) => boolean) {
  const pool = questions.filter((q) => !used.has(q.id));
  const rank = (q: SessionQuestion) => {
    const seen = lastSeen.get(q.id);
    return [prefer && !prefer(q) ? 1 : 0, seen === undefined ? 0 : 1, seen === undefined ? 0 : Date.parse(seen)] as const;
  };
  const sorted = pool
    .map((q, i) => ({ q, i, r: rank(q) }))
    .sort((a, b) => a.r[0] - b.r[0] || a.r[1] - b.r[1] || a.r[2] - b.r[2] || a.i - b.i);
  return sorted[0]?.q ?? null;
}

/** Quick-review order (§3): mixed-up → fading, overdue before today → learning → fading due today → unseen. Priority order inside each group. */
function quickGroup(c: SessionCandidate, today: string, dayKey: (iso: string) => string): number {
  switch (c.status) {
    case "mixed-up":
      return 0;
    case "fading":
      return c.dueAt !== null && dayKey(c.dueAt) < today ? 1 : 3;
    case "learning":
      return 2;
    case "unseen":
      return 4;
    default:
      return 5;
  }
}

const isMechanism = (q: SessionQuestion) => q.tier === "mechanism";
const needsMore = (c: SessionCandidate) => c.status === "unseen" || c.status === "learning" || c.status === "mixed-up";

/**
 * A quick review: one question per objective in order, then more rounds for objectives not yet
 * mastered, until the budget is spent. At least one question; at least one mechanism question when
 * any candidate has one.
 */
export function assembleQuickReview(candidates: readonly SessionCandidate[], ctx: SessionContext): AssembledSession {
  const today = ctx.dayKey(ctx.now.toISOString());
  const ordered = candidates
    .map((c, i) => ({ c, i, g: quickGroup(c, today, ctx.dayKey) }))
    .sort((a, b) => a.g - b.g || a.i - b.i)
    .map((x) => x.c);
  const items: Array<SessionItem & { seconds: number; mechanism: boolean }> = [];
  const used = new Set<string>();
  let time = 0;
  const add = (c: SessionCandidate, q: SessionQuestion) => {
    used.add(q.id);
    time += questionSeconds(q);
    items.push({ questionId: q.id, objectiveId: c.objectiveId, topicId: c.topicId, seenBefore: ctx.lastSeen.has(q.id), seconds: questionSeconds(q), mechanism: isMechanism(q) });
  };

  for (let round = 0; ; round++) {
    let added = false;
    for (const c of ordered) {
      if (round > 0 && !needsMore(c)) continue;
      const q = pick(c.questions, used, ctx.lastSeen, c.status === "mixed-up" ? isMechanism : undefined);
      if (!q) continue;
      if (items.length > 0 && time + questionSeconds(q) > ctx.budgetSeconds) continue;
      add(c, q);
      added = true;
    }
    if (!added) break;
  }

  if (items.length > 0 && !items.some((i) => i.mechanism)) {
    const withMechanism = ordered.find((c) => c.questions.some((q) => isMechanism(q) && !used.has(q.id)));
    if (withMechanism) {
      const q = pick(withMechanism.questions.filter(isMechanism), used, ctx.lastSeen)!;
      while (items.length > 0 && time + questionSeconds(q) > ctx.budgetSeconds) time -= items.pop()!.seconds;
      add(withMechanism, q);
    }
  }

  const toItem = (i: SessionItem): SessionItem => ({ questionId: i.questionId, objectiveId: i.objectiveId, topicId: i.topicId, seenBefore: i.seenBefore });
  return { items: items.map(toItem), budgetSeconds: ctx.budgetSeconds, plannedSeconds: time };
}

/** A re-quiz after a poor session: a quick review of only those objectives. */
export function assembleRequiz(candidates: readonly SessionCandidate[], objectiveIds: readonly string[], ctx: SessionContext): AssembledSession {
  const wanted = new Set(objectiveIds);
  return assembleQuickReview(
    candidates.filter((c) => wanted.has(c.objectiveId)),
    ctx,
  );
}

/** What a deep review of a given length covers, for the plan shown before it starts. */
export interface DeepCoverage {
  /** Objectives that could go into a deep review (answered, not retired, with a question in a type that has a slider share). */
  objectives: number;
  /** Of those, how many get at least one question. */
  covered: number;
  /** Seconds that give every one of those objectives one question. */
  coverAllSeconds: number;
  /** Seconds of every question that could be asked: the longest session the stock can fill. */
  stockSeconds: number;
}

export type DeepReviewContext = SessionContext & { sliders: Weights; materialTypeOf: (materialId: string) => MaterialType | null };

/**
 * A deep review: objectives the student has answered (not retired), deeper tiers first. First every
 * objective gets one question, highest priority first, so a short session covers what matters most
 * before going deeper on anything. The rest of the budget is split across material types in
 * proportion to the Settings sliders; a question's type is its upload's type, and types without a
 * slider ("Other", hand-written) count at the mean slider. The coverage pass counts toward those
 * shares (it takes each objective's question from the type furthest under its share), and time a
 * type can't fill goes to the others.
 */
export function assembleDeepReview(candidates: readonly SessionCandidate[], ctx: DeepReviewContext): AssembledSession & { coverage: DeepCoverage } {
  const sliderValues = Object.values(ctx.sliders);
  const meanSlider = sliderValues.reduce((a, b) => a + b, 0) / (sliderValues.length || 1);
  const bucketOf = (q: SessionQuestion) => {
    const type = q.materialId ? ctx.materialTypeOf(q.materialId) : null;
    return (type && sliderFor(type)) ?? "other";
  };
  const sliderOf = (bucket: string) => (bucket === "other" ? meanSlider : (ctx.sliders[bucket] ?? meanSlider));
  const askable = (q: SessionQuestion) => sliderOf(bucketOf(q)) > 0;
  const pool = candidates
    .filter((c) => c.status !== "unseen" && c.status !== "retired")
    .map((c) => ({ ...c, questions: c.questions.filter(askable) }))
    .filter((c) => c.questions.length > 0);
  const buckets = [...new Set(pool.flatMap((c) => c.questions.map(bucketOf)))];
  const total = buckets.reduce((sum, b) => sum + sliderOf(b), 0);
  const isDeep = (q: SessionQuestion) => q.tier !== undefined && DEEP_TIERS.includes(q.tier);

  const used = new Set<string>();
  const spentBy = new Map<string, number>();
  const chosen: Array<SessionItem & { rank: number; round: number }> = [];
  let time = 0;
  const take = (c: SessionCandidate, q: SessionQuestion, rank: number, round: number) => {
    const s = questionSeconds(q);
    used.add(q.id);
    time += s;
    spentBy.set(bucketOf(q), (spentBy.get(bucketOf(q)) ?? 0) + s);
    chosen.push({ questionId: q.id, objectiveId: c.objectiveId, topicId: c.topicId, seenBefore: ctx.lastSeen.has(q.id), rank, round });
  };

  /* Coverage pass: one question per objective, in priority order, while it fits. */
  let coverAllSeconds = 0;
  pool.forEach((c, rank) => {
    const deep = c.questions.filter(isDeep);
    const qs = deep.length ? deep : c.questions;
    const under = (b: string) => (spentBy.get(b) ?? 0) / sliderOf(b);
    const bucket = [...new Set(qs.map(bucketOf))].sort((a, b) => under(a) - under(b) || sliderOf(b) - sliderOf(a))[0];
    const q = pick(qs.filter((x) => bucketOf(x) === bucket), used, ctx.lastSeen)!;
    coverAllSeconds += questionSeconds(q);
    if (chosen.length > 0 && time + questionSeconds(q) > ctx.budgetSeconds) return;
    take(c, q, rank, 0);
  });
  const covered = new Set(chosen.map((i) => i.objectiveId)).size;

  /* Depth: the rest of each type's share, round-robin over objectives, deeper tiers first. */
  const fill = (bucket: string | null, allowance: number) => {
    let spent = bucket === null ? 0 : (spentBy.get(bucket) ?? 0);
    for (let round = 1; ; round++) {
      let added = false;
      pool.forEach((c, rank) => {
        const qs = bucket === null ? c.questions : c.questions.filter((q) => bucketOf(q) === bucket);
        const q = pick(qs, used, ctx.lastSeen, isDeep);
        if (!q) return;
        const s = questionSeconds(q);
        if (spent + s > allowance || time + s > ctx.budgetSeconds) return;
        spent += s;
        take(c, q, rank, round);
        added = true;
      });
      if (!added) return;
    }
  };
  for (const b of buckets) fill(b, (ctx.budgetSeconds * sliderOf(b)) / total);
  fill(null, ctx.budgetSeconds);

  const items = chosen
    .sort((a, b) => a.round - b.round || a.rank - b.rank)
    .map((i): SessionItem => ({ questionId: i.questionId, objectiveId: i.objectiveId, topicId: i.topicId, seenBefore: i.seenBefore }));
  const stockSeconds = pool.reduce((sum, c) => sum + c.questions.reduce((s, q) => s + questionSeconds(q), 0), 0);
  return { items, budgetSeconds: ctx.budgetSeconds, plannedSeconds: time, coverage: { objectives: pool.length, covered, coverAllSeconds, stockSeconds } };
}

/** questionId → ISO time of the latest answer to it. */
export function lastSeenOf(events: readonly EvidenceEvent[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of events) {
    if (e.kind !== "answer") continue;
    const prev = out.get(e.questionId);
    if (prev === undefined || Date.parse(e.at) > Date.parse(prev)) out.set(e.questionId, e.at);
  }
  return out;
}

/** Ranked objectives → session candidates with their questions. An objective with no questions can't be asked and is left out. */
export function sessionCandidates(
  ranked: ReadonlyArray<{ objectiveId: string; topicId: string; status: ObjectiveStatus }>,
  states: ReadonlyMap<string, Pick<ObjectiveState, "dueAt">>,
  questionsByObjective: ReadonlyMap<string, readonly SessionQuestion[]>,
): SessionCandidate[] {
  return ranked.flatMap((r) => {
    const questions = questionsByObjective.get(r.objectiveId) ?? [];
    const state = states.get(r.objectiveId);
    if (!state) throw new Error(`No state computed for objective ${r.objectiveId}`);
    return questions.length ? [{ objectiveId: r.objectiveId, topicId: r.topicId, status: r.status, dueAt: state.dueAt, questions }] : [];
  });
}
