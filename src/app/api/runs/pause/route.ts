import { z } from "zod";
import { pauseRuns } from "@/lib/server/jobs/start";
import { forStudent, reply } from "@/lib/server/student";

/**
 * POST { runId | courseId, paused } → pause the signed-in student's queued uploads (one run, or
 * every queued upload of a course), or resume paused ones. A paused upload leaves the queue
 * (nothing waits behind it); resuming puts it back in line by its upload time and, if nothing of
 * the student's is running, starts the next job after the response. 200 { changed: n }.
 */
export const runtime = "nodejs";
// With ORCA_JOBS=inline a resumed job runs after the response, within this budget.
export const maxDuration = 300;

const Body = z.union([z.object({ runId: z.uuid(), paused: z.boolean() }), z.object({ courseId: z.uuid(), paused: z.boolean() })]);

export async function POST(request: Request) {
  return forStudent(request, async (student, db) => {
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return reply(400, { error: "Say which upload (runId) or course (courseId) to pause or resume." });
    const { paused, ...target } = parsed.data;
    const changed = await pauseRuns(db, student.id, target, paused);
    return reply(200, { changed });
  });
}
