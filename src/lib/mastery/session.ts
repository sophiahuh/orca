/**
 * Assembling a quick review or re-quiz from the question stock at the moment the student presses
 * start (docs/MASTERY-PLAN.md §3). Deep reviews have their questions written when they start
 * (POST /api/deep-review). Pure: the caller passes ranked objectives, their questions and what the student has seen.
 */
import type { Duration, QuizQuestion } from "../data.ts";
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
