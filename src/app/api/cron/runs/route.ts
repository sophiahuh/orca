import { timingSafeEqual } from "node:crypto";
import { checkRuns, ownersWithPendingRuns } from "@/lib/server/jobs/start";
import { adminClient } from "@/lib/supabase/server";
import { NO_STORE } from "@/lib/server/student";

/**
 * GET → the scheduled sweep (a Vercel cron job; Vercel sends `Authorization: Bearer $CRON_SECRET`):
 * for every student with a live run, runs past their job's limit are marked failed and the next
 * queued or resumable job starts, as POST /api/runs/check does for one student. Catches dead runs no
 * page is watching. 503 without `CRON_SECRET`, 401 with the wrong one.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

const json = (status: number, body: unknown) => Response.json(body, { status, headers: NO_STORE });

function authorized(header: string | null, secret: string): boolean {
  const given = Buffer.from(header ?? "");
  const wanted = Buffer.from(`Bearer ${secret}`);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return json(503, { error: "CRON_SECRET isn't set, so the sweep is off." });
  if (!authorized(request.headers.get("authorization"), secret)) return json(401, { error: "Not the scheduler." });
  const db = adminClient();
  const owners = await ownersWithPendingRuns(db);
  const failures: string[] = [];
  let started = 0;
  for (const ownerId of owners) {
    try {
      if (await checkRuns(db, ownerId)) started++;
    } catch (e) {
      // One student's trouble doesn't stop the sweep for the rest.
      failures.push(e instanceof Error ? e.message : String(e));
    }
  }
  return json(failures.length ? 500 : 200, { students: owners.length, started, failures });
}
