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
 * met them), then the rest of the file list by creation date; one entry per Canvas file. A module
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
  const loose = [...files].sort((a, b) => (Date.parse(a.created_at ?? "") || 0) - (Date.parse(b.created_at ?? "") || 0) || a.id - b.id);
  for (const f of loose) if (!f.locked_for_user) add(f.id, f.display_name, f, null);
  return out;
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
