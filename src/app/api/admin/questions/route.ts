import { forAdmin } from "@/lib/server/admin";
import { FEEDBACK_REASONS, feedback, feedbackCounts } from "@/lib/server/admin-queries";
import { reply } from "@/lib/server/student";

/** GET ?reason=…&offset=n → every thumbs down with its question, newest first, and the counts per course. Admins only. */
export const runtime = "nodejs";

export async function GET(request: Request) {
  return forAdmin(request, async (_admin, db) => {
    const q = new URL(request.url).searchParams;
    const reason = q.get("reason");
    const offset = Number(q.get("offset") ?? 0);
    const [downs, counts] = await Promise.all([
      feedback(db, { reason: reason && (FEEDBACK_REASONS as readonly string[]).includes(reason) ? reason : undefined, offset: Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0 }),
      feedbackCounts(db),
    ]);
    return reply(200, { downs, counts });
  });
}
