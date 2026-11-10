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
    // A top-up of the course already in flight writes for these too (every top-up catches up flagged
    // objectives without questions, and queues a follow-up for flags that arrive while it runs), so
    // don't spend a rate-limit hit on a second request (the browser and the server both ask, 2026-11-10).
    const live = await db.from("pipeline_runs").select("id").eq("owner_id", ownerId).eq("course_id", courseId).eq("kind", "top-up").in("status", ["queued", "waiting", "running"]).limit(1);
    if (live.error) throw new Error(live.error.message);
    if (live.data.length) return "busy";
    if (!(await rateLimit(db, ownerId, "topUp")).ok) return "rate-limited";
    return (await startFlagTopUpJob(db, ownerId, { courseId, objectiveIds: [...missing] })).state;
  } catch (e) {
    console.error(`Couldn't start a top-up after a flag: ${e instanceof Error ? e.message : String(e)}`);
    return "error";
  }
}

/**
 * The daily sweep's half of the promise (owner, 2026-11-10: "it knows my weak spots; I want a quick
 * review"): every flagged objective ends up with questions without the student asking. For every
 * student and course with a struggle flag in the last 90 days, ask for a top-up for the flagged
 * objectives that still have none; courses with no readable material are skipped (nothing to write
 * from) and courses deleted are left alone. Returns what it asked for; never throws for one student.
 */
export async function catchUpFlags(db: OrcaSupabase, now = new Date()): Promise<{ courses: number; started: number; failures: string[] }> {
  const since = new Date(now.getTime() - 90 * 86_400_000).toISOString();
  const { data: flags, error } = await db.from("evidence_events").select("owner_id, course_id, objective_id").eq("kind", "confusion").gte("at", since);
  if (error) throw new Error(`Couldn't read the flags: ${error.message}`);
  const byCourse = new Map<string, { ownerId: string; courseId: string; objectiveIds: Set<string> }>();
  for (const f of flags) {
    const key = `${f.owner_id}:${f.course_id}`;
    const entry = byCourse.get(key) ?? { ownerId: f.owner_id, courseId: f.course_id, objectiveIds: new Set<string>() };
    entry.objectiveIds.add(f.objective_id);
    byCourse.set(key, entry);
  }
  let started = 0;
  const failures: string[] = [];
  for (const { ownerId, courseId, objectiveIds } of byCourse.values()) {
    try {
      const [course, material] = await Promise.all([
        db.from("courses").select("id").eq("owner_id", ownerId).eq("id", courseId).is("deleted_at", null).maybeSingle(),
        db.from("materials").select("id").eq("owner_id", ownerId).eq("course_id", courseId).eq("status", "ready").limit(1),
      ]);
      if (course.error || material.error) throw new Error((course.error ?? material.error)!.message);
      if (!course.data || !material.data.length) continue;
      const state = await topUpAfterFlag(db, ownerId, courseId, [...objectiveIds]);
      if (state === "started" || state === "queued") started++;
    } catch (e) {
      failures.push(`${courseId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { courses: byCourse.size, started, failures };
}
