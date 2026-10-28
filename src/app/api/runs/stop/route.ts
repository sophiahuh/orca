import { z } from "zod";
import { stopRun } from "@/lib/server/jobs/start";
import { forStudent, reply } from "@/lib/server/student";

/**
 * POST { runId } → stop the signed-in student's upload run now (queued, waiting, paused or
 * running): it is marked failed ("Stopped by you…"), the file is kept so uploading it again
 * retries, and their next queued job starts after the response. 200 { stopped: boolean }
 * (false: not theirs, not an upload, or already finished).
 */
export const runtime = "nodejs";
// With ORCA_JOBS=inline the next queued job runs after the response, within this budget.
export const maxDuration = 300;

const Body = z.object({ runId: z.uuid() });

export async function POST(request: Request) {
  return forStudent(request, async (student, db) => {
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return reply(400, { error: "Say which upload (runId) to stop." });
    return reply(200, { stopped: await stopRun(db, student.id, parsed.data.runId) });
  });
}
