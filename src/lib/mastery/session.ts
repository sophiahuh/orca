/**
 * Assembling a session from the question stock at the moment the student presses start
 * (docs/MASTERY-PLAN.md §3, roadmap "Questions are generated ahead, sessions are assembled at
 * start"). Pure: the caller passes ranked objectives, their questions and what the student has seen.
 */
import type { Duration, MaterialType, QuestionTier, QuizQuestion, Weights } from "../data.ts";
import { sliderFor } from "../course/weights.ts";
import type { ObjectiveStatus } from "./types.ts";

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

  return { items: items.map(({ seconds: _s, mechanism: _m, ...item }) => item), budgetSeconds: ctx.budgetSeconds, plannedSeconds: time };
}

/** A re-quiz after a poor session: a quick review of only those objectives. */
export function assembleRequiz(candidates: readonly SessionCandidate[], objectiveIds: readonly string[], ctx: SessionContext): AssembledSession {
  const wanted = new Set(objectiveIds);
  return assembleQuickReview(
    candidates.filter((c) => wanted.has(c.objectiveId)),
    ctx,
  );
}

/**
 * A deep review: objectives the student has answered (not retired), deeper tiers first. The budget
 * is split across material types in proportion to the Settings sliders; a question's type is its
 * upload's type, and types without a slider ("Other", hand-written) count at the mean slider. Time a
 * type can't fill goes to the others.
 */
export function assembleDeepReview(
  candidates: readonly SessionCandidate[],
  ctx: SessionContext & { sliders: Weights; materialTypeOf: (materialId: string) => MaterialType | null },
): AssembledSession {
  const pool = candidates.filter((c) => c.status !== "unseen" && c.status !== "retired");
  const sliderValues = Object.values(ctx.sliders);
  const meanSlider = sliderValues.reduce((a, b) => a + b, 0) / (sliderValues.length || 1);
  const bucketOf = (q: SessionQuestion) => {
    const type = q.materialId ? ctx.materialTypeOf(q.materialId) : null;
    return (type && sliderFor(type)) ?? "other";
  };
  const sliderOf = (bucket: string) => (bucket === "other" ? meanSlider : (ctx.sliders[bucket] ?? meanSlider));
  const buckets = [...new Set(pool.flatMap((c) => c.questions.map(bucketOf)))].filter((b) => sliderOf(b) > 0);
  const total = buckets.reduce((sum, b) => sum + sliderOf(b), 0);

  const used = new Set<string>();
  const chosen: Array<SessionItem & { rank: number; round: number }> = [];
  let time = 0;
  const fill = (bucket: string | null, allowance: number) => {
    let spent = 0;
    for (let round = 0; ; round++) {
      let added = false;
      pool.forEach((c, rank) => {
        const qs = c.questions.filter((q) => bucket === null ? buckets.includes(bucketOf(q)) : bucketOf(q) === bucket);
        const q = pick(qs, used, ctx.lastSeen, (x) => x.tier !== undefined && DEEP_TIERS.includes(x.tier));
        if (!q) return;
        const s = questionSeconds(q);
        const first = chosen.length === 0;
        if (!first && (spent + s > allowance || time + s > ctx.budgetSeconds)) return;
        used.add(q.id);
        spent += s;
        time += s;
        chosen.push({ questionId: q.id, objectiveId: c.objectiveId, topicId: c.topicId, seenBefore: ctx.lastSeen.has(q.id), rank, round });
        added = true;
      });
      if (!added) return;
    }
  };
  for (const b of buckets) fill(b, (ctx.budgetSeconds * sliderOf(b)) / total);
  fill(null, ctx.budgetSeconds);

  const items = chosen.sort((a, b) => a.round - b.round || a.rank - b.rank).map(({ rank: _r, round: _o, ...item }) => item);
  return { items, budgetSeconds: ctx.budgetSeconds, plannedSeconds: time };
}
