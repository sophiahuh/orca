import { z } from "zod";
import { NewerRulesError, VersionConflictError, recordEvent } from "@/lib/mastery/snapshots";
import type { AnswerEvent, EvidenceEvent } from "@/lib/mastery/types";
import { RecordError, supabaseSnapshotStore } from "@/lib/server/snapshot-store";
import { forStudent, ownsCourse, reply } from "@/lib/server/student";

/**
 * POST → record one evidence event for the signed-in student and keep its objective's snapshot in
 * step (the only way evidence is written; plan decision 3).
 *
 * An answer: { kind: "answer", id, courseId, questionId, outcome, grader, source, sessionId }. The
 * browser grades choice and exact answers and sends the outcome (decision 13: an edited request can
 * only inflate the student's own record). Prose grading moves server-side in Task 8.
 * A confusion event from a homework reflection: { kind: "confusion", id, courseId, objectiveId,
 * materialId, note }.
 *
 * The server stamps the time (a browser's clock can't be trusted for spacing) and takes the topic,
 * objective and tier from the question or objective rows, not from the request.
 * 201 → { event, countsFor, snapshot, rebuilt, retried }.
 */
export const runtime = "nodejs";

const uuid = z.uuid();
const Answer = z.object({
  kind: z.literal("answer"),
  id: uuid,
  courseId: uuid,
  questionId: uuid,
  outcome: z.enum(["correct", "partial", "incorrect"]),
  grader: z.enum(["choice", "exact", "rubric", "self"]),
  source: z.enum(["quiz", "quick-review", "deep-review", "requiz"]),
  sessionId: z.string().min(1).max(200),
});
const Confusion = z.object({
  kind: z.literal("confusion"),
  id: uuid,
  courseId: uuid,
  objectiveId: uuid,
  materialId: uuid,
  // Plan decision 10: reflection notes are capped at 2,000 characters.
  note: z.string().trim().min(1).max(2000),
});
const Body = z.discriminatedUnion("kind", [Answer, Confusion]);

export async function POST(request: Request) {
  return forStudent(request, async (student, db) => {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return reply(400, { error: "Send the event as JSON." });
    }
    const parsed = Body.safeParse(raw);
    if (!parsed.success) return reply(400, { error: "That isn't an evidence event.", issues: z.flattenError(parsed.error).fieldErrors });
    const body = parsed.data;
    if (!(await ownsCourse(db, student.id, body.courseId))) return reply(404, { error: "No such course." });

    const at = new Date().toISOString();
    let event: EvidenceEvent;
    if (body.kind === "answer") {
      const { data: q, error } = await db
        .from("questions")
        .select("objective_id, tier")
        .eq("owner_id", student.id)
        .eq("course_id", body.courseId)
        .eq("id", body.questionId)
        .maybeSingle();
      if (error) throw new Error(`Couldn't read the question: ${error.message}`);
      if (!q) return reply(404, { error: "No such question in this course." });
      if (!q.objective_id) return reply(422, { error: "This question isn't sorted into an objective yet, so its answer can't be recorded." });
      // The question's topic is its objective's (the question row's own topic_id can be stale: 2026-10-26).
      const { data: objective, error: objectiveError } = await db.from("objectives").select("topic_id").eq("owner_id", student.id).eq("course_id", body.courseId).eq("id", q.objective_id).maybeSingle();
      if (objectiveError) throw new Error(`Couldn't read the question's objective: ${objectiveError.message}`);
      if (!objective) throw new Error(`Question ${body.questionId} points at objective ${q.objective_id}, which isn't in the course`);
      event = {
        kind: "answer",
        id: body.id,
        at,
        courseId: body.courseId,
        topicId: objective.topic_id,
        objectiveId: q.objective_id,
        questionId: body.questionId,
        // The questions table holds tier to the same values as the type.
        tier: q.tier as AnswerEvent["tier"],
        outcome: body.outcome,
        grader: body.grader,
        source: body.source,
        sessionId: body.sessionId,
      };
    } else {
      const [objective, material] = await Promise.all([
        db.from("objectives").select("topic_id").eq("owner_id", student.id).eq("course_id", body.courseId).eq("id", body.objectiveId).maybeSingle(),
        db.from("materials").select("id").eq("owner_id", student.id).eq("course_id", body.courseId).eq("id", body.materialId).maybeSingle(),
      ]);
      if (objective.error || material.error) throw new Error(`Couldn't read the objective or material: ${(objective.error ?? material.error)!.message}`);
      if (!objective.data) return reply(404, { error: "No such objective in this course." });
      if (!material.data) return reply(404, { error: "No such upload in this course." });
      event = { kind: "confusion", id: body.id, at, courseId: body.courseId, topicId: objective.data.topic_id, objectiveId: body.objectiveId, materialId: body.materialId, note: body.note };
    }

    try {
      const r = await recordEvent(supabaseSnapshotStore(db, student.id, body.courseId), event);
      return reply(201, {
        event,
        countsFor: r.objectiveId,
        snapshot: r.objectiveId === null ? null : { objectiveId: r.objectiveId, accumulator: r.accumulator, version: r.version },
        rebuilt: r.rebuilt,
        retried: r.retried,
      });
    } catch (e) {
      if (e instanceof VersionConflictError) {
        return reply(409, {
          error:
            e.reason === "structure"
              ? "This course's topics or objectives were being changed at the same moment; the answer wasn't recorded. Try again."
              : "Another answer was being saved at the same moment; this one wasn't recorded. Try again.",
          reason: e.reason,
        });
      }
      if (e instanceof NewerRulesError) return reply(503, { error: "Orca is being updated; the answer wasn't recorded. Try again in a moment." });
      if (e instanceof RecordError && e.code === "23505") return reply(409, { error: "This event was already recorded.", duplicate: true });
      throw e;
    }
  });
}
