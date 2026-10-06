import { z } from "zod";
import { forStudent, reply } from "@/lib/server/student";
import { adminClient } from "@/lib/supabase/server";

/**
 * POST { courseId } → give up on the student's dives in that course that haven't finished (stuck:
 * e.g. the server restarted mid-job). They're marked failed, so a new dive can start. Only the
 * student's own deep-review runs still queued, waiting or running are touched. 200 { cancelled }.
 */
export const runtime = "nodejs";

const Body = z.object({ courseId: z.uuid() });

export async function POST(request: Request) {
  return forStudent(request, async (student) => {
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return reply(400, { error: "Send the course." });
    // Runs are the server's to write (students can read them, not change them).
    const { data, error } = await adminClient()
      .from("pipeline_runs")
      .update({ status: "failed", error: "Cancelled while it was being prepared.", progress: null })
      .eq("owner_id", student.id)
      .eq("course_id", parsed.data.courseId)
      .eq("kind", "deep-review")
      .in("status", ["queued", "waiting", "running"])
      .select("id");
    if (error) throw new Error(`Couldn't cancel the dive: ${error.message}`);
    return reply(200, { cancelled: data.length });
  });
}
