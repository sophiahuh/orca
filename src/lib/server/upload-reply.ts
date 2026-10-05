/**
 * The upload routes' answer: the outcome of storing or reading the file, plus what happens to its
 * questions (`generation`) when the course now has the file read: a job starts building them (or
 * is already), they were built before, or nothing is generated (no model key, no text).
 */
import type { OrcaSupabase } from "@/lib/supabase/server";
import { startUploadJob } from "./jobs/start";
import type { Outcome } from "./materials";
import { reply } from "./student";

export async function uploadReply(db: OrcaSupabase, ownerId: string, outcome: Outcome): Promise<Response> {
  const { status, body } = outcome;
  if (status !== 200) return reply(status, body);
  const materialId = "duplicate" in body ? body.duplicate.id : "pages" in body ? body.material.id : null;
  if (!materialId) return reply(status, body);
  return reply(status, { ...body, generation: await startUploadJob(db, ownerId, materialId) });
}
