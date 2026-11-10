/**
 * material_for (docs/superpowers/specs/2026-11-10-cram-mode-contracts.md, section 4): each
 * objective's anchored pages (pagesFor in src/lib/pipeline/topup.ts, the same materials order), at
 * most 6 per objective, each page's text cut at 2,500 characters, never from a held-back or removed
 * material; heldBack counts the held-back materials skipped. No model calls. Built in a later step.
 */
import type { MaterialFor } from "@/lib/connector/mcp";
import type { OrcaSupabase } from "@/lib/supabase/server";

export const materialFor: (db: OrcaSupabase, ownerId: string, courseId: string, objectiveIds: string[]) => Promise<MaterialFor | null> = async () => {
  throw new Error("Not built yet");
};
