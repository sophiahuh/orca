import { CanvasError } from "@/lib/canvas/client";
import { clientFor, listCanvasCourses } from "@/lib/server/canvas";
import { forStudent, reply } from "@/lib/server/student";

/** GET → { courses: [{ id, name, code, term, linkedCourseId }] }: the student's active Canvas courses. 409 when Canvas isn't connected. */
export const runtime = "nodejs";

export async function GET(request: Request) {
  return forStudent(request, async (student, db) => {
    const client = await clientFor(db, student.id);
    if (!client) return reply(409, { error: "Connect Canvas in Settings first." });
    try {
      return reply(200, { courses: await listCanvasCourses(db, student.id, client) });
    } catch (e) {
      if (e instanceof CanvasError) return reply(e.status === 401 ? 409 : 502, { error: e.status === 401 ? "Canvas no longer accepts the token. Reconnect in Settings." : e.message });
      throw e;
    }
  });
}
