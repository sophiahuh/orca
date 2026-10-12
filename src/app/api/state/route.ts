import { z } from "zod";
import { RULES_VERSION } from "@/lib/mastery/objective-state";
import { readCourseState } from "@/lib/mastery/snapshots";
import { supabaseSnapshotStore } from "@/lib/server/snapshot-store";
import { forStudent, ownsCourse, reply } from "@/lib/server/student";

/**
 * GET ?course=<id> → the signed-in student's snapshots for that course:
 * { rulesVersion, objectives: [{ objectiveId, accumulator, version, saved }], rebuilt: [objectiveId] }.
 * Stale and old-rules snapshots are rebuilt from the evidence log and saved; fresh ones are returned
 * as stored (reads never replay otherwise). An objective with no snapshot has no evidence: unseen.
 */
export const runtime = "nodejs";

export async function GET(request: Request) {
  return forStudent(request, async (student, db) => {
    const course = z.uuid().safeParse(new URL(request.url).searchParams.get("course"));
    if (!course.success) return reply(400, { error: "Name the course: ?course=<id>." });
    if (!(await ownsCourse(db, student.id, course.data))) return reply(404, { error: "No such course." });
    const state = await readCourseState(supabaseSnapshotStore(db, student.id, course.data));
    return reply(200, { rulesVersion: RULES_VERSION, ...state });
  });
}
