/**
 * Security events (Phase 4 plan, decision 13): every suspected item is logged for the owner,
 * with what, which check and a quoted span of at most 240 characters, never the whole text.
 * Service role only; a run's findings arrive through a trigger on `pipeline_runs.security`, the
 * reflection note's and (integration) the prose answer's through `recordSecurityEvents`.
 */
import type { OrcaSupabase } from "@/lib/supabase/server";
import type { ScreenHit } from "@/lib/untrusted/screen";

export type SecurityKind = "upload" | "reflection_note" | "student_answer" | "generated";

export interface SecurityRef {
  runId?: string;
  materialId?: string;
  questionId?: string;
}

/** Record the screen's hits for one piece of untrusted text. Nothing is thrown away quietly: a failure to log throws. */
export async function recordSecurityEvents(db: OrcaSupabase, ownerId: string, kind: SecurityKind, hits: readonly ScreenHit[], ref: SecurityRef = {}): Promise<void> {
  if (!hits.length) return;
  const { error } = await db.from("security_events").insert(
    hits.map((h) => ({
      owner_id: ownerId,
      kind,
      check: h.check,
      run_id: ref.runId ?? null,
      material_id: ref.materialId ?? null,
      question_id: ref.questionId ?? null,
      quote: h.quote.slice(0, 240),
    })),
  );
  if (error) throw new Error(`Couldn't record the security events: ${error.message}`);
}

/** How many of the student's items of `kind` were flagged since `since` (integration's repeat-offender rule reads this). */
export async function flaggedCount(db: OrcaSupabase, ownerId: string, kind: SecurityKind, since: Date): Promise<number> {
  const { count, error } = await db.from("security_events").select("id", { count: "exact", head: true }).eq("owner_id", ownerId).eq("kind", kind).gte("at", since.toISOString());
  if (error) throw new Error(`Couldn't count the security events: ${error.message}`);
  return count ?? 0;
}
