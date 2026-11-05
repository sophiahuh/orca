import type { TopUpStart } from "@/lib/jobs/start";
import { startFlagTopUpJob } from "@/lib/server/jobs/start";
import { rateLimit } from "@/lib/server/rate-limit";
import type { OrcaSupabase } from "@/lib/supabase/server";

export type FlagTopUpState = TopUpStart["state"] | "has-questions" | "rate-limited" | "error";

/**
 * After a batch of struggle flags recorded on the server (the connector's flag_check): questions for
 * the flagged objectives that have none (`objectiveIds` are live objectives, merges already followed).
 * Best effort: the flags are recorded, and every later top-up also writes for flagged objectives
 * without questions (src/lib/jobs/jobs.ts), so a skip here is caught up. Never throws.
 */
export async function topUpAfterFlag(db: OrcaSupabase, ownerId: string, courseId: string, objectiveIds: readonly string[]): Promise<FlagTopUpState> {
  try {
    if (!objectiveIds.length) return "has-questions";
    const [objectives, questions] = await Promise.all([
      db.from("objectives").select("id, merged_into").eq("owner_id", ownerId).eq("course_id", courseId),
      db.from("questions").select("objective_id").eq("owner_id", ownerId).eq("course_id", courseId).eq("deep", false),
    ]);
    if (objectives.error || questions.error) throw new Error((objectives.error ?? questions.error)!.message);
    const mergedInto = new Map(objectives.data.map((o) => [o.id, o.merged_into]));
    const survivor = (id: string) => {
      let current = id;
      for (let i = 0; mergedInto.get(current) && i < 50; i++) current = mergedInto.get(current)!;
      return current;
    };
    const asked = new Set(questions.data.flatMap((q) => (q.objective_id ? [survivor(q.objective_id)] : [])));
    const missing = objectiveIds.filter((id) => !asked.has(id));
    if (!missing.length) return "has-questions";
    if (!(await rateLimit(db, ownerId, "topUp")).ok) return "rate-limited";
    return (await startFlagTopUpJob(db, ownerId, { courseId, objectiveIds: [...missing] })).state;
  } catch (e) {
    console.error(`Couldn't start a top-up after a flag: ${e instanceof Error ? e.message : String(e)}`);
    return "error";
  }
}
