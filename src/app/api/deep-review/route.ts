import { z } from "zod";
import { DEEP_MAX_MINUTES } from "@/lib/deep-review";
import { startDeepReviewJob } from "@/lib/server/jobs/start";
import { forStudent, reply } from "@/lib/server/student";

/**
 * POST { courseId, minutes, objectiveIds } → persist and start a deep-review job. Its targets and
 * duration live on the run, so a reload or navigation can't discard the generation. The browser
 * follows the run by id and opens its saved questions when it finishes.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

const Body = z.object({ courseId: z.uuid(), minutes: z.number().int().min(1).max(DEEP_MAX_MINUTES), objectiveIds: z.array(z.uuid()).min(1).max(400) });

export async function POST(request: Request) {
  return forStudent(request, async (student, db) => {
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return reply(400, { error: "Send the course, the length and the objectives to cover." });
    // No per-hour limit on dives (owner, 2026-10-06); the daily budgets still hold each job.
    const out = await startDeepReviewJob(db, student.id, parsed.data);
    if (out.state === "no-model") return reply(503, { error: "No AI is connected, so Orca can't prepare your dive in." });
    if (out.state === "no-course") return reply(404, { error: "No such course." });
    return reply(out.state === "started" ? 202 : 200, out);
  });
}
