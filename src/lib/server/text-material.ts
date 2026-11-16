import { stagedPipeline, pipelineRpc } from "./staged/db";
import { singleton } from "./staged/admission";
/**
 * Pasted text (or a public AI-chat link) as material: what `POST /api/materials/text` does once the
 * request is parsed, shared with the connector's `add_material` (docs/superpowers/specs/
 * 2026-11-10-cram-mode-contracts.md, section 4) so both store the text the same way. Owner,
 * 2026-11-07: one paste box; the type decides how it's read. Only an "AI chat" gets the transcript
 * treatment (speakers labelled, the header that tells the model how to weigh them); any other text
 * is stored as it was pasted. The result carries the HTTP status the route answers with.
 */
import { createHash } from "node:crypto";
import type { Material, MaterialType } from "@/lib/data";
import { aiChatFilename, chatPages, chatTextFromHtml, isAIChatHost, isPublicAIChatUrl, normaliseAIChatTranscript, pastedFilename, spokenChars, textPages } from "@/lib/material/ai-chat";
import { LIMITS } from "@/lib/limits";
import { sanitize } from "@/lib/untrusted/sanitize";
import { materialFromRow } from "@/lib/supabase/app-rows";
import { type Generation, startUploadJob } from "@/lib/server/jobs/start";
import { fetchPublicPage } from "@/lib/server/public-page";
import { rateLimit, type RateVerdict } from "@/lib/server/rate-limit";
import { ownsCourse } from "@/lib/server/student";
import type { OrcaSupabase } from "@/lib/supabase/server";

export interface TextMaterialInput {
  courseId: string;
  type: MaterialType;
  assigned: string | null;
  due: string | null;
  /** The text as pasted (trimmed); or `url`, a public AI-chat link. */
  text?: string;
  url?: string;
  /** Kept for a practice test: mapped to objectives, never used to write questions, never shown (section 5, hold-back). */
  heldBack: boolean;
  /** What to call it; else named after the type and the day ("Syllabus (pasted), Nov 7"). */
  filename?: string;
}

export type TextMaterialOutcome =
  | { status: 201; body: { material: Material; pages: Array<{ n: number; text: string }>; generation: Generation } }
  | { status: 200; body: { duplicate: { id: string; filename: string }; generation: Generation } }
  | { status: 429; body: { error: string; retryAfterSeconds: number }; verdict: Extract<RateVerdict, { ok: false }> }
  | { status: 400 | 404 | 413 | 422 | 500; body: { error: string } };

export async function addTextMaterial(db: OrcaSupabase, ownerId: string, input: TextMaterialInput): Promise<TextMaterialOutcome> {
  if (!(await ownsCourse(db, ownerId, input.courseId))) return { status: 404, body: { error: "No such course." } };
  const rate = await rateLimit(db, ownerId, "text");
  if (!rate.ok) return { status: 429, body: { error: rate.message, retryAfterSeconds: rate.retryAfterSeconds }, verdict: rate };

  const admissionId = stagedPipeline() ? crypto.randomUUID() : undefined;
  if (admissionId) await singleton(db, ownerId, input.courseId, admissionId, input.filename ?? "Pasted material", "text");
  let attached = false;
  try {
  let text: string;
  let sourceUrl: string | undefined;
  let type = input.type;
  if (input.url) {
    if (!isPublicAIChatUrl(input.url)) return { status: 400, body: { error: "Use a public ChatGPT, Claude, or Gemini shared-chat link, or paste the text instead." } };
    sourceUrl = input.url;
    type = "AI chat";
    const page = await fetchPublicPage(sourceUrl, { allowHost: isAIChatHost, userAgent: "Orca AI-chat material importer" });
    if (!page.ok) return { status: 422, body: { error: page.reason === "unreachable" ? "Orca couldn't fetch that public AI chat. Paste its transcript instead." : page.reason === "too-big" ? "That AI chat page is too large to read. Paste its transcript instead." : "That link needs to be a publicly viewable AI chat." } };
    text = chatTextFromHtml(page.html);
  } else {
    text = type === "AI chat" ? normaliseAIChatTranscript(input.text ?? "") : (input.text ?? "");
  }
  const chat = type === "AI chat";
  // Stored as the model will see it (decision 13): invisible and control characters removed.
  text = sanitize(text).text;
  if ((chat ? spokenChars(text) : text.trim().length) < 80) return { status: 422, body: { error: chat ? "Orca couldn't find enough readable chat text. Paste the conversation transcript instead." : "Orca needs at least a paragraph of text to read." } };
  const pages = (chat ? chatPages(text) : textPages(text)).map((pageText, i) => ({ n: i + 1, text: pageText }));
  // Jobs read at most this many pages of any material, so longer text is refused, never cut.
  if (pages.length > LIMITS.pagesPerFile) return { status: 413, body: { error: `This text is too long to read in one go (${pages.length} pages; Orca reads at most ${LIMITS.pagesPerFile}). Paste it in parts.` } };
  const filename = input.filename ? sanitize(input.filename, 255).text.trim() || pastedFilename(type) : sourceUrl ? aiChatFilename(sourceUrl) : pastedFilename(type);
  const hash = createHash("sha256").update(text).digest("hex");
  const { data: same, error: sameError } = await db.from("materials").select("id, filename").eq("owner_id", ownerId).eq("course_id", input.courseId).eq("content_hash", hash).order("created_at").limit(1).maybeSingle();
  if (sameError) return { status: 500, body: { error: "Orca couldn't check that text." } };
  if (same) {
    const generation = await startUploadJob(db, ownerId, same.id, admissionId);
    attached = true;
    return { status: 200, body: { duplicate: same, generation } };
  }
  const id = crypto.randomUUID();
  const { data, error } = await db
    .from("materials")
    .insert({ id, owner_id: ownerId, course_id: input.courseId, filename, type, assigned: input.assigned, due: input.due, reflect: false, status: "ready", content_hash: hash, mime: "text/plain", held_back: input.heldBack })
    .select()
    .single();
  if (error) return { status: 500, body: { error: "Orca couldn't save that text." } };
  const saved = await db.from("material_pages").insert(pages.map((p) => ({ owner_id: ownerId, material_id: id, ...p })));
  if (saved.error) return { status: 500, body: { error: "Orca saved that text but couldn't read it." } };
  const generation = await startUploadJob(db, ownerId, id, admissionId);
  attached = true;
  return { status: 201, body: { material: materialFromRow(data), pages, generation } };
  } finally {
    if (admissionId && !attached) await pipelineRpc(db, "ingestion", { ownerId, itemId: admissionId, action: "fail", error: "The material could not be added. Try again." });
  }
}
