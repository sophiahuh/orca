/**
 * Canvas import against Supabase (plan: docs/superpowers/plans/2026-11-04-canvas-import.md): the
 * student's connection (token encrypted at rest; never read by the browser), their Canvas courses,
 * and importing one course: its Orca course row, its assignments as exams and calendar entries,
 * its syllabus as a material, and its files through the same upload path as the browser. Every
 * imported Canvas object is linked by id (`canvas_links`), so importing again adds only what's new.
 */
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { type CanvasAssignment, type CanvasCourse, type CanvasFile, type CanvasModule, type CanvasUser, type PickedFile, classifyAssignment, dayOf, htmlToText, pickFiles, postedAtOnce } from "@/lib/canvas/api";
import { type CanvasClient, CanvasError, canvasClient } from "@/lib/canvas/client";
import { placeIslands } from "@/lib/course/islands";
import { COURSE_NAME_MAX, type IslandVariant, shortName, slugify } from "@/lib/data";
import { LIMITS } from "@/lib/limits";
import { UPLOAD_MIMES, uploadKind } from "@/lib/material/kind";
import { startUploadJob } from "@/lib/server/jobs/start";
import { BUCKET, processUpload, startUpload } from "@/lib/server/materials";
import { isPublicAddress, publicHop } from "@/lib/server/public-page";
import { serverSupabaseEnv } from "@/lib/supabase/env";
import type { OrcaSupabase } from "@/lib/supabase/server";
import { sanitize } from "@/lib/untrusted/sanitize";

/* ── The token at rest ── */

const VARIANT_CYCLE: IslandVariant[] = ["ald", "circuit", "signals", "linear", "stats"];

function tokenKey(): Buffer {
  // Derived from the server's own secret, so no extra setting is needed; a different secret means stored tokens can't be read (reconnect).
  return Buffer.from(hkdfSync("sha256", serverSupabaseEnv().secretKey, "orca", "canvas-token", 32));
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ct.toString("base64url")}`;
}

export function decryptToken(stored: string): string {
  const [v, iv, tag, ct] = stored.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("The stored Canvas token isn't in a form Orca wrote.");
  const decipher = createDecipheriv("aes-256-gcm", tokenKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

/* ── The connection ── */

/** The site's origin, if it's an https host on the public internet (the token is sent there). */
export async function canvasSite(input: string, lookup: (host: string) => Promise<string[]> = async (h) => (await dnsLookup(h, { all: true })).map((a) => a.address)): Promise<string> {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new CanvasError(400, "Enter the Canvas site's address, like https://courseworks2.columbia.edu.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new CanvasError(400, "The Canvas site must be an https address with no path, like https://courseworks2.columbia.edu.");
  }
  const host = url.hostname.toLowerCase();
  const addresses = isIP(host) ? [host] : await lookup(host).catch(() => []);
  if (!addresses.length || !addresses.every(isPublicAddress)) throw new CanvasError(400, "That isn't a Canvas site Orca can reach.");
  return url.origin;
}

export interface ConnectionStatus {
  connected: boolean;
  baseUrl: string | null;
  canvasUser: string | null;
  lastUsedAt: string | null;
}

export async function connectionStatus(db: OrcaSupabase, ownerId: string): Promise<ConnectionStatus> {
  const { data, error } = await db.from("canvas_connections").select("base_url, canvas_user, last_used_at").eq("owner_id", ownerId).maybeSingle();
  if (error) throw new Error(`Couldn't read the Canvas connection: ${error.message}`);
  return { connected: data !== null, baseUrl: data?.base_url ?? null, canvasUser: data?.canvas_user ?? null, lastUsedAt: data?.last_used_at ?? null };
}

/** Check the token against Canvas (`/users/self`) and store it. */
export async function saveConnection(db: OrcaSupabase, ownerId: string, baseUrl: string, token: string, fetchImpl?: typeof fetch): Promise<{ canvasUser: string }> {
  const site = await canvasSite(baseUrl);
  const trimmed = token.trim();
  if (!/^[A-Za-z0-9~_\-.]{20,300}$/.test(trimmed)) throw new CanvasError(400, "That doesn't look like a Canvas access token.");
  const me = await canvasClient({ baseUrl: site, token: trimmed, fetch: fetchImpl }).get<CanvasUser>("/users/self");
  const { error } = await db.from("canvas_connections").upsert({ owner_id: ownerId, base_url: site, token_enc: encryptToken(trimmed), canvas_user: me.name, created_at: new Date().toISOString(), last_used_at: null });
  if (error) throw new Error(`Couldn't save the Canvas connection: ${error.message}`);
  return { canvasUser: me.name };
}

export async function revokeConnection(db: OrcaSupabase, ownerId: string): Promise<void> {
  const { error } = await db.from("canvas_connections").delete().eq("owner_id", ownerId);
  if (error) throw new Error(`Couldn't disconnect Canvas: ${error.message}`);
}

/** The student's client, or null when Canvas isn't connected. */
export async function clientFor(db: OrcaSupabase, ownerId: string, fetchImpl?: typeof fetch): Promise<CanvasClient | null> {
  const { data, error } = await db.from("canvas_connections").select("base_url, token_enc").eq("owner_id", ownerId).maybeSingle();
  if (error) throw new Error(`Couldn't read the Canvas connection: ${error.message}`);
  if (!data) return null;
  await db.from("canvas_connections").update({ last_used_at: new Date().toISOString() }).eq("owner_id", ownerId);
  // Every hop (API calls, downloads, their redirects) must resolve to a public address, checked at use.
  return canvasClient({ baseUrl: data.base_url, token: decryptToken(data.token_enc), fetch: fetchImpl, hopAllowed: (u) => publicHop(u) });
}

/* ── Courses ── */

export interface CanvasCourseLine {
  id: string;
  name: string;
  code: string | null;
  term: string | null;
  /** The Orca course it was imported into, if any. */
  linkedCourseId: string | null;
}

type LinkKind = "course" | "file" | "assignment" | "syllabus";

async function links(db: OrcaSupabase, ownerId: string): Promise<Map<string, string>> {
  const [linked, deleted] = await Promise.all([
    db.from("canvas_links").select("kind, canvas_id, orca_id").eq("owner_id", ownerId),
    db.from("courses").select("id").eq("owner_id", ownerId).not("deleted_at", "is", null),
  ]);
  if (linked.error) throw new Error(`Couldn't read what was imported before: ${linked.error.message}`);
  if (deleted.error) throw new Error(`Couldn't read the deleted courses: ${deleted.error.message}`);
  // A Canvas course imported into a course the student since deleted counts as never imported.
  const gone = new Set(deleted.data.map((c) => c.id));
  return new Map(linked.data.filter((l) => !(l.kind === "course" && gone.has(l.orca_id))).map((l) => [`${l.kind}:${l.canvas_id}`, l.orca_id]));
}

async function link(db: OrcaSupabase, ownerId: string, kind: LinkKind, canvasId: string, orcaId: string) {
  const { error } = await db.from("canvas_links").upsert({ owner_id: ownerId, kind, canvas_id: canvasId, orca_id: orcaId });
  if (error) throw new Error(`Couldn't record the import: ${error.message}`);
}

export async function listCanvasCourses(db: OrcaSupabase, ownerId: string, client: CanvasClient): Promise<CanvasCourseLine[]> {
  const [courses, linked] = await Promise.all([client.getAll<CanvasCourse>("/courses", { enrollment_state: "active", "include[]": ["term"] }), links(db, ownerId)]);
  return courses
    .filter((c) => typeof c.name === "string" && c.workflow_state !== "deleted")
    .map((c) => ({ id: String(c.id), name: c.name, code: c.course_code ?? null, term: c.term?.name ?? null, linkedCourseId: linked.get(`course:${c.id}`) ?? null }));
}

/* ── Importing one course ── */

export interface ImportSummary {
  course: { id: string; slug: string; name: string; created: boolean };
  exams: number;
  events: number;
  syllabus: boolean;
  files: {
    added: number;
    duplicates: number;
    failed: number;
    skipped: number;
    remaining: number;
    /** Files this round couldn't pull (a timeout, a storage error): not linked, so the next import tries them again. */
    skippedNames: string[];
    total: number;
    /** The files now in the course from this import, in Canvas order (added and already-there ones), for "How far has the class got?". */
    items: Array<{ materialId: string; name: string; upcoming: boolean }>;
    /** The files were posted all at once, so they wait as `upcoming` until the student says which are covered. */
    askCoverage: boolean;
  };
}

export interface ImportOptions {
  /** Stop pulling files once this many ms have passed; the rest is reported as `remaining`. */
  budgetMs?: number;
  now?: () => Date;
  /** The student's IANA timezone for due, unlock and posting dates; UTC when absent. */
  timeZone?: string;
}

async function orcaCourseFor(db: OrcaSupabase, ownerId: string, course: CanvasCourse, linked: Map<string, string>): Promise<{ id: string; slug: string; name: string; created: boolean }> {
  const existingId = linked.get(`course:${course.id}`);
  if (existingId) {
    const { data, error } = await db.from("courses").select("id, slug, name").eq("owner_id", ownerId).eq("id", existingId).is("deleted_at", null).maybeSingle();
    if (error) throw new Error(`Couldn't read the course: ${error.message}`);
    if (data) return { ...data, created: false };
  }
  const { data: mine, error } = await db.from("courses").select("id, slug").eq("owner_id", ownerId).is("deleted_at", null).order("created_at");
  if (error) throw new Error(`Couldn't read the courses: ${error.message}`);
  const name = sanitize(course.name, COURSE_NAME_MAX).text.trim().slice(0, COURSE_NAME_MAX) || "Canvas course";
  const taken = mine.map((c) => c.slug);
  const base = slugify(name) || "course";
  let slug = base;
  for (let n = 2; taken.includes(slug); n++) slug = `${base}-${n}`;
  const id = crypto.randomUUID();
  const pos = placeIslands([...mine.map((c) => c.id), id])[mine.length];
  const row = { id, owner_id: ownerId, slug, name, short: shortName(name), variant: VARIANT_CYCLE[mine.length % VARIANT_CYCLE.length], pos_x: pos.x, pos_y: pos.y, trail: null, review_config: null, schedule: null };
  const inserted = await db.from("courses").insert(row);
  if (inserted.error) throw new Error(`Couldn't create the course: ${inserted.error.message}`);
  await link(db, ownerId, "course", String(course.id), id);
  return { id, slug, name, created: true };
}

async function importAssignments(db: OrcaSupabase, ownerId: string, courseId: string, assignments: CanvasAssignment[], linked: Map<string, string>, timeZone?: string): Promise<{ exams: number; events: number }> {
  let exams = 0;
  let events = 0;
  for (const a of assignments) {
    const date = dayOf(a.due_at, timeZone);
    if (!date || linked.has(`assignment:${a.id}`)) continue;
    const title = sanitize(a.name, 120).text.trim().slice(0, 120) || "Assignment";
    const kind = classifyAssignment(title);
    const id = crypto.randomUUID();
    if (kind === "exam") {
      const { error } = await db.from("exams").insert({ id, owner_id: ownerId, course_id: courseId, title, date, topic_ids: [] });
      if (error) throw new Error(`Couldn't add the exam: ${error.message}`);
      exams++;
    } else {
      const { error } = await db.from("calendar_events").insert({ id, owner_id: ownerId, date, kind, title, course_id: courseId, material_id: null });
      if (error) throw new Error(`Couldn't add the calendar entry: ${error.message}`);
      events++;
    }
    await link(db, ownerId, "assignment", String(a.id), id);
    linked.set(`assignment:${a.id}`, id);
  }
  return { exams, events };
}

async function importSyllabus(db: OrcaSupabase, ownerId: string, courseId: string, course: CanvasCourse, linked: Map<string, string>): Promise<boolean> {
  if (linked.has(`syllabus:${course.id}`)) return false;
  const text = sanitize(htmlToText(course.syllabus_body ?? ""), 180_000).text;
  if (text.length < 80) return false;
  const id = crypto.randomUUID();
  const hash = createHash("sha256").update(`canvas-syllabus:${course.id}:${text}`).digest("hex");
  const { error } = await db.from("materials").insert({ id, owner_id: ownerId, course_id: courseId, filename: "Syllabus (Canvas)", type: "Syllabus", assigned: null, due: null, reflect: false, status: "ready", content_hash: hash, mime: "text/html" });
  if (error) {
    if (error.code === "23505") return false; // the same text is already in the course
    throw new Error(`Couldn't save the syllabus: ${error.message}`);
  }
  const pages = await db.from("material_pages").insert([{ owner_id: ownerId, material_id: id, n: 1, text }]);
  if (pages.error) throw new Error(`Couldn't store the syllabus: ${pages.error.message}`);
  await link(db, ownerId, "syllabus", String(course.id), id);
  await startUploadJob(db, ownerId, id);
  return true;
}

type FileResult = "added" | "duplicate" | "failed" | "skipped";

async function importFile(db: OrcaSupabase, ownerId: string, courseId: string, client: CanvasClient, pick: PickedFile, upcoming: boolean): Promise<{ result: FileResult; materialId: string | null }> {
  const file = pick.file ?? (await client.get<CanvasFile>(`/files/${pick.id}`).catch((e: unknown) => (e instanceof CanvasError ? null : Promise.reject(e))));
  if (!file || file.locked_for_user) return { result: "skipped", materialId: null };
  if ((file.size ?? 0) > LIMITS.uploadBytes) return { result: "skipped", materialId: null };
  const kind = uploadKind(file.display_name, file["content-type"] ?? "");
  if (!kind) return { result: "skipped", materialId: null };
  let bytes: Uint8Array;
  try {
    bytes = await client.download(file.url, LIMITS.uploadBytes);
  } catch (e) {
    if (e instanceof CanvasError) return { result: "skipped", materialId: null };
    throw e;
  }
  const hash = createHash("sha256").update(bytes).digest("hex");
  const started = await startUpload(db, ownerId, {
    courseId,
    filename: sanitize(file.display_name, 255).text.trim().slice(0, 255) || `canvas-${file.id}.${kind}`,
    size: bytes.byteLength,
    mime: UPLOAD_MIMES[kind],
    hash,
    type: pick.type,
    assigned: pick.assigned,
    due: null,
    reflect: false,
    handwritten: false,
    upcoming,
  });
  if (started.status === 200 && "duplicate" in started.body) return { result: "duplicate", materialId: started.body.duplicate.id };
  if (started.status !== 201 || !("upload" in started.body)) return { result: "skipped", materialId: null };
  const { material, upload } = started.body;
  const put = await db.storage.from(BUCKET).upload(upload.path, bytes, { contentType: UPLOAD_MIMES[kind], upsert: true });
  if (put.error) throw new Error(`Couldn't store ${file.display_name}: ${put.error.message}`);
  const processed = await processUpload(db, ownerId, material.id);
  if (processed.status === 200 && "duplicate" in processed.body) return { result: "duplicate", materialId: processed.body.duplicate.id };
  if (processed.status === 200) {
    await startUploadJob(db, ownerId, material.id);
    return { result: "added", materialId: material.id };
  }
  // Marked failed with why by processUpload (an unreadable file); it shows on the Uploads tab.
  return { result: "failed", materialId: material.id };
}

const optional = async <T>(p: Promise<T[]>): Promise<T[]> => p.catch((e: unknown) => (e instanceof CanvasError && (e.status === 403 || e.status === 404 || e.status === 401) ? [] : Promise.reject(e)));

export async function importCanvasCourse(db: OrcaSupabase, ownerId: string, client: CanvasClient, canvasCourseId: string, options: ImportOptions = {}): Promise<ImportSummary> {
  const now = options.now ?? (() => new Date());
  const startedAt = now().getTime();
  const budgetMs = options.budgetMs ?? 200_000;
  const known = await links(db, ownerId);
  const course = await client.get<CanvasCourse>(`/courses/${encodeURIComponent(canvasCourseId)}`, { "include[]": ["syllabus_body", "term"] });
  const orca = await orcaCourseFor(db, ownerId, course, known);
  // A new Orca course starts with nothing imported: links left from an earlier import went to a course since deleted.
  const linked = orca.created ? new Map<string, string>() : known;

  const [assignments, modules, files] = await Promise.all([
    optional(client.getAll<CanvasAssignment>(`/courses/${course.id}/assignments`)),
    optional(client.getAll<CanvasModule>(`/courses/${course.id}/modules`, { "include[]": ["items"] })),
    optional(client.getAll<CanvasFile>(`/courses/${course.id}/files`)),
  ]);
  const dates = await importAssignments(db, ownerId, orca.id, assignments, linked, options.timeZone);
  const syllabus = await importSyllabus(db, ownerId, orca.id, course, linked);

  const picks = pickFiles(modules, files, options.timeZone).filter((p) => !linked.has(`file:${p.id}`));
  // Posted all at once, nothing says how far the class has got: the files wait until the student says (the plan's
  // assumption 1, corrected by the owner). Posted over the weeks, each file was posted as the class reached it,
  // except one whose module opens in the future.
  const dump = postedAtOnce(picks);
  const today = dayOf(now().toISOString(), options.timeZone)!;
  const counts: ImportSummary["files"] = { added: 0, duplicates: 0, failed: 0, skipped: 0, remaining: 0, skippedNames: [], total: picks.length, items: [], askCoverage: dump };
  for (const pick of picks) {
    if (now().getTime() - startedAt > budgetMs) {
      counts.remaining++;
      continue;
    }
    const upcoming = dump || (pick.assigned !== null && pick.assigned > today);
    let outcome: { result: FileResult; materialId: string | null };
    try {
      outcome = await importFile(db, ownerId, orca.id, client, pick, upcoming);
    } catch (e) {
      // One file's trouble (a download timeout, a Storage error) shouldn't lose the round: it's
      // named as skipped and left unlinked, so the next import tries it again (2026-11-08).
      if (e instanceof CanvasError && e.status === 401) throw e;
      counts.skipped++;
      counts.skippedNames.push(pick.name);
      continue;
    }
    const { result, materialId } = outcome;
    if (result === "added") counts.added++;
    else if (result === "duplicate") counts.duplicates++;
    else if (result === "failed") counts.failed++;
    else counts.skipped++;
    // One entry per material: two Canvas files with the same bytes are one upload.
    if ((result === "added" || result === "duplicate") && materialId && !counts.items.some((it) => it.materialId === materialId)) counts.items.push({ materialId, name: pick.name, upcoming: result === "added" && upcoming });
    // Linked even when skipped or failed: a file Orca can't read isn't tried again on every import.
    await link(db, ownerId, "file", String(pick.id), materialId ?? orca.id);
  }
  return { course: orca, exams: dates.exams, events: dates.events, syllabus, files: counts };
}
