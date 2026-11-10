/**
 * add_questions (docs/superpowers/specs/2026-11-10-cram-mode-contracts.md, section 4): questions
 * Claude wrote, validated like generated questions (`checkQuestion` in src/lib/connector/
 * question-check.ts: GeneratedQuestion's shape and the pipeline's structural rules, isExpressionAnswer,
 * the math render check, the sanitiser), stored with source claude, tier null, under the objective's current topic after the
 * topic's last question, and materialId from anchor.materialId when given and live. Saved the way a
 * job saves its questions: the course loaded through the job store, the new questions appended to
 * the bank, and `structureRows` + `save_structure` writing only the rows that are new.
 */
import type { AddQuestion, AddQuestionsResult } from "@/lib/connector/mcp";
import { type AnchorFacts, checkQuestion } from "@/lib/connector/question-check";
import type { QuizQuestion } from "@/lib/data";
import { LIMITS } from "@/lib/limits";
import { materialFacts } from "@/lib/pipeline/run";
import { supabaseJobStore } from "@/lib/server/job-store";
import { structureRows } from "@/lib/supabase/app-rows";
import type { OrcaSupabase } from "@/lib/supabase/server";

export async function addQuestions(db: OrcaSupabase, ownerId: string, courseId: string, questions: AddQuestion[]): Promise<AddQuestionsResult | { error: string }> {
  const store = supabaseJobStore(db, ownerId);
  const loaded = await store.course(courseId);
  if (!loaded) return { error: "No such course." };
  const before = loaded.structure;

  // The course's live materials, and which are held back (a question from one would leak a practice test).
  const { data: materials, error } = await db.from("materials").select("id, held_back").eq("owner_id", ownerId).eq("course_id", courseId).eq("status", "ready");
  if (error) throw new Error(`Couldn't read the materials: ${error.message}`);
  const heldBack = new Set((materials ?? []).filter((m) => m.held_back).map((m) => m.id));
  const live = new Set((materials ?? []).filter((m) => !m.held_back).map((m) => m.id));
  // What the checks know about each live material an anchor names: its pages and the URLs in them.
  const facts = new Map<string, AnchorFacts>();
  await Promise.all(
    [...new Set(questions.flatMap((q) => (q.anchor?.materialId && live.has(q.anchor.materialId) ? [q.anchor.materialId] : [])))].map(async (materialId) => {
      const { data, error: pagesError } = await db.from("material_pages").select("n, text").eq("owner_id", ownerId).eq("material_id", materialId).order("n").limit(LIMITS.pagesPerFile);
      if (pagesError) throw new Error(`Couldn't read the material's pages: ${pagesError.message}`);
      facts.set(materialId, materialFacts(data));
    }),
  );

  const bank = Object.fromEntries(Object.entries(before.bank).map(([topicId, qs]) => [topicId, [...qs]]));
  const added: AddQuestionsResult["added"] = [];
  const refused: AddQuestionsResult["refused"] = [];
  for (const [index, q] of questions.entries()) {
    const objective = before.objectives[q.objectiveId];
    if (!objective || objective.review === "archived" || objective.mergedInto) {
      refused.push({ index, reason: "objectiveId isn't a live objective of this course; use an id from course_state" });
      continue;
    }
    // Objectives are filed under their current topic (src/lib/server/job-store.ts), so this is the question's topic.
    const topic = loaded.course.topics.find((t) => t.id === objective.topicId);
    if (!topic || topic.review === "archived") {
      refused.push({ index, reason: "that objective's topic is no longer in the course" });
      continue;
    }
    const anchored = q.anchor?.materialId;
    if (anchored && heldBack.has(anchored)) {
      refused.push({ index, reason: "its anchor names a held-back material (kept for a practice test); write from material_for's pieces instead" });
      continue;
    }
    const materialId = anchored && live.has(anchored) ? anchored : undefined;
    const checked = checkQuestion(q, materialId ? (facts.get(materialId) ?? null) : null, objective.origin === "inferred");
    if (!checked.ok) {
      refused.push({ index, reason: checked.reason });
      continue;
    }
    const question: QuizQuestion = { id: crypto.randomUUID(), ...checked.question, topic: topic.name, ...(materialId ? { materialId } : {}) };
    bank[topic.id] = [...(bank[topic.id] ?? []), question];
    added.push({ id: question.id, objectiveId: question.objectiveId });
  }
  if (added.length) await store.save(courseId, structureRows(before, { ...before, bank }));
  return { added, refused };
}
