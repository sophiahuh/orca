import { z } from "zod";
import { CanvasError } from "@/lib/canvas/client";
import { connectionStatus, revokeConnection, saveConnection } from "@/lib/server/canvas";
import { rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { forStudent, reply } from "@/lib/server/student";

/**
 * The student's Canvas connection (Settings → Canvas).
 * GET → { connected, baseUrl, canvasUser, lastUsedAt }. POST { baseUrl, token } → 201 { canvasUser }
 * once Canvas has accepted the token (400 for a bad site or token, 502 when Canvas can't be
 * reached). DELETE → { disconnected: true }. The token never comes back out.
 */
export const runtime = "nodejs";

const Body = z.object({ baseUrl: z.string().trim().min(1).max(200), token: z.string().trim().min(1).max(400) });

export async function GET(request: Request) {
  return forStudent(request, async (student, db) => reply(200, await connectionStatus(db, student.id)));
}

export async function POST(request: Request) {
  return forStudent(request, async (student, db) => {
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return reply(400, { error: "Enter the Canvas site and an access token." });
    const rate = await rateLimit(db, student.id, "canvasConnect");
    if (!rate.ok) return tooManyRequests(rate);
    try {
      return reply(201, await saveConnection(db, student.id, parsed.data.baseUrl, parsed.data.token));
    } catch (e) {
      if (e instanceof CanvasError) return reply(e.status === 401 ? 400 : e.status === 400 ? 400 : 502, { error: e.status === 401 ? "Canvas didn't accept that token. Make a new one in Canvas → Account → Settings." : e.message });
      throw e;
    }
  });
}

export async function DELETE(request: Request) {
  return forStudent(request, async (student, db) => {
    await revokeConnection(db, student.id);
    return reply(200, { disconnected: true });
  });
}
