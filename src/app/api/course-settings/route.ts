import { z } from "zod";
import { ReviewConfigSchema, WeightsSchema } from "@/lib/supabase/app-rows";
import { forStudent, ownsCourse, reply } from "@/lib/server/student";

export const runtime = "nodejs";

/** Course overrides are intentionally a separate endpoint from account-wide profile defaults. */
const requestSchema = z.object({
  courseId: z.uuid(),
  reviewConfig: ReviewConfigSchema.nullable(),
  weights: WeightsSchema.nullable(),
});

export async function PUT(request: Request) {
  return forStudent(request, async (student, db) => {
    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return reply(400, { error: "Those course settings aren't valid." });
    if (!(await ownsCourse(db, student.id, parsed.data.courseId))) return reply(404, { error: "No such course." });
    const { error } = await db
      .from("courses")
      .update({ review_config: parsed.data.reviewConfig, weights: parsed.data.weights })
      .eq("owner_id", student.id)
      .eq("id", parsed.data.courseId);
    if (error) return reply(500, { error: "Orca couldn't save this course's settings." });
    return reply(200, { reviewConfig: parsed.data.reviewConfig, weights: parsed.data.weights });
  });
}
