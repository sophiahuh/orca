/**
 * course_state's cram fields (docs/superpowers/specs/2026-11-10-cram-mode-contracts.md, section 6):
 * `plan` (the derived cram plan over the cramming exam, src/lib/mastery/cram-plan.ts: the same
 * calculation the cram page reads in the browser), `coverage` (how much of the scoping exam's scope
 * is verified) and `topErrors` (the kinds of mistake made most). No model calls; two reads beyond
 * what course_state already holds: the sessions finished and the evidence recorded since the cram
 * started (or the last 30 days).
 */
import type { CourseState, CoverageLine, ExamLine, ObjectiveLine, TopError } from "@/lib/connector/mcp";
import { scopingExam } from "@/lib/course/weights";
import { ERROR_TYPES } from "@/lib/grading";
import { cramPlan, type CramPlanInput } from "@/lib/mastery/cram-plan";
import { dayKeyIn } from "@/lib/mastery/objective-state";
import type { ErrorType, ObjectiveStatus } from "@/lib/mastery/types";
import type { OrcaSupabase } from "@/lib/supabase/server";

/** The connector estimate counts at most this much of a day's chat as study (contract section 6). */
export const CONNECTOR_MINUTES_PER_DAY_CAP = 120;
/** topErrors look back this far when no cram sets `budget.since`. */
export const TOP_ERRORS_DAYS = 30;
const TOP_ERRORS_LIMIT = 6;

export interface CramFieldsInput {
  courseId: string;
  at: Date;
  timezone: string;
  /** YYYY-MM-DD in the student's timezone. */
  today: string;
  exams: readonly ExamLine[];
  /** The course's live topics, in order. */
  topics: ReadonlyArray<{ id: string; name: string }>;
  /** Every live objective with its derived status. */
  objectives: readonly ObjectiveLine[];
  /** The agenda's effective weights (course × scope inside the window), by objective id. */
  weights: ReadonlyMap<string, number>;
}

/**
 * Minutes of connector study estimated from its evidence: per day (the student's), the span from the
 * first to the last connector-sourced event, capped. A day with one event counts 0.
 */
export function connectorMinutes(events: ReadonlyArray<{ at: string; source: string | null }>, timezone: string): number {
  const dayKey = dayKeyIn(timezone);
  const spans = new Map<string, { first: number; last: number }>();
  for (const e of events) {
    if (e.source !== "connector") continue;
    const t = Date.parse(e.at);
    const day = dayKey(e.at);
    const span = spans.get(day);
    if (!span) spans.set(day, { first: t, last: t });
    else {
      span.first = Math.min(span.first, t);
      span.last = Math.max(span.last, t);
    }
  }
  let minutes = 0;
  for (const { first, last } of spans.values()) minutes += Math.min(CONNECTOR_MINUTES_PER_DAY_CAP, (last - first) / 60_000);
  return minutes;
}

/** The kinds of mistake on answer and work events, most frequent first (ties by name), at most six. */
export function topErrorsOf(events: ReadonlyArray<{ kind: string; error_type: string | null }>): TopError[] {
  const counts = new Map<ErrorType, number>();
  for (const e of events) {
    if ((e.kind !== "answer" && e.kind !== "work") || !e.error_type || !(ERROR_TYPES as readonly string[]).includes(e.error_type)) continue;
    const type = e.error_type as ErrorType;
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return [...counts]
    .map(([errorType, count]) => ({ errorType, count }))
    .sort((a, b) => b.count - a.count || a.errorType.localeCompare(b.errorType))
    .slice(0, TOP_ERRORS_LIMIT);
}

/** The exam's topics as the plan reads them: the ones it names (every live topic when it names none), each with its in-scope objectives' weights and statuses. */
function planTopics(exam: ExamLine, input: Pick<CramFieldsInput, "topics" | "objectives" | "weights">): CramPlanInput["topics"] {
  const named = new Set(exam.topicIds);
  return input.topics
    .filter((t) => named.size === 0 || named.has(t.id))
    .map((t) => ({
      id: t.id,
      name: t.name,
      objectives: input.objectives.filter((o) => o.topicId === t.id).map((o) => ({ id: o.id, name: o.name, weight: input.weights.get(o.id) ?? 0, status: o.status as ObjectiveStatus })),
    }));
}

const VERIFIED: ReadonlySet<ObjectiveStatus> = new Set(["verified", "mastered"]);

function coverageOf(topics: CramPlanInput["topics"]): CoverageLine {
  const byTopic = topics.map((t) => {
    const inScope = t.objectives.filter((o) => o.weight > 0);
    return { topicId: t.id, verified: inScope.filter((o) => VERIFIED.has(o.status)).length, total: inScope.length };
  });
  const verified = byTopic.reduce((n, t) => n + t.verified, 0);
  const total = byTopic.reduce((n, t) => n + t.total, 0);
  return { verified, total, share: total ? verified / total : 0, byTopic };
}

export async function cramFields(db: OrcaSupabase, ownerId: string, input: CramFieldsInput): Promise<Pick<CourseState, "plan" | "coverage" | "topErrors">> {
  const scoped = input.exams.map((e) => ({ ...e, courseId: input.courseId }));
  const scoping = scopingExam(scoped, input.courseId, input.today);
  const cramming = scoped.find((e) => e.cramming) ?? null;
  const budget = cramming?.scope?.budget ?? null;
  const since = budget?.since ?? new Date(input.at.getTime() - TOP_ERRORS_DAYS * 86_400_000).toISOString();

  const [sessions, events] = await Promise.all([
    budget ? db.from("session_results").select("seconds").eq("owner_id", ownerId).eq("course_id", input.courseId).gte("finished_at", since) : Promise.resolve({ data: [], error: null }),
    db.from("evidence_events").select("at, kind, source, error_type").eq("owner_id", ownerId).eq("course_id", input.courseId).gte("at", since),
  ]);
  for (const r of [sessions, events]) if (r.error) throw new Error(`Couldn't read the course: ${r.error.message}`);

  const coverage = scoping ? coverageOf(planTopics(scoping, input)) : null;
  let plan: CourseState["plan"] = null;
  if (cramming && budget) {
    const sessionMinutes = (sessions.data ?? []).reduce((n, s) => n + s.seconds, 0) / 60;
    plan = cramPlan({ today: input.today, examDate: cramming.date, budget, topics: planTopics(cramming, input), spentMinutes: sessionMinutes + connectorMinutes(events.data ?? [], input.timezone) });
  }
  return { plan, coverage, topErrors: topErrorsOf(events.data ?? []) };
}
