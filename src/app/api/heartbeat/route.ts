import { rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { forStudent, reply } from "@/lib/server/student";

/**
 * POST → 204: the browser's "still here", sent at most once every 5 minutes while a signed-in tab
 * is open (src/components/layout/Heartbeat.tsx). Sets `profiles.last_active_at` for the verified
 * user, which the admin view shows as "last active". Nothing waits on it; a 429 is harmless.
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  return forStudent(request, async (student, db) => {
    const verdict = await rateLimit(db, student.id, "heartbeat");
    if (!verdict.ok) return tooManyRequests(verdict);
    const { error } = await db.from("profiles").update({ last_active_at: new Date().toISOString() }).eq("owner_id", student.id);
    if (error) return reply(500, { error: "Orca couldn't record the heartbeat." });
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  });
}
