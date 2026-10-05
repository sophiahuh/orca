/**
 * Uploads (Phase 4 plan, decisions 7, 10 and 13). Two steps, each a route:
 *
 * 1. `startUpload` (POST /api/materials): checks what the browser says about the file (PDF, at most
 *    25 MB), recognises a file already in the course by its SHA-256, and otherwise records the
 *    material (status `uploaded`) and hands back a signed upload URL for
 *    `<owner>/<material id>/<safe name>` in the private `materials` bucket.
 * 2. `processUpload` (POST /api/materials/:id/process): once the file is in Storage, the server
 *    takes it from there (never from the browser), hashes it, recognises a duplicate again (the
 *    browser's hash is only a shortcut), reads it with pdf.js into sanitised `material_pages`, drops
 *    and counts hidden text, and marks the material `ready`. A file that can't be read is marked
 *    `failed` with why.
 *
 * Both run with the service-role client and scope every query to the signed-in student.
 * Model work stays in the browser until Task 7 moves it into the jobs.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { MATERIAL_TYPES, type Material, type MaterialType } from "@/lib/data";
import { LIMITS } from "@/lib/limits";
import { type HiddenText, type ReadPage, UnreadablePdfError, readPdf } from "@/lib/material/read-pdf";
import { isOwnPath, safeName } from "@/lib/material/paths";
import { materialFromRow } from "@/lib/supabase/app-rows";
import type { Json } from "@/lib/supabase/database.types";
import type { OrcaSupabase } from "@/lib/supabase/server";
import { ownsCourse, reply } from "./student";

export const BUCKET = "materials";



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

export async function startUpload(db: OrcaSupabase, ownerId: string, body: UploadRequest): Promise<Response> {
  if (body.mime !== LIMITS.uploadMime && !/\.pdf$/i.test(body.filename)) return reply(415, { error: "Only PDFs can be uploaded for now." });
  if (body.size > LIMITS.uploadBytes) return reply(413, { error: `This file is over ${LIMITS.uploadBytes / 1024 / 1024} MB.` });
  if (!(await ownsCourse(db, ownerId, body.courseId))) return reply(404, { error: "No such course." });
  const known = await sameFile(db, ownerId, body.courseId, body.hash);
  if (known) return reply(200, known);

  const id = crypto.randomUUID();
  const path = `${ownerId}/${id}/${safeName(body.filename)}`;
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
      storage_path: path,
      size_bytes: body.size,
      mime: LIMITS.uploadMime,
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

export async function processUpload(db: OrcaSupabase, ownerId: string, id: string): Promise<Response> {
  const { data: m, error } = await db.from("materials").select().eq("owner_id", ownerId).eq("id", id).maybeSingle();
  if (error) throw fail("read the upload", error);
  if (!m) return reply(404, { error: "No such upload." });
  if (m.status === "ready") {
    // Already read (a retried request): the same answer again.
    const out: Processed = { material: materialFromRow(m), pages: await storedPages(db, ownerId, id), hidden: (m.hidden_text as unknown as HiddenText | null) ?? { items: 0, pages: [] } };
    return reply(200, out);
  }
  if (m.status === "failed") return reply(422, { error: m.error });
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
    let read: Awaited<ReturnType<typeof readPdf>>;
    try {
      read = await readPdf(bytes);
    } catch (e) {
      if (!(e instanceof UnreadablePdfError)) throw e;
      await setFailed(e.message);
      return reply(e.status, { error: e.message });
    }
    if (read.pages.length) {
      const rows = read.pages.map((p) => ({ owner_id: ownerId, material_id: id, n: p.n, text: p.text }));
      const inserted = await db.from("material_pages").upsert(rows, { onConflict: "material_id,n" });
      if (inserted.error) throw fail("store the pages", inserted.error);
    }
    // The hash is taken only now, with the row going ready: a read that dies leaves no hash behind
    // to block the file, and the unique index settles a race between two uploads of the same file.
    const done = await db
      .from("materials")
      .update({ status: "ready", reading_since: null, content_hash: hash, size_bytes: bytes.byteLength, mime: LIMITS.uploadMime, hidden_text: read.hidden as unknown as Json })
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
