/**
 * log_evidence (docs/superpowers/specs/2026-11-10-cram-mode-contracts.md, section 4): a work event
 * (a problem Claude set and judged) or a signal (what the student did) on one objective, recorded
 * against the student's snapshot with source connector and the chat's session, through the same
 * store and fold check_answer uses. The event's topic is the objective's current one (topic merges
 * followed); an archived or merged-away objective, or one in an archived topic, is refused.
 */
import type { EvidenceEntry, LoggedEvidence } from "@/lib/connector/mcp";
import { stateAt } from "@/lib/mastery/objective-state";
import { NewerRulesError, VersionConflictError, recordEvent } from "@/lib/mastery/snapshots";
import type { SignalEvent, WorkEvent } from "@/lib/mastery/types";
import { RecordError, supabaseSnapshotStore } from "@/lib/server/snapshot-store";
import type { OrcaSupabase } from "@/lib/supabase/server";

export async function logEvidence(db: OrcaSupabase, ownerId: string, courseId: string, objectiveId: string, entry: EvidenceEntry, sessionId: string, now: () => Date = () => new Date()): Promise<LoggedEvidence | { error: string }> {
  const { data: course, error: courseError } = await db.from("courses").select("id").eq("owner_id", ownerId).eq("id", courseId).is("deleted_at", null).maybeSingle();
  if (courseError) throw new Error(`Couldn't read the course: ${courseError.message}`);
  if (!course) return { error: "No such course." };
  const { data: objective, error: objectiveError } = await db.from("objectives").select("id, topic_id, review, merged_into").eq("owner_id", ownerId).eq("course_id", courseId).eq("id", objectiveId).maybeSingle();
  if (objectiveError) throw new Error(`Couldn't read the objective: ${objectiveError.message}`);
  if (!objective || objective.review === "archived" || objective.merged_into) return { error: "No such live objective in this course; use an id from course_state." };
  // The objective's current topic: its own, followed through merges (as the course loads it).
  const { data: topics, error: topicsError } = await db.from("topics").select("id, review, merged_into").eq("owner_id", ownerId).eq("course_id", courseId);
  if (topicsError) throw new Error(`Couldn't read the topics: ${topicsError.message}`);
  const topicById = new Map(topics.map((t) => [t.id, t]));
  let topic = topicById.get(objective.topic_id);
  for (let i = 0; topic?.merged_into && i < 50; i++) topic = topicById.get(topic.merged_into);
  if (!topic || topic.review === "archived") return { error: "That objective's topic is no longer in the course." };

  const at = now();
  const common = { id: crypto.randomUUID(), at: at.toISOString(), courseId, topicId: topic.id, objectiveId: objective.id, source: "connector" as const, sessionId };
  const event: WorkEvent | SignalEvent =
    entry.kind === "work"
      ? {
          kind: "work",
          ...common,
          problem: entry.problem,
          ...(entry.response ? { response: entry.response } : {}),
          basis: entry.basis,
          outcome: entry.outcome,
          ...(entry.help ? { help: entry.help } : {}),
          ...(entry.confidence ? { confidence: entry.confidence } : {}),
          ...(entry.errorType ? { errorType: entry.errorType } : {}),
        }
      : { kind: "signal", ...common, signal: entry.signal, note: entry.note ?? null };
  try {
    const r = await recordEvent(supabaseSnapshotStore(db, ownerId, courseId), event);
    const status = r.objectiveId && r.accumulator ? stateAt(r.objectiveId, r.accumulator, at).status : "unseen";
    return { recorded: true, objectiveId: r.objectiveId ?? objective.id, status };
  } catch (e) {
    if (e instanceof VersionConflictError) return { error: "Another answer was being saved at the same moment; this wasn't recorded. Try again." };
    if (e instanceof NewerRulesError) return { error: "Orca is being updated; this wasn't recorded. Try again in a moment." };
    if (e instanceof RecordError) return { error: `Orca couldn't record it: ${e.message}` };
    throw e;
  }
}
