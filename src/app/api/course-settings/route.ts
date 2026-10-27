import { z } from "zod";
import { LIMITS } from "@/lib/limits";
import { CourseScheduleSchema, ReviewConfigSchema } from "@/lib/supabase/app-rows";
import { acceptNotes } from "@/lib/server/notes";
import { forStudent, ownsCourse, reply } from "@/lib/server/student";

export const runtime = "nodejs";

/**
 * Course overrides are intentionally a separate endpoint from account-wide profile defaults. Notes for
 * Orca are screened here (src/lib/server/notes.ts). The schedule (when the class meets, the review
 * weekdays) is course-only; null = not set.
 */
const requestSchema = z.object({
  courseId: z.uuid(),
  reviewConfig: ReviewConfigSchema.nullable(),
  schedule: CourseScheduleSchema.nullable(),
  notes: z.string().max(LIMITS.notesChars).nullable(),
});

export async function PUT(request: Request) {
  return forStudent(request, async (student, db) => {
    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return reply(400, { error: "Those course settings aren't valid (notes are at most 1,000 characters; each class ends after it starts)." });
    if (!(await ownsCourse(db, student.id, parsed.data.courseId))) return reply(404, { error: "No such course." });
    const notes = await acceptNotes(db, student.id, parsed.data.notes);
    if (!notes.ok) return notes.response;
    const { error } = await db
      .from("courses")
      .update({ review_config: parsed.data.reviewConfig, schedule: parsed.data.schedule, orca_notes: notes.text })
      .eq("owner_id", student.id)
      .eq("id", parsed.data.courseId);
    if (error) return reply(500, { error: "Orca couldn't save this course's settings." });
    return reply(200, { reviewConfig: parsed.data.reviewConfig, schedule: parsed.data.schedule, notes: notes.text });
  });
}
