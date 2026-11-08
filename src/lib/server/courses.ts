/**
 * Deleting a course (2026-11-08): a soft delete. The row and everything under it stay, stamped
 * with `courses.deleted_at`; `my_data`, `course_structure` and every server lookup of a course
 * leave it out from then on, and its slug is free for a new course. Its unfinished jobs stop.
 */
import type { OrcaSupabase } from "@/lib/supabase/server";
import { stopCourseRuns } from "./jobs/start";

export type DeleteCourse = { status: 200; body: { deleted: true; stoppedRuns: number } } | { status: 404; body: { error: string } };

export async function deleteCourse(db: OrcaSupabase, ownerId: string, courseId: string, now: () => Date = () => new Date()): Promise<DeleteCourse> {
  const { data, error } = await db
    .from("courses")
    .update({ deleted_at: now().toISOString() })
    .eq("owner_id", ownerId)
    .eq("id", courseId)
    .is("deleted_at", null)
    .select("id");
  if (error) throw new Error(`Couldn't delete the course: ${error.message}`);
  if (!data.length) return { status: 404, body: { error: "No such course." } };
  const stoppedRuns = await stopCourseRuns(db, ownerId, courseId);
  return { status: 200, body: { deleted: true, stoppedRuns } };
}
