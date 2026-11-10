/**
 * add_material (docs/superpowers/specs/2026-11-10-cram-mode-contracts.md, section 4): with text,
 * the text route's result ({ material } or { duplicate }); with file true and no text, an absolute
 * link (SITE_URL) to /add-material?course=<slug>&type=<type>&holdBack=1. Built in a later step.
 */
import type { AddMaterialInput, AddMaterialResult } from "@/lib/connector/mcp";
import type { OrcaSupabase } from "@/lib/supabase/server";

export const addMaterial: (db: OrcaSupabase, ownerId: string, courseId: string, input: AddMaterialInput) => Promise<AddMaterialResult | { error: string }> = async () => {
  throw new Error("Not built yet");
};
