import { z } from "zod";
import { startTopUpJob } from "@/lib/server/jobs/start";
import { rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { forStudent, reply } from "@/lib/server/student";

/**
 * POST { courseId, sessionId, objectiveIds } → top up the question stock after a finished session
 * (docs/MASTERY-PLAN.md §4). The session must be the student's, in that course; objectives not in
 * the course are ignored. 202 { state: "started", runId }: follow the run. 200 { state: "busy" }: a
 * top-up for this course is already running. 200 { state: "no-model" }: the server has no model
 * key. 404 no such session. 429 past `LIMITS.rate.topUp` (each call is a run row and a job).
 */
export const runtime = "nodejs";
// With ORCA_JOBS=inline the job runs after the response, within this budget.
export const maxDuration = 300;

const Body = z.object({ courseId: z.uuid(), sessionId: z.string().min(1).max(100), objectiveIds: z.array(z.uuid()).max(200) });

export async function POST(request: Request) {
  return forStudent(request, async (student, db) => {
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return reply(400, { error: "Send the course, the session and its objectives." });
    const rate = await rateLimit(db, student.id, "topUp");
    if (!rate.ok) return tooManyRequests(rate);
    const out = await startTopUpJob(db, student.id, parsed.data);
    if (out.state === "no-session") return reply(404, { error: "No such finished session." });
    return reply(out.state === "started" ? 202 : 200, out);
  });
}
