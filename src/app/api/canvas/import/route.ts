import { z } from "zod";
import { CanvasError } from "@/lib/canvas/client";
import { clientFor, importCanvasCourse } from "@/lib/server/canvas";
import { rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { timezoneOf } from "@/lib/server/usage";
import { forStudent, reply } from "@/lib/server/student";

/**
 * POST { canvasCourseId } → import (or update) one Canvas course: 200 ImportSummary
 * (`src/lib/server/canvas.ts`). Files are pulled until the time budget is used; `files.remaining`
 * says how many are left, and the same request again picks them up. 409 when Canvas isn't
 * connected or refuses the token; 429 past LIMITS.rate.canvasImport.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

const Body = z.object({ canvasCourseId: z.string().regex(/^\d{1,12}$/), fileIds: z.array(z.string().regex(/^\d{1,12}$/)).max(1000).optional() });

export async function POST(request: Request) {
  return forStudent(request, async (student, db) => {
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return reply(400, { error: "Say which Canvas course to import." });
    const client = await clientFor(db, student.id);
    if (!client) return reply(409, { error: "Connect Canvas in Settings first." });
    const rate = await rateLimit(db, student.id, "canvasImport");
    if (!rate.ok) return tooManyRequests(rate);
    try {
      return reply(200, await importCanvasCourse(db, student.id, client, parsed.data.canvasCourseId, { budgetMs: 200_000, timeZone: await timezoneOf(db, student.id), ...(parsed.data.fileIds ? { fileIds: new Set(parsed.data.fileIds) } : {}) }));
    } catch (e) {
      if (e instanceof CanvasError) {
        if (e.status === 401) return reply(409, { error: "Canvas no longer accepts the token. Reconnect in Settings." });
        if (e.status === 403 || e.status === 404) return reply(404, { error: "Canvas wouldn't show that course." });
        return reply(502, { error: e.message });
      }
      throw e;
    }
  });
}
