"use client";

/**
 * The browser's side of uploads (Phase 4 plan, decision 7): hash the file, ask
 * POST /api/materials for a signed upload URL (or learn the course already has it), send the file
 * straight to Storage, then have the server read it (POST /api/materials/:id/process), which also
 * starts the job that builds its questions (`generation`). The limits are checked here only to say
 * so sooner; the server checks them again.
 */
import type { Material, MaterialPages, MaterialType } from "./data";
import { LIMITS } from "./limits";
import { browserSupabase } from "./supabase/browser";

/** A sentence about the hidden text the server dropped from a file, or null when there was none. */
export function hiddenNote(hidden: Material["hiddenText"]): string | null {
  if (!hidden?.items) return null;
  const slides = hidden.pages.length === 1 ? `slide ${hidden.pages[0]}` : `slides ${hidden.pages.join(", ")}`;
  return `Orca skipped ${hidden.items} piece${hidden.items === 1 ? "" : "s"} of text hidden in this file (too small to see, on ${slides}). Hidden text is a way to slip instructions to an AI.`;
}

export type UploadStage = "hashing" | "uploading" | "reading";

export interface UploadMeta {
  courseId: string;
  type: MaterialType;
  assigned: string | null;
  due: string | null;
  reflect: boolean;
}

/** What happens to an upload's questions (`Generation` in src/lib/server/jobs/start.ts). */
export type Generation =
  | { state: "started" | "running" | "built"; runId: string }
  | { state: "queued" | "waiting"; runId: string }
  | { state: "no-model" }
  | { state: "no-text" };

export type UploadOutcome =
  | { kind: "read"; material: Material; pages: MaterialPages; hidden: { items: number; pages: number[] }; generation: Generation }
  | { kind: "duplicate"; id: string; filename: string; generation: Generation };

/** Read one public, server-rendered course website as material. */
export async function importWebsite(url: string, meta: UploadMeta): Promise<Extract<UploadOutcome, { kind: "read" }>> {
  return post<Extract<UploadOutcome, { kind: "read" }>>("/api/materials/web", { ...meta, url });
}

async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const out = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  // The status code means nothing to a student; the route's own message, when it sent one, does.
  if (!res.ok) throw new Error(out?.error ?? "The upload didn't go through. Try again in a moment.");
  if (out === null) throw new Error("the server sent nothing back");
  return out;
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** What's wrong with a file before it's sent, or null. */
export function uploadProblem(file: File): string | null {
  if (file.type !== LIMITS.uploadMime && !/\.pdf$/i.test(file.name)) return "Only PDFs can be read for now.";
  if (file.size > LIMITS.uploadBytes) return `This file is over ${LIMITS.uploadBytes / 1024 / 1024} MB.`;
  if (file.size === 0) return "This file is empty.";
  return null;
}

/** `onStarted` gets the material's id as soon as the server has made it (the page keeps it in its URL, so a reload can follow it). */
export async function uploadMaterial(file: File, meta: UploadMeta, onStage: (s: UploadStage) => void, onStarted?: (materialId: string) => void): Promise<UploadOutcome> {
  const problem = uploadProblem(file);
  if (problem) throw new Error(problem);
  onStage("hashing");
  const hash = await sha256(file);
  type Duplicate = { duplicate: { id: string; filename: string }; generation: Generation };
  type Started = { material: Material; upload: { path: string; token: string } } | Duplicate;
  const started = await post<Started>("/api/materials", { ...meta, filename: file.name, size: file.size, mime: file.type || LIMITS.uploadMime, hash });
  if ("duplicate" in started) return { kind: "duplicate", ...started.duplicate, generation: started.generation };
  onStarted?.(started.material.id);

  onStage("uploading");
  // Storage takes the type from the body itself, and some systems give a PDF no type (or a generic one).
  const body = new Blob([file], { type: LIMITS.uploadMime });
  const sent = await browserSupabase().storage.from("materials").uploadToSignedUrl(started.upload.path, started.upload.token, body, { contentType: LIMITS.uploadMime });
  if (sent.error) throw new Error(`Couldn't upload the file: ${sent.error.message}`);

  onStage("reading");
  type Processed = { material: Material; pages: MaterialPages; hidden: { items: number; pages: number[] }; generation: Generation } | Duplicate;
  const processed = await post<Processed>(`/api/materials/${started.material.id}/process`);
  if ("duplicate" in processed) return { kind: "duplicate", ...processed.duplicate, generation: processed.generation };
  return { kind: "read", ...processed };
}
