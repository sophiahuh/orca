/**
 * log_evidence (docs/superpowers/specs/2026-11-10-cram-mode-contracts.md, section 4): a work event
 * (a problem Claude set and judged) or a signal (what the student did) on one objective, recorded
 * against the student's snapshot with source connector. Built in a later step (B3).
 */
import type { EvidenceEntry, LoggedEvidence } from "@/lib/connector/mcp";
import type { OrcaSupabase } from "@/lib/supabase/server";

export const logEvidence: (db: OrcaSupabase, ownerId: string, courseId: string, objectiveId: string, entry: EvidenceEntry, sessionId: string) => Promise<LoggedEvidence | { error: string }> = async () => {
  throw new Error("Not built yet");
};
