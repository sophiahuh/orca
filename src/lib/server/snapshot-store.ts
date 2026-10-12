/**
 * SnapshotStore (src/lib/mastery/snapshots.ts) on Supabase, for one student's course. Uses the
 * service-role client, so every query here names the owner and the course: the owner is always
 * the user the route verified, never an id from the request.
 */
import { RULES_VERSION } from "@/lib/mastery/objective-state";
import type { CourseView, SnapshotStore } from "@/lib/mastery/snapshots";
import type { Json } from "@/lib/supabase/database.types";
import { courseView, eventFromRow, eventToRow, snapshotFromRow } from "@/lib/supabase/rows";
import type { OrcaSupabase } from "@/lib/supabase/server";

/** PostgREST returns at most `max_rows` (1,000) rows per request, so long lists are read in pages. */
const PAGE = 1000;

async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, what: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(`Couldn't read ${what}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

export function supabaseSnapshotStore(db: OrcaSupabase, ownerId: string, courseId: string): SnapshotStore {
  return {
    async view(): Promise<CourseView> {
      // One SQL statement, so one consistent snapshot: a structure save landing mid-read can't mix
      // old and new rows (parallel reads could, and objectivesForTopic would then throw).
      const { data, error } = await db.rpc("course_structure", { course: courseId, owner: ownerId });
      if (error) throw new Error(`Couldn't read the course's structure: ${error.message}`);
      if (data === null) throw new Error(`Couldn't read the course's structure: course ${courseId} isn't this student's`);
      return courseView(data as unknown as Parameters<typeof courseView>[0]);
    },

    async snapshot(objectiveId) {
      const { data, error } = await db.from("objective_state").select("*").eq("owner_id", ownerId).eq("course_id", courseId).eq("objective_id", objectiveId).maybeSingle();
      if (error) throw new Error(`Couldn't read the snapshot of ${objectiveId}: ${error.message}`);
      return data ? snapshotFromRow(data) : null;
    },

    async snapshots() {
      const rows = await readAll((a, b) => db.from("objective_state").select("*").eq("owner_id", ownerId).eq("course_id", courseId).order("objective_id").range(a, b), "snapshots");
      return rows.map(snapshotFromRow);
    },

    async log() {
      const rows = await readAll((a, b) => db.from("evidence_events").select("*").eq("owner_id", ownerId).eq("course_id", courseId).order("at").order("id").range(a, b), "the evidence log");
      return rows.map(eventFromRow);
    },

    async record(event, write) {
      const { data, error } = await db.rpc("record_evidence", {
        owner: ownerId,
        event: eventToRow(event) as unknown as Json,
        // A null objective (the event counts for nothing) records only the event.
        objective: (write?.objectiveId ?? null) as string,
        accumulator: (write?.accumulator ?? null) as unknown as Json,
        rules_version: (write ? RULES_VERSION : null) as number,
        expected_version: (write?.expectedVersion ?? null) as number,
      });
      if (error) throw new RecordError(error.code, error.message);
      return data === true;
    },

    async save(objectiveId, accumulator, expectedVersion) {
      const { data, error } = await db.rpc("save_snapshot", {
        owner: ownerId,
        objective: objectiveId,
        accumulator: accumulator as unknown as Json,
        rules_version: RULES_VERSION,
        expected_version: expectedVersion,
      });
      if (error) throw new Error(`Couldn't save the snapshot of ${objectiveId}: ${error.message}`);
      return data === true;
    },
  };
}

/** record_evidence refused the write; `code` is Postgres's SQLSTATE (23505: the event id exists). */
export class RecordError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(`Couldn't record the event: ${message}`);
    this.name = "RecordError";
    this.code = code;
  }
}
