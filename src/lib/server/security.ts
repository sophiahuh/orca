/**
 * Security events (Phase 4 plan, decision 13): every suspected item is logged for the owner,
 * with what, which check and a quoted span of at most 240 characters, never the whole text.
 * Service role only; a run's findings arrive through a trigger on `pipeline_runs.security`, the
 * reflection note's and (integration) the prose answer's through `recordSecurityEvents`.
 */
import type { OrcaSupabase } from "@/lib/supabase/server";
import type { ScreenHit, Severity } from "@/lib/untrusted/screen";

export type SecurityKind = "upload" | "reflection_note" | "student_answer" | "generated" | "orca_notes";

export interface SecurityRef {
  runId?: string;
  materialId?: string;
  questionId?: string;
}

/** One event that stands for a whole flagged text: its strongest check, every quote joined (at most 240 characters). */
export function summaryHit(hits: readonly ScreenHit[]): ScreenHit | null {
  if (!hits.length) return null;
  const strong = hits.filter((h) => h.severity === "strong");
  const lead = strong[0] ?? hits[0];
  return { check: lead.check, severity: lead.severity, quote: hits.map((h) => h.quote).join(" | ").slice(0, 240) };
}

/** Record the screen's hits for one piece of untrusted text. Nothing is thrown away quietly: a failure to log throws. */
export async function recordSecurityEvents(db: OrcaSupabase, ownerId: string, kind: SecurityKind, hits: readonly ScreenHit[], ref: SecurityRef = {}): Promise<void> {
  if (!hits.length) return;
  const { error } = await db.from("security_events").insert(
    hits.map((h) => ({
      owner_id: ownerId,
      kind,
      check: h.check,
      severity: h.severity,
      run_id: ref.runId ?? null,
      material_id: ref.materialId ?? null,
      question_id: ref.questionId ?? null,
      quote: h.quote.slice(0, 240),
    })),
  );
  if (error) throw new Error(`Couldn't record the security events: ${error.message}`);
}

/**
 * How many of the student's items of `kind` were flagged since `since`, by severity (the
 * repeat-offender rule counts strong ones). The grader writes one event per flagged answer, so for
 * `student_answer` this counts answers, not phrases.
 */
export async function flaggedCount(db: OrcaSupabase, ownerId: string, kind: SecurityKind, since: Date, severity: Severity = "strong"): Promise<number> {
  const { count, error } = await db.from("security_events").select("id", { count: "exact", head: true }).eq("owner_id", ownerId).eq("kind", kind).eq("severity", severity).gte("at", since.toISOString());
  if (error) throw new Error(`Couldn't count the security events: ${error.message}`);
  return count ?? 0;
}
