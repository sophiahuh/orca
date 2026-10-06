/**
 * Uploads that never became material (Phase 4 plan, Task 6 review): a file sent but never read
 * (the student closed the tab between the upload and the process call), a read that died, or a
 * file Orca refused. Their rows and files are kept a while so a retry or a look is possible, then
 * removed. Material that was read (`ready`) or is being built (`processing`) is never touched:
 * nothing a student can see is deleted. Pure; loads under plain Node; the Supabase client is
 * passed in, so a script, a scheduled task or a test can run it.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types.ts";

export const CLEANUP = {
  /** An upload still `uploaded` (never processed) or `reading` after this long is abandoned. */
  abandonedMs: 24 * 60 * 60_000,
  /** A `failed` read is kept this long, so the owner can see why, then goes. */
  failedMs: 7 * 24 * 60 * 60_000,
} as const;

export interface UploadRow {
  id: string;
  owner_id: string;
  status: string;
  created_at: string;
  reading_since: string | null;
  storage_path: string | null;
}

export interface StaleUpload {
  id: string;
  ownerId: string;
  path: string | null;
  why: "abandoned" | "failed";
}

/** Which of these rows are old enough to remove, and why. Rows in any other status are never returned. */
export function staleUploads(rows: readonly UploadRow[], now: Date): StaleUpload[] {
  const out: StaleUpload[] = [];
  for (const r of rows) {
    const created = Date.parse(r.created_at);
    if (!Number.isFinite(created)) continue;
    let why: StaleUpload["why"] | null = null;
    if (r.status === "uploaded" && now.getTime() - created >= CLEANUP.abandonedMs) why = "abandoned";
    else if (r.status === "reading") {
      const since = r.reading_since ? Date.parse(r.reading_since) : created;
      if (now.getTime() - Math.max(created, Number.isFinite(since) ? since : created) >= CLEANUP.abandonedMs) why = "abandoned";
    } else if (r.status === "failed" && now.getTime() - created >= CLEANUP.failedMs) why = "failed";
    if (why) out.push({ id: r.id, ownerId: r.owner_id, path: r.storage_path, why });
  }
  return out;
}

export interface Cleaned {
  removed: StaleUpload[];
  /** Rows that couldn't be removed, with why; the next sweep tries again. */
  failed: Array<{ id: string; error: string }>;
}

export const BUCKET = "materials";

/**
 * Remove every stale upload's file and row (its pages go with the row). Runs with the service-role
 * client over all students, but each delete is keyed by the row's own owner and id. The file goes
 * first: a row left behind without its file is harmless (processing it answers "upload it again",
 * and the next sweep removes it), while a file left behind without its row would never be found.
 */
export async function cleanupUploads(db: SupabaseClient<Database>, now = new Date()): Promise<Cleaned> {
  const { data, error } = await db.from("materials").select("id, owner_id, status, created_at, reading_since, storage_path").in("status", ["uploaded", "reading", "failed"]);
  if (error) throw new Error(`Couldn't list uploads to clean up: ${error.message}`);
  const stale = staleUploads(data, now);
  const removed: StaleUpload[] = [];
  const failed: Cleaned["failed"] = [];
  for (const u of stale) {
    try {
      if (u.path) {
        const file = await db.storage.from(BUCKET).remove([u.path]);
        if (file.error) throw new Error(`file: ${file.error.message}`);
      }
      const row = await db.from("materials").delete().eq("owner_id", u.ownerId).eq("id", u.id);
      if (row.error) throw new Error(`row: ${row.error.message}`);
      removed.push(u);
    } catch (e) {
      failed.push({ id: u.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { removed, failed };
}
