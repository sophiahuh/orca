/**
 * add_questions (docs/superpowers/specs/2026-11-10-cram-mode-contracts.md, section 4): questions
 * Claude wrote, validated like generated questions (GeneratedQuestion in src/lib/pipeline/schemas.ts,
 * isExpressionAnswer, the math render check, the sanitiser), stored with source claude, tier null,
 * and materialId from anchor.materialId when given and live. Built in a later step.
 */
import type { AddQuestion, AddQuestionsResult } from "@/lib/connector/mcp";
import type { OrcaSupabase } from "@/lib/supabase/server";

export const addQuestions: (db: OrcaSupabase, ownerId: string, courseId: string, questions: AddQuestion[]) => Promise<AddQuestionsResult | { error: string }> = async () => {
  throw new Error("Not built yet");
};
