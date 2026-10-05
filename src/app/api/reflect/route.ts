import { z } from "zod";
import { stepCaller, StepError } from "@/lib/server/model";
import { forStudent, reply } from "@/lib/server/student";
import { sanitize } from "@/lib/untrusted/sanitize";

/**
 * POST { materialId, note } → which of the course's objectives a homework reflection says the
 * student struggles with: 200 { matches: [{ objectiveId, sure, reasoning }] }, only live objectives
 * of the material's course. The reflect step runs here with Orca's key; the student confirms the
 * matches, and confirmed ones are recorded through POST /api/evidence. 503 when the server has no
 * model key, 404 not the student's material.
 */
export const runtime = "nodejs";
export const maxDuration = 120;

const Body = z.object({ materialId: z.uuid(), note: z.string().trim().min(1).max(2000) });

export async function POST(request: Request) {
  return forStudent(request, async (student, db) => {
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return reply(400, { error: "Send the material and a note of at most 2,000 characters." });
    const call = stepCaller();
    if (!call) return reply(503, { error: "No AI is connected, so Orca can't match your reflection." });
    const { data: material, error } = await db.from("materials").select("id, course_id, filename, type").eq("owner_id", student.id).eq("id", parsed.data.materialId).maybeSingle();
    if (error) throw new Error(`Couldn't read the material: ${error.message}`);
    if (!material) return reply(404, { error: "No such material." });
    const [course, objectives, topics] = await Promise.all([
      db.from("courses").select("name, short").eq("owner_id", student.id).eq("id", material.course_id).single(),
      db.from("objectives").select("id, name, description, topic_id, review, merged_into").eq("owner_id", student.id).eq("course_id", material.course_id),
      db.from("topics").select("id, name").eq("owner_id", student.id).eq("course_id", material.course_id),
    ]);
    for (const r of [course, objectives, topics]) if (r.error) throw new Error(`Couldn't read the course: ${r.error.message}`);
    const live = objectives.data!.filter((o) => o.review !== "archived" && !o.merged_into);
    if (!live.length) return reply(200, { matches: [] });
    const topicName = new Map(topics.data!.map((t) => [t.id, t.name]));
    try {
      const out = await call("reflect", {
        course: { name: course.data!.name, short: course.data!.short },
        material: { filename: material.filename, type: material.type as never },
        note: sanitize(parsed.data.note, 2000).text,
        objectives: live.map((o) => ({ id: o.id, name: o.name, description: o.description, topic: topicName.get(o.topic_id) ?? "" })),
      });
      const ids = new Set(live.map((o) => o.id));
      return reply(200, { matches: out.matches.filter((m) => ids.has(m.objectiveId)) });
    } catch (e) {
      if (e instanceof StepError) return reply(e.status >= 500 ? 502 : e.status, { error: e.message });
      throw e;
    }
  });
}
