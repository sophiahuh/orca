/**
 * What Orca reads from Canvas (the LMS behind Columbia's CourseWorks) and the decisions it makes
 * about it, as pure functions: which assignments are exams, what type a file is, which files to
 * pull and in what order, and the date a file counts as assigned. Loads under plain Node.
 * Plan: docs/superpowers/plans/2026-11-04-canvas-import.md.
 */
import type { MaterialType } from "../data.ts";
import { uploadKind } from "../material/kind.ts";

/* ── Canvas's shapes, only the fields Orca reads ── */

export interface CanvasUser {
  id: number;
  name: string;
}

export interface CanvasTerm {
  id?: number;
  name?: string | null;
}

export interface CanvasCourse {
  id: number;
  name: string;
  course_code?: string | null;
  workflow_state?: string;
  term?: CanvasTerm | null;
  /** HTML; present only when asked for (`include[]=syllabus_body`). */
  syllabus_body?: string | null;
}

export interface CanvasFile {
  id: number;
  display_name: string;
  filename?: string;
  "content-type"?: string;
  size?: number;
  /** Download URL (a signed redirect to storage; needs no token once followed). */
  url: string;
  created_at?: string | null;
  updated_at?: string | null;
  locked_for_user?: boolean;
}

export interface CanvasModuleItem {
  id: number;
  type: string;
  title: string;
  position?: number;
  /** For a File item: the file's id. */
  content_id?: number;
}

export interface CanvasModule {
  id: number;
  name: string;
  position?: number;
  unlock_at?: string | null;
  items?: CanvasModuleItem[];
}

export interface CanvasAssignment {
  id: number;
  name: string;
  due_at: string | null;
  points_possible?: number | null;
}

/* ── Decisions ── */

/** YYYY-MM-DD of an ISO time (the UTC day; Canvas due times are stored in UTC), or null for none. */
export function dayOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

export type AssignmentKind = "exam" | "lab" | "hw";

/** An exam, a lab, or homework, from the assignment's name (the plan's assumption 2). */
export function classifyAssignment(name: string): AssignmentKind {
  if (/\b(exam|midterm|final|quiz|test)\b/i.test(name)) return "exam";
  if (/\blab\b/i.test(name)) return "lab";
  return "hw";
}

/** The material type a Canvas file most likely is, from its name and its module's (assumption 3). */
export function materialTypeFor(filename: string, moduleName?: string | null): MaterialType {
  // Underscores, dashes and dots separate words in file names ("midterm_2018.pdf").
  const words = (s: string) => s.replace(/[_\-.]+/g, " ");
  const name = words(filename);
  const text = `${words(moduleName ?? "")} ${name}`;
  if (/syllabus/i.test(name)) return "Syllabus";
  if (/\b(solutions?|answers?|answer key)\b/i.test(name)) return "Practice problems";
  if (/\b(practice|sample|mock)\s*(exams?|midterms?|finals?|tests?)\b/i.test(text)) return "Practice exam";
  if (/\b(exams?|midterms?|finals?)\b/i.test(text)) return "Past exam";
  if (/\b(homework|problem\s*sets?|psets?|hw)\s*\d*\b/i.test(text) || /\bassignments?\b/i.test(name)) return "Homework";
  return "Lecture";
}

export interface PickedFile {
  /** Canvas's file id, as the link key. */
  id: number;
  name: string;
  /** The file's record when it was in the course's file list; null when only a module named it. */
  file: CanvasFile | null;
  module: string | null;
  /** The module's unlock date, else the file's creation date, else null (assumption 4). */
  assigned: string | null;
  type: MaterialType;
}

/**
 * The course's readable files (PDF and .pptx), modules first in their order (that's how the class
 * met them), then the rest of the file list by the number in their names, then creation date (see
 * `sequenceNumber`); one entry per Canvas file. A module
 * item whose file isn't in the list (the Files tab is hidden, say) is kept with `file: null` for
 * the caller to look up.
 */
export function pickFiles(modules: readonly CanvasModule[], files: readonly CanvasFile[]): PickedFile[] {
  const byId = new Map(files.map((f) => [f.id, f]));
  const seen = new Set<number>();
  const out: PickedFile[] = [];
  const add = (id: number, name: string, file: CanvasFile | null, module: CanvasModule | null) => {
    if (seen.has(id)) return;
    const mime = file?.["content-type"] ?? "";
    if (!uploadKind(name, mime)) return;
    seen.add(id);
    out.push({
      id,
      name,
      file,
      module: module?.name ?? null,
      assigned: dayOf(module?.unlock_at) ?? dayOf(file?.created_at),
      type: materialTypeFor(name, module?.name),
    });
  };
  const ordered = [...modules].sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id - b.id);
  for (const m of ordered) {
    const items = [...(m.items ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id - b.id);
    for (const it of items) {
      if (it.type !== "File" || typeof it.content_id !== "number") continue;
      const file = byId.get(it.content_id) ?? null;
      add(it.content_id, file?.display_name ?? it.title, file, m);
    }
  }
  const loose = [...files].sort((a, b) => looseOrder(a) - looseOrder(b) || (Date.parse(a.created_at ?? "") || 0) - (Date.parse(b.created_at ?? "") || 0) || a.id - b.id);
  for (const f of loose) if (!f.locked_for_user) add(f.id, f.display_name, f, null);
  return out;
}

/**
 * The lecture or week number a filename carries ("L03_Counters.pdf", "Lecture 3", "Week 2 slides",
 * "03-karnaugh.pdf"), or null. Files not in a module are imported in this order before their
 * posting date (owner, 2026-11-07): a professor who posts Lecture 5 before 4, or re-posts an early
 * one, shouldn't reorder the course. Files with no number keep their posting-date order after them.
 */
export function sequenceNumber(name: string): number | null {
  const stem = name.replace(/\.[A-Za-z0-9]+$/, "");
  const m = /(?:^|[\s_-])(?:l|lec|lecture|lect|w|wk|week|ch|chapter|class|day|session|unit|module|part)[\s_-]?0*(\d{1,3})(?=$|[\s_.)-])/i.exec(stem) ?? /^\s*0*(\d{1,3})(?=[\s_.)-])/.exec(stem);
  return m ? Number(m[1]) : null;
}

const looseOrder = (f: CanvasFile) => sequenceNumber(f.display_name) ?? Number.POSITIVE_INFINITY;

/**
 * Whether the course's files were posted all at once (three or more, created within three days of
 * each other): then nothing says how far the class has got, and the files are imported as
 * `upcoming` until the student taps the last one covered. Files posted over weeks were posted as
 * the class reached them. Owner, 2026-11-04: "some profs upload nothing, others upload
 * everything from the jump."
 */
export function postedAtOnce(picks: readonly PickedFile[]): boolean {
  const times = picks.map((p) => Date.parse(p.file?.created_at ?? "")).filter((t) => !Number.isNaN(t));
  if (picks.length < 3 || times.length < picks.length) return false;
  return Math.max(...times) - Math.min(...times) <= 3 * 24 * 3600_000;
}

/** A syllabus page's text, as the model will see it: tags, scripts and entities gone, lines kept. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<\/(?:p|div|li|h[1-6]|tr|br)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

/** The `next` URL of a Canvas `Link` header, or null on the last page. */
export function parseNextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const m = /<([^>]+)>\s*;\s*rel="?next"?/.exec(part.trim());
    if (m) return m[1];
  }
  return null;
}
