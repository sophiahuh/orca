import { z } from "zod";
import { linkTopics } from "@/lib/pipeline/link";
import { supabaseJobStore } from "@/lib/server/job-store";
import { StepError, stepCaller } from "@/lib/server/model";
import { rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { forStudent, reply } from "@/lib/server/student";
import { checkBudget } from "@/lib/server/usage";
import { structureRows } from "@/lib/supabase/app-rows";
import { adminClient } from "@/lib/supabase/server";

/**
 * POST { courseId } → "Find connections" on the Concept Atlas: the link step over every live topic
 * of the course (owner, 2026-10-06), adding the links it finds that the course doesn't have.
 * 200 { added }. 503 no model key, 404 not the student's course, 429 past the rate limit or a
 * daily budget. One short call over names and summaries, so it runs in the request.
 */
export const runtime = "nodejs";
export const maxDuration = 120;

const Body = z.object({ courseId: z.uuid() });

export async function POST(request: Request) {
  return forStudent(request, async (student, db) => {
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return reply(400, { error: "Send the course." });
    const call = stepCaller({ ownerId: student.id, kind: "relink" }, { guard: "none" });
    if (!call) return reply(503, { error: "No AI is connected, so Orca can't find connections." });
    const rate = await rateLimit(db, student.id, "relink");
    if (!rate.ok) return tooManyRequests(rate);
    const verdict = await checkBudget(adminClient(), student.id, 0);
    if (!verdict.ok) return reply(429, { error: verdict.message });

    const store = supabaseJobStore(db, student.id);
    const loaded = await store.course(parsed.data.courseId);
    if (!loaded) return reply(404, { error: "No such course." });
    const before = loaded.structure;
    const live = before.topics.filter((t) => t.review !== "archived" && !t.mergedInto);
    let linked;
    try {
      linked = await linkTopics(
        { course: loaded.course, topics: before.topics, newIds: new Set(live.map((t) => t.id)), existing: before.relations, materialId: null },
        { call, newId: () => crypto.randomUUID() },
      );
    } catch (e) {
      if (e instanceof StepError) return reply(e.status >= 500 ? 502 : e.status, { error: e.message });
      throw e;
    }
    // New links, and reasons for the course's old links that had none.
    const reasons = new Map(linked.explained.map((e) => [e.id, e.reason]));
    const relations = [...before.relations.map((r) => (reasons.has(r.id) ? { ...r, reason: reasons.get(r.id)! } : r)), ...linked.links];
    if (linked.links.length || reasons.size) await store.save(parsed.data.courseId, structureRows(before, { ...before, relations }, []));
    return reply(200, { added: linked.links.length, explained: reasons.size });
  });
}
