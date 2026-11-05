import { z } from "zod";
import { startFlagTopUpJob, startTopUpJob } from "@/lib/server/jobs/start";
import { rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { forStudent, reply } from "@/lib/server/student";

/**
 * POST { courseId, sessionId, objectiveIds } → top up the question stock after a finished session
 * (docs/MASTERY-PLAN.md §4). The session must be the student's, in that course; objectives not in
 * the course are ignored. 404 no such session.
 *
 * POST { courseId, objectiveIds } (no session) → questions for struggle flags (weak points first):
 * only objectives with a flag in the course are kept; 200 { state: "nothing" } when none is.
 *
 * Either way: 202 { state: "started" | "queued", runId }: follow the run. 200 { state: "busy", runId? }:
 * a top-up for this course is already in flight (follow it: it catches up flagged objectives without
 * questions, and queues one more for flags that arrive while it runs). 200 { state: "no-model" }: the
 * server has no model key. 429 past `LIMITS.rate.topUp` (each call is a run row and a job).
 */
export const runtime = "nodejs";
// With ORCA_JOBS=inline the job runs after the response, within this budget.
export const maxDuration = 300;

const Body = z.object({ courseId: z.uuid(), sessionId: z.string().min(1).max(100).optional(), objectiveIds: z.array(z.uuid()).max(200) });

export async function POST(request: Request) {
  return forStudent(request, async (student, db) => {
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return reply(400, { error: "Send the course, the session and its objectives." });
    const { courseId, sessionId } = parsed.data;
    let objectiveIds = parsed.data.objectiveIds;
    if (sessionId === undefined) {
      // Questions only for flagged objectives: a client can't ask for anything else this way.
      const { data, error } = await db.from("evidence_events").select("objective_id").eq("owner_id", student.id).eq("course_id", courseId).eq("kind", "confusion").in("objective_id", objectiveIds.length ? objectiveIds : ["00000000-0000-0000-0000-000000000000"]);
      if (error) throw new Error(`Couldn't read the struggle flags: ${error.message}`);
      const flagged = new Set(data.map((r) => r.objective_id));
      objectiveIds = objectiveIds.filter((id) => flagged.has(id));
      if (!objectiveIds.length) return reply(200, { state: "nothing" });
    }
    const rate = await rateLimit(db, student.id, "topUp");
    if (!rate.ok) return tooManyRequests(rate);
    const out = sessionId === undefined ? await startFlagTopUpJob(db, student.id, { courseId, objectiveIds }) : await startTopUpJob(db, student.id, { courseId, sessionId, objectiveIds });
    if (out.state === "no-session") return reply(404, { error: "No such finished session." });
    return reply(out.state === "started" ? 202 : 200, out);
  });
}
