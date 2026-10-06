/**
 * Grading one prose answer on the server (Phase 4, Task 8). The question and its rubric come from
 * the student's own rows, by question id; the request brings only the id and the answer. Orca's
 * key only, as a `grade` call for this student, metered in `model_usage` (decision 10). Without a
 * key the answer is 503 and the quiz lets the student mark it themselves; a grading failure records
 * nothing (the browser only records evidence after a reply).
 *
 * Decision 13, wired in integration: the answer is screened before the call; a hit is logged to
 * `security_events` (kind student_answer) and the answer still goes to the model as a data block.
 * A student whose answers were flagged `REPEAT_OFFENDER.flags` times in the last
 * `REPEAT_OFFENDER.days` days has model grading turned off (403 `graded: "self"`) until the owner
 * clears the events; `/api/llm/status` says so, and the quiz self-marks.
 * Decision 10: at most `LIMITS.rate.grade` answers a minute per student (429), and the student's
 * and Orca's daily budgets apply (429).
 */
import type { AnswerRubric } from "@/lib/data";
import { GRADE_SYSTEM, GradeSchema, type GradeResult, RubricSchema, cleanAnswer, gradePrompt, parseGradeLoose, validateGrade } from "@/lib/grading";
import { LlmError, completeJson } from "@/lib/llm-server";
import { meter, orcaConfig } from "@/lib/server/model";
import { rateLimit } from "@/lib/server/rate-limit";
import { flaggedCount, recordSecurityEvents } from "@/lib/server/security";
import { checkBudget } from "@/lib/server/usage";
import { screen } from "@/lib/untrusted/screen";
import type { OrcaSupabase } from "@/lib/supabase/server";

export interface GradeReply {
  status: number;
  body: GradeResult | { error: string; graded?: "self"; retryAfterSeconds?: number };
}

export const NO_MODEL_FOR_GRADING = "No AI is connected, so Orca can't grade this answer. Compare it with the key and mark it yourself.";
export const GRADING_OFF_MESSAGE = "Model grading is turned off for your account because several answers looked like instructions to the grader. Mark your answers yourself for now; Orca's owner has been notified.";

/** How many flagged prose answers in how many days turn model grading off for a student (integration, 2026-10-06; for TO-DISCUSS). */
export const REPEAT_OFFENDER = { flags: 3, days: 7 } as const;

/** Whether this student's prose answers are graded by the model ("model") or self-marked ("self") right now. */
export async function gradingMode(db: OrcaSupabase, ownerId: string, now = new Date()): Promise<"model" | "self"> {
  if (!orcaConfig()) return "self";
  const since = new Date(now.getTime() - REPEAT_OFFENDER.days * 86_400_000);
  return (await flaggedCount(db, ownerId, "student_answer", since)) >= REPEAT_OFFENDER.flags ? "self" : "model";
}

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
  if (!config) return { status: 503, body: { error: NO_MODEL_FOR_GRADING, graded: "self" } };

  // Decision 10: the rate limit, then the budgets, before anything is spent.
  const rate = await rateLimit(db, ownerId, "grade");
  if (!rate.ok) return { status: 429, body: { error: rate.message, retryAfterSeconds: rate.retryAfterSeconds } };
  const budget = await checkBudget(db, ownerId, 0);
  if (!budget.ok) return { status: 429, body: { error: `${budget.message} Mark this answer yourself for now.` } };

  // Decision 13: screen the answer and log a hit; a repeat offender's grading is off.
  if ((await gradingMode(db, ownerId)) === "self") return { status: 403, body: { error: GRADING_OFF_MESSAGE, graded: "self" } };
  const suspected = screen(answer);
  if (suspected.suspected) await recordSecurityEvents(db, ownerId, "student_answer", suspected.hits, { questionId });

  try {
    const result = await completeJson(config, GRADE_SYSTEM, gradePrompt(q.prompt, rubric.data as AnswerRubric, answer), GradeSchema, parseGradeLoose, {
      effort: "low",
      maxTokens: 1024,
      ctx: { ownerId, kind: "grade" },
      onUsage: meter({ ownerId, kind: "grade" }, db),
    });
    return { status: 200, body: validateGrade(result, rubric.data as AnswerRubric) };
  } catch (e) {
    if (e instanceof LlmError) return { status: e.status >= 500 ? 502 : e.status, body: { error: e.message } };
    throw e;
  }
}
