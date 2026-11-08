import { CanvasError } from "@/lib/canvas/client";
import { clientFor, listCanvasFiles } from "@/lib/server/canvas";
import { rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { forStudent, reply } from "@/lib/server/student";
import { timezoneOf } from "@/lib/server/usage";

/**
 * GET → { files: [{ id, name, module, assigned, type, size, linked }] }: what an import of this Canvas
 * course would pull, in order, for the student to choose from (owner, 2026-11-08). 409 when Canvas
 * isn't connected or refuses the token; 429 past LIMITS.rate.canvasFiles.
 */
export const runtime = "nodejs";

export async function GET(request: Request, context: RouteContext<"/api/canvas/courses/[id]/files">) {
  const { id } = await context.params;
  if (!/^\d{1,12}$/.test(id)) return reply(400, { error: "Say which Canvas course." });
  return forStudent(request, async (student, db) => {
    const rate = await rateLimit(db, student.id, "canvasFiles");
    if (!rate.ok) return tooManyRequests(rate);
    const client = await clientFor(db, student.id);
    if (!client) return reply(409, { error: "Connect Canvas in Settings first." });
    try {
      return reply(200, { files: await listCanvasFiles(db, student.id, client, id, await timezoneOf(db, student.id)) });
    } catch (e) {
      if (e instanceof CanvasError) return reply(e.status === 401 ? 409 : 502, { error: e.status === 401 ? "Canvas no longer accepts the token. Reconnect in Settings." : e.message });
      throw e;
    }
  });
}
