import { checkRuns } from "@/lib/server/jobs/start";
import { forStudent, reply } from "@/lib/server/student";

/**
 * POST → check the signed-in student's runs. Called by a page following a run that has been going
 * longer than its job could take: the server marks such runs failed by its own clock ("Orca's job
 * stopped without finishing…"), never on the browser's say-so, and starts their next queued job.
 * 200 { started: runId | null }.
 */
export const runtime = "nodejs";
// With ORCA_JOBS=inline a queued job behind the dead one runs after the response, within this budget.
export const maxDuration = 300;

export async function POST(request: Request) {
  return forStudent(request, async (student, db) => {
    const next = await checkRuns(db, student.id);
    return reply(200, { started: next?.job.runId ?? null });
  });
}
