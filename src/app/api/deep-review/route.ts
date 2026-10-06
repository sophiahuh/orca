import { z } from "zod";
import { DEEP_MAX_MINUTES, deepQuestionCount } from "@/lib/deep-review";
import { REFUSED_PREFIX } from "@/lib/pipeline/run";
import { runDeepReview } from "@/lib/pipeline/topup";
import { supabaseJobStore } from "@/lib/server/job-store";
import { StepError, stepCaller } from "@/lib/server/model";
import { rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { forStudent, reply } from "@/lib/server/student";
import { checkBudget } from "@/lib/server/usage";
import { structureRows } from "@/lib/supabase/app-rows";
import { adminClient } from "@/lib/supabase/server";

/**
 * POST { courseId, minutes, objectiveIds } → write a deep review's questions now (owner's decision,
 * 2026-10-06: deep reviews are written when they start, harder than the quick-review stock).
 * `objectiveIds` are the objectives to cover, most urgent first (the browser's agenda ranks them);
 * the length sets how many questions (`deepQuestionCount`). They're saved to the course's stock
 * marked deep, and the answer lists them in order: 200 { questions: [{ id, topicId, objectiveId }],
 * skipped }. 503 no model key, 404 not the student's course, 429 past the rate limit or a daily budget.
 * The student waits on the page, so this runs in the request, not as a job.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

const Body = z.object({ courseId: z.uuid(), minutes: z.number().int().min(1).max(DEEP_MAX_MINUTES), objectiveIds: z.array(z.uuid()).min(1).max(400) });

export async function POST(request: Request) {
  return forStudent(request, async (student, db) => {
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return reply(400, { error: "Send the course, the length and the objectives to cover." });
    const call = stepCaller({ ownerId: student.id, kind: "deep-review" }, { guard: "none" });
    if (!call) return reply(503, { error: "No AI is connected, so Orca can't write a deep review." });
    const rate = await rateLimit(db, student.id, "deepReview");
    if (!rate.ok) return tooManyRequests(rate);
    const verdict = await checkBudget(adminClient(), student.id, 0);
    if (!verdict.ok) return reply(429, { error: verdict.message });

    const store = supabaseJobStore(db, student.id);
    const loaded = await store.course(parsed.data.courseId);
    if (!loaded) return reply(404, { error: "No such course." });
    const before = loaded.structure;
    const materials = await store.materials(parsed.data.courseId);
    const materialPages = await store.pages(materials.map((m) => m.id));
    let out: Awaited<ReturnType<typeof runDeepReview>>;
    try {
      out = await runDeepReview(
        {
          course: { ...loaded.course, topics: before.topics },
          objectives: before.objectives,
          bank: before.bank,
          materials,
          materialPages,
          objectiveIds: parsed.data.objectiveIds,
          count: deepQuestionCount(parsed.data.minutes),
        },
        { call, newId: () => crypto.randomUUID() },
      );
    } catch (e) {
      if (e instanceof StepError) return reply(e.status >= 500 ? 502 : e.status, { error: e.message });
      throw e;
    }
    // Generated text the validators refused is logged like an upload's (decision 13).
    const refused = out.dropped.filter((d) => d.reason.startsWith(REFUSED_PREFIX));
    if (refused.length) {
      const { error } = await adminClient()
        .from("security_events")
        .insert(refused.map((d) => ({ owner_id: student.id, kind: "generated", check: "validator", quote: `${d.prompt}: ${d.reason}`.slice(0, 240) })));
      if (error) throw new Error(`Couldn't record the security events: ${error.message}`);
    }

    const written = Object.entries(out.questions).flatMap(([topicId, qs]) => qs.map((q) => ({ id: q.id, topicId, objectiveId: q.objectiveId! })));
    if (!written.length) {
      const why = out.skipped[0]?.reason ?? out.dropped[0]?.reason ?? "the model wrote nothing usable";
      return reply(422, { error: `Orca couldn't write a deep review: ${why}.` });
    }
    const bank = { ...before.bank };
    for (const [topicId, qs] of Object.entries(out.questions)) bank[topicId] = [...(bank[topicId] ?? []), ...qs];
    await store.save(parsed.data.courseId, structureRows(before, { ...before, bank }, []));
    // Most urgent first, as asked: one question per objective down the list, then round again.
    const order = new Map(parsed.data.objectiveIds.map((id, i) => [id, i]));
    const seen = new Map<string, number>();
    const ranked = written.map((w) => {
      const round = seen.get(w.objectiveId) ?? 0;
      seen.set(w.objectiveId, round + 1);
      return { ...w, round, rank: order.get(w.objectiveId) ?? order.size };
    });
    ranked.sort((a, b) => a.round - b.round || a.rank - b.rank);
    return reply(200, { questions: ranked.map(({ id, topicId, objectiveId }) => ({ id, topicId, objectiveId })), skipped: out.skipped });
  });
}
