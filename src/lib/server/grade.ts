/**
 * Grading one prose answer on the server (Phase 4, Task 8). The question and its rubric come from
 * the student's own rows, by question id; the request brings only the id and the answer. Orca's
 * key only, as a `grade` call for this student (metering, decision 10). Without a key the answer
 * is 503 and the quiz lets the student mark it themselves; a grading failure records nothing
 * (the browser only records evidence after a reply).
 *
 * Integration adds, in this order, before the model call: the rate limit (7c,
 * `src/lib/server/rate-limit.ts`) and the injection screen with its `security_events` row and the
 * repeat-offender switch (7b, `src/lib/untrusted/screen.ts`).
 */
import type { AnswerRubric } from "@/lib/data";
import { GRADE_SYSTEM, GradeSchema, type GradeResult, RubricSchema, cleanAnswer, gradePrompt, parseGradeLoose, validateGrade } from "@/lib/grading";
import { LlmError, completeJson } from "@/lib/llm-server";
import { orcaConfig } from "@/lib/server/model";
import type { OrcaSupabase } from "@/lib/supabase/server";

export interface GradeReply {
  status: number;
  body: GradeResult | { error: string };
}

export const NO_MODEL_FOR_GRADING = "No AI is connected, so Orca can't grade this answer. Compare it with the key and mark it yourself.";

export async function gradeAnswer(db: OrcaSupabase, ownerId: string, questionId: string, response: string): Promise<GradeReply> {
  const answer = cleanAnswer(response);
  if (!answer) return { status: 400, body: { error: "Type an answer first." } };
  const { data: q, error } = await db.from("questions").select("id, kind, prompt, rubric, exact").eq("owner_id", ownerId).eq("id", questionId).maybeSingle();
  if (error) throw new Error(`Couldn't read the question: ${error.message}`);
  if (!q) return { status: 404, body: { error: "No such question." } };
  if (q.kind !== "Short answer" || q.exact?.length || !q.rubric) {
    return { status: 400, body: { error: "This question isn't graded by a model: its answer is checked in the quiz itself." } };
  }
  const rubric = RubricSchema.safeParse(q.rubric);
  if (!rubric.success) return { status: 422, body: { error: "This question's rubric can't be read, so Orca can't grade it. Mark it yourself." } };
  const config = orcaConfig();
  if (!config) return { status: 503, body: { error: NO_MODEL_FOR_GRADING } };
  try {
    const result = await completeJson(config, GRADE_SYSTEM, gradePrompt(q.prompt, rubric.data as AnswerRubric, answer), GradeSchema, parseGradeLoose, {
      effort: "low",
      maxTokens: 1024,
      ctx: { ownerId, kind: "grade" },
    });
    return { status: 200, body: validateGrade(result, rubric.data as AnswerRubric) };
  } catch (e) {
    if (e instanceof LlmError) return { status: e.status >= 500 ? 502 : e.status, body: { error: e.message } };
    throw e;
  }
}
