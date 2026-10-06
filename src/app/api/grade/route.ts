import { z } from "zod";
import { ANSWER_MAX_CHARS } from "@/lib/grading";
import { gradeAnswer } from "@/lib/server/grade";
import { forStudent, reply } from "@/lib/server/student";

/**
 * POST { questionId, response } → GradeResult, for a signed-in student's own prose question, graded
 * with Orca's key against the rubric stored with the question (`src/lib/server/grade.ts`).
 * 401 signed out; 400 if the body carries a question, rubric or model of its own (the request
 * decides nothing about how it's graded), or isn't an id and an answer; 404 not the student's
 * question; 503 when the server has no model key (the quiz then lets the student self-mark); 429 past
 * the rate limit (retry-after) or a daily budget; 403 { graded: "self" } when model grading is turned
 * off for the student (repeat flagged answers). Integration (decision 13 and 10) lives in grade.ts.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({ questionId: z.uuid(), response: z.string().min(1).max(ANSWER_MAX_CHARS * 5) }).strict();
const NOT_YOURS_TO_SEND = ["question", "rubric", "llm", "model", "apiKey", "provider"];

export async function POST(request: Request) {
  return forStudent(request, async (student, db) => {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return reply(400, { error: "Send the question id and your answer as JSON." });
    }
    if (raw && typeof raw === "object" && NOT_YOURS_TO_SEND.some((k) => k in raw)) {
      return reply(400, { error: "The grader takes a question id and your answer only; the question, its rubric and the model come from Orca." });
    }
    const parsed = Body.safeParse(raw);
    if (!parsed.success) return reply(400, { error: "Send { questionId, response }: a question id and an answer." });
    const out = await gradeAnswer(db, student.id, parsed.data.questionId, parsed.data.response);
    const retryAfter = "retryAfterSeconds" in out.body ? out.body.retryAfterSeconds : undefined;
    return retryAfter ? Response.json(out.body, { status: out.status, headers: { "cache-control": "no-store", "retry-after": String(retryAfter) } }) : reply(out.status, out.body);
  });
}
