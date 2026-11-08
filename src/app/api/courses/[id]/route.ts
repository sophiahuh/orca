import { z } from "zod";
import { deleteCourse } from "@/lib/server/courses";
import { forStudent, reply } from "@/lib/server/student";

/**
 * DELETE → soft-delete the signed-in student's course (`deleteCourse`): it is stamped
 * `deleted_at` and drops out of everything they see, and its unfinished jobs stop.
 * 200 { deleted: true, stoppedRuns }, or 404 (not theirs, already deleted, or not an id).
 */
export const runtime = "nodejs";
// With ORCA_JOBS=inline the student's next queued job runs after the response, within this budget.
export const maxDuration = 300;

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forStudent(request, async (student, db) => {
    if (!z.uuid().safeParse(id).success) return reply(404, { error: "No such course." });
    const out = await deleteCourse(db, student.id, id);
    return reply(out.status, out.body);
  });
}
