/**
 * Uploads (Phase 4 plan, decisions 7, 10 and 13). Two steps, each a route:
 *
 * 1. `startUpload` (POST /api/materials): checks what the browser says about the file (PDF or .pptx, at most
 *    30 MB), recognises a file already in the course by its SHA-256, and otherwise records the
 *    material (status `uploaded`) and hands back a signed upload URL for
 *    `<owner>/<material id>` in the private `materials` bucket.
 * 2. `processUpload` (POST /api/materials/:id/process): once the file is in Storage, the server
 *    takes it from there (never from the browser), hashes it, recognises a duplicate again (the
 *    browser's hash is only a shortcut), reads it (pdf.js for a PDF, the slide XML for a .pptx) into sanitised `material_pages`, drops
 *    and counts hidden text, and marks the material `ready`. A file that can't be read is marked
 *    `failed` with why.
 *
 * Both run with the service-role client and scope every query to the signed-in student.
 * The routes then start the job that builds the questions (`src/lib/server/jobs/start.ts`).
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { MATERIAL_TYPES, type Material, type MaterialType } from "@/lib/data";
import { LIMITS } from "@/lib/limits";
import { UNSUPPORTED_UPLOAD, UPLOAD_MIMES, type UploadKind, uploadKind } from "@/lib/material/kind";
import { type HiddenText, type ReadPage, UnreadablePdfError, looksLikePdf, readPdf } from "@/lib/material/read-pdf";
import { readPptx } from "@/lib/material/read-pptx";
import { looksLikeZip } from "@/lib/material/unzip";
import { isOwnPath, uploadPath } from "@/lib/material/paths";
import { materialFromRow } from "@/lib/supabase/app-rows";
import type { Json } from "@/lib/supabase/database.types";
import type { OrcaSupabase } from "@/lib/supabase/server";
import { ownsCourse } from "./student";

export const BUCKET = "materials";

/** A route's answer, before it's sent (the route adds what happens to the questions). */
export interface Outcome {
  status: number;
  body: Processed | Duplicate | Started | { error: string };
}
const reply = (status: number, body: Outcome["body"]): Outcome => ({ status, body });

export interface Started {
  material: Material;
  upload: { path: string; token: string };
}



const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const UploadRequest = z.object({
  courseId: z.uuid(),
  filename: z.string().trim().min(1).max(255),
  size: z.number().int().min(1),
  mime: z.string().max(200),
  /** The browser's SHA-256 of the file, hex: only to recognise a re-upload before sending it. */
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  type: z.enum(MATERIAL_TYPES as [MaterialType, ...MaterialType[]]),
  assigned: isoDate.nullable(),
  due: isoDate.nullable(),
  reflect: z.boolean(),
  /** The student says the file is handwritten notes: every page is read from its image. */
  handwritten: z.boolean().default(false),
  /** The class hasn't reached this file yet: its objectives wait until it's marked covered. */
  upcoming: z.boolean().default(false),
});
export type UploadRequest = z.infer<typeof UploadRequest>;

/** What both routes answer when the file is one the course already has. */
export interface Duplicate {
  duplicate: { id: string; filename: string };
}

export interface Processed {
  material: Material;
  pages: ReadPage[];
  hidden: HiddenText;
}

const fail = (what: string, error: { message: string }) => new Error(`Couldn't ${what}: ${error.message}`);

async function sameFile(db: OrcaSupabase, ownerId: string, courseId: string, hash: string, except?: string): Promise<Duplicate | null> {
  let query = db.from("materials").select("id, filename").eq("owner_id", ownerId).eq("course_id", courseId).eq("content_hash", hash);
  if (except) query = query.neq("id", except);
  const { data, error } = await query.maybeSingle();
  if (error) throw fail("look for the same file", error);
  return data ? { duplicate: { id: data.id, filename: data.filename } } : null;
}

export async function startUpload(db: OrcaSupabase, ownerId: string, body: UploadRequest): Promise<Outcome> {
  const kind = uploadKind(body.filename, body.mime);
  if (!kind) return reply(415, { error: UNSUPPORTED_UPLOAD });
  if (body.size > LIMITS.uploadBytes) return reply(413, { error: `This file is over ${LIMITS.uploadBytes / 1024 / 1024} MB.` });
  if (!(await ownsCourse(db, ownerId, body.courseId))) return reply(404, { error: "No such course." });
  const known = await sameFile(db, ownerId, body.courseId, body.hash);
  if (known) return reply(200, known);

  const id = crypto.randomUUID();
  const path = uploadPath(ownerId, id);
  const { data: row, error } = await db
    .from("materials")
    .insert({
      id,
      owner_id: ownerId,
      course_id: body.courseId,
      filename: body.filename,
      type: body.type,
      assigned: body.assigned,
      due: body.due,
      reflect: body.reflect,
      handwritten: body.handwritten,
      upcoming: body.upcoming,
      storage_path: path,
      size_bytes: body.size,
      mime: UPLOAD_MIMES[kind],
      status: "uploaded",
    })
    .select()
    .single();
  if (error) throw fail("record the upload", error);
  const signed = await db.storage.from(BUCKET).createSignedUploadUrl(path);
  if (signed.error) throw fail("prepare the upload", signed.error);
  return reply(201, { material: materialFromRow(row), upload: { path, token: signed.data.token } });
}

async function storedPages(db: OrcaSupabase, ownerId: string, materialId: string): Promise<ReadPage[]> {
  const { data, error } = await db.from("material_pages").select("n, text").eq("owner_id", ownerId).eq("material_id", materialId).order("n").limit(LIMITS.pagesPerFile);
  if (error) throw fail("read the stored pages", error);
  return data;
}

/** Remove an upload that turned out to be a file the course already has: its row and its file. */
async function discard(db: OrcaSupabase, ownerId: string, id: string, path: string) {
  const removed = await db.storage.from(BUCKET).remove([path]);
  if (removed.error) throw fail("remove the duplicate file", removed.error);
  const { error } = await db.from("materials").delete().eq("owner_id", ownerId).eq("id", id);
  if (error) throw fail("remove the duplicate upload", error);
}

export async function processUpload(db: OrcaSupabase, ownerId: string, id: string): Promise<Outcome> {
  const { data: m, error } = await db.from("materials").select().eq("owner_id", ownerId).eq("id", id).maybeSingle();
  if (error) throw fail("read the upload", error);
  if (!m) return reply(404, { error: "No such upload." });
  if (m.status === "ready") {
    // Already read (a retried request): the same answer again.
    const out: Processed = { material: materialFromRow(m), pages: await storedPages(db, ownerId, id), hidden: (m.hidden_text as unknown as HiddenText | null) ?? { items: 0, pages: [] } };
    return reply(200, out);
  }
  if (m.status === "failed") return reply(422, { error: m.error ?? "This upload failed." });
  if ((m.status !== "uploaded" && m.status !== "reading") || !m.storage_path) return reply(409, { error: "This upload isn't waiting to be read." });
  const path = m.storage_path;

  const setFailed = async (message: string) => {
    const r = await db.from("materials").update({ status: "failed", error: message, reading_since: null }).eq("owner_id", ownerId).eq("id", id);
    if (r.error) throw fail("record why the upload failed", r.error);
  };
  if (!isOwnPath(path, ownerId, id)) {
    await setFailed("This upload's file path isn't one Orca made.");
    return reply(422, { error: "This upload's file path isn't one Orca made." });
  }

  // Claim it, so two requests can't read the same file at once. A read that started long ago died
  // (its function was stopped), so it's taken over instead of blocking the upload for good.
  const staleBefore = new Date(Date.now() - LIMITS.staleReadingMs).toISOString();
  const claim = await db
    .from("materials")
    .update({ status: "reading", reading_since: new Date().toISOString() })
    .eq("owner_id", ownerId)
    .eq("id", id)
    .or(`status.eq.uploaded,and(status.eq.reading,reading_since.lt.${staleBefore}),and(status.eq.reading,reading_since.is.null)`)
    .select("id");
  if (claim.error) throw fail("start reading the upload", claim.error);
  if (!claim.data.length) return reply(409, { error: "This upload is already being read." });

  try {
    const file = await db.storage.from(BUCKET).download(path);
    if (file.error) {
      // Not there (yet): give it back, so the browser can upload and ask again.
      const r = await db.from("materials").update({ status: "uploaded", reading_since: null }).eq("owner_id", ownerId).eq("id", id);
      if (r.error) throw fail("release the upload", r.error);
      return reply(409, { error: "The file hasn't arrived in storage; upload it again." });
    }
    const bytes = new Uint8Array(await file.data.arrayBuffer());
    const hash = createHash("sha256").update(bytes).digest("hex");
    const known = await sameFile(db, ownerId, m.course_id, hash, id);
    if (known) {
      await discard(db, ownerId, id, path);
      return reply(200, known);
    }
    // The stored bytes decide how it's read, not the name or type the browser gave.
    const kind: UploadKind | null = looksLikePdf(bytes) ? "pdf" : looksLikeZip(bytes) ? "pptx" : null;
    let read: { pages: ReadPage[]; hidden: HiddenText };
    try {
      if (!kind) throw new UnreadablePdfError(UNSUPPORTED_UPLOAD, 415);
      read = kind === "pdf" ? await readPdf(bytes, { handwritten: m.handwritten }) : await readPptx(bytes);
    } catch (e) {
      if (!(e instanceof UnreadablePdfError)) throw e;
      await setFailed(e.message);
      return reply(e.status, { error: e.message });
    }
    if (read.pages.length) {
      const rows = read.pages.map((p) => ({ owner_id: ownerId, material_id: id, n: p.n, text: p.text, source: p.source ?? "text" }));
      const inserted = await db.from("material_pages").upsert(rows, { onConflict: "material_id,n" });
      if (inserted.error) throw fail("store the pages", inserted.error);
    }
    // The hash is taken only now, with the row going ready: a read that dies leaves no hash behind
    // to block the file, and the unique index settles a race between two uploads of the same file.
    const done = await db
      .from("materials")
      .update({ status: "ready", reading_since: null, content_hash: hash, size_bytes: bytes.byteLength, mime: UPLOAD_MIMES[kind], hidden_text: read.hidden as unknown as Json })
      .eq("owner_id", ownerId)
      .eq("id", id)
      .select()
      .single();
    if (done.error?.code === "23505") {
      const winner = await sameFile(db, ownerId, m.course_id, hash, id);
      await discard(db, ownerId, id, path); // its pages go with it
      if (winner) return reply(200, winner);
    }
    if (done.error) throw fail("finish the upload", done.error);
    const out: Processed = { material: materialFromRow(done.data), pages: read.pages, hidden: read.hidden };
    return reply(200, out);
  } catch (e) {
    // Never leave it "reading": say what went wrong on the material, then let the route answer 500.
    await setFailed(`Orca couldn't read this file: ${e instanceof Error ? e.message : String(e)}`).catch(() => undefined);
    throw e;
  }
}

/**
 * Remove material from its course (DELETE /api/materials/:id). The file, its stored pages and its
 * calendar entry go; its row stays, marked `removed` (topics, objectives and questions keep their
 * provenance; the app doesn't load it), without its hash so the same file can be uploaded again.
 * The objectives only this material taught are archived, and a topic it created that is left with
 * no live objective is archived too; what another upload also teaches stays. Answer history is
 * never touched (archived objectives just leave reviews and the island). A queued or paused run
 * for it is failed; a running one must be stopped first (409).
 */
export type Removal = { status: number; body: { removed: true; archivedObjectives?: number } | { error: string } };

export async function removeMaterial(db: OrcaSupabase, ownerId: string, id: string): Promise<Removal> {
  const answer = (status: number, body: Removal["body"]): Removal => ({ status, body });
  const { data: m, error } = await db.from("materials").select("id, course_id, storage_path, status").eq("owner_id", ownerId).eq("id", id).maybeSingle();
  if (error) throw fail("read the material", error);
  if (!m) return answer(404, { error: "No such material." });
  if (m.status === "removed") return answer(200, { removed: true });

  const { data: runs, error: runsError } = await db.from("pipeline_runs").select("id, status").eq("owner_id", ownerId).eq("material_id", id).eq("kind", "upload").in("status", ["queued", "waiting", "running", "paused"]);
  if (runsError) throw fail("read the material's runs", runsError);
  if (runs.some((r) => r.status === "running")) return answer(409, { error: "Orca is building from this file right now. Stop that upload first, then remove it." });
  if (runs.length) {
    const { error: failed } = await db.from("pipeline_runs").update({ status: "failed", error: "Removed by you.", progress: null }).eq("owner_id", ownerId).in("id", runs.map((r) => r.id)).in("status", ["queued", "waiting", "paused"]);
    if (failed) throw fail("stop the material's queued run", failed);
  }

  // The objectives only this upload taught: archived (their questions go with them, by objective).
  const { data: archived, error: archiveError } = await db.from("objectives").update({ review: "archived", archived_with_material: true }).eq("owner_id", ownerId).eq("material_id", id).neq("review", "archived").select("id, topic_id");
  if (archiveError) throw fail("archive the material's objectives", archiveError);
  // A topic this upload created is archived too once it has no live objective left; its place list loses this file either way.
  const { data: topics, error: topicsError } = await db.from("topics").select("id, material_id, source").eq("owner_id", ownerId).eq("course_id", m.course_id).neq("review", "archived");
  if (topicsError) throw fail("read the course's topics", topicsError);
  for (const t of topics) {
    const places = Array.isArray(t.source) ? (t.source as Array<{ materialId?: string }>) : [];
    const kept = places.filter((p) => p.materialId !== id);
    const patch: { source?: NonNullable<Json>; review?: "archived"; archived_with_material?: true } = {};
    if (kept.length !== places.length) patch.source = kept as unknown as NonNullable<Json>;
    if (t.material_id === id) {
      const { count, error: liveError } = await db.from("objectives").select("id", { count: "exact", head: true }).eq("owner_id", ownerId).eq("topic_id", t.id).neq("review", "archived");
      if (liveError) throw fail("count the topic's objectives", liveError);
      if (!count) {
        patch.review = "archived";
        patch.archived_with_material = true;
      }
    }
    if (Object.keys(patch).length) {
      const { error: topicError } = await db.from("topics").update(patch).eq("owner_id", ownerId).eq("id", t.id);
      if (topicError) throw fail("update the topic", topicError);
    }
  }

  const { error: pagesError } = await db.from("material_pages").delete().eq("owner_id", ownerId).eq("material_id", id);
  if (pagesError) throw fail("remove the material's pages", pagesError);
  const { error: eventsError } = await db.from("calendar_events").delete().eq("owner_id", ownerId).eq("material_id", id);
  if (eventsError) throw fail("remove the material's calendar entry", eventsError);
  if (m.storage_path) {
    const removed = await db.storage.from(BUCKET).remove([m.storage_path]);
    if (removed.error) throw fail("remove the file", removed.error);
  }
  const { error: markError } = await db.from("materials").update({ status: "removed", storage_path: null, content_hash: null, reading_since: null }).eq("owner_id", ownerId).eq("id", id);
  if (markError) throw fail("mark the material removed", markError);
  return answer(200, { removed: true, archivedObjectives: archived.length });
}
