import { createHash } from "node:crypto";
import { z } from "zod";
import { MATERIAL_TYPES, type MaterialType } from "@/lib/data";
import { aiChatFilename, chatPages, chatTextFromHtml, isAIChatHost, isPublicAIChatUrl, normaliseAIChatTranscript, pastedFilename, spokenChars, textPages } from "@/lib/material/ai-chat";
import { LIMITS } from "@/lib/limits";
import { sanitize } from "@/lib/untrusted/sanitize";
import { materialFromRow } from "@/lib/supabase/app-rows";
import { startUploadJob } from "@/lib/server/jobs/start";
import { fetchPublicPage } from "@/lib/server/public-page";
import { ownsCourse, forStudent, reply } from "@/lib/server/student";

/**
 * Pasted text as material (owner, 2026-11-07: one paste box; the type decides how it's read): a
 * syllabus, notes, or an exported AI chat. A public AI-chat link is also taken here; it is always
 * an "AI chat". Only that type gets the transcript treatment (speakers labelled, the header that
 * tells the model how to weigh them); any other text is stored as it was pasted.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const requestSchema = z.object({
  courseId: z.uuid(), type: z.enum(MATERIAL_TYPES as [MaterialType, ...MaterialType[]]),
  assigned: date, due: date, text: z.string().trim().optional(), url: z.string().trim().max(2048).optional(),
}).refine((value) => Boolean(value.text || value.url), { message: "Paste some text or enter a public AI chat link." });

export async function POST(request: Request) {
  return forStudent(request, async (student, db) => {
    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return reply(400, { error: "Paste some text or enter a public AI chat link." });
    if (!(await ownsCourse(db, student.id, parsed.data.courseId))) return reply(404, { error: "No such course." });

    let text: string;
    let sourceUrl: string | undefined;
    let type = parsed.data.type;
    if (parsed.data.url) {
      if (!isPublicAIChatUrl(parsed.data.url)) return reply(400, { error: "Use a public ChatGPT, Claude, or Gemini shared-chat link, or paste the text instead." });
      sourceUrl = parsed.data.url;
      type = "AI chat";
      const page = await fetchPublicPage(sourceUrl, { allowHost: isAIChatHost, userAgent: "Orca AI-chat material importer" });
      if (!page.ok) return reply(422, { error: page.reason === "unreachable" ? "Orca couldn't fetch that public AI chat. Paste its transcript instead." : page.reason === "too-big" ? "That AI chat page is too large to read. Paste its transcript instead." : "That link needs to be a publicly viewable AI chat." });
      text = chatTextFromHtml(page.html);
    } else {
      text = type === "AI chat" ? normaliseAIChatTranscript(parsed.data.text!) : parsed.data.text!;
    }
    const chat = type === "AI chat";
    // Stored as the model will see it (decision 13): invisible and control characters removed.
    text = sanitize(text).text;
    if ((chat ? spokenChars(text) : text.trim().length) < 80) return reply(422, { error: chat ? "Orca couldn't find enough readable chat text. Paste the conversation transcript instead." : "Orca needs at least a paragraph of text to read." });
    const pages = (chat ? chatPages(text) : textPages(text)).map((pageText, i) => ({ n: i + 1, text: pageText }));
    // Jobs read at most this many pages of any material, so longer text is refused, never cut.
    if (pages.length > LIMITS.pagesPerFile) return reply(413, { error: `This text is too long to read in one go (${pages.length} pages; Orca reads at most ${LIMITS.pagesPerFile}). Paste it in parts.` });
    const filename = sourceUrl ? aiChatFilename(sourceUrl) : pastedFilename(type);
    const hash = createHash("sha256").update(text).digest("hex");
    const { data: same, error: sameError } = await db.from("materials").select("id, filename").eq("owner_id", student.id).eq("course_id", parsed.data.courseId).eq("content_hash", hash).order("created_at").limit(1).maybeSingle();
    if (sameError) return reply(500, { error: "Orca couldn't check that text." });
    if (same) return reply(200, { duplicate: same, generation: await startUploadJob(db, student.id, same.id) });
    const id = crypto.randomUUID();
    const { data, error } = await db.from("materials").insert({ id, owner_id: student.id, course_id: parsed.data.courseId, filename, type, assigned: parsed.data.assigned, due: parsed.data.due, reflect: false, status: "ready", content_hash: hash, mime: "text/plain" }).select().single();
    if (error) return reply(500, { error: "Orca couldn't save that text." });
    const saved = await db.from("material_pages").insert(pages.map((p) => ({ owner_id: student.id, material_id: id, ...p })));
    if (saved.error) return reply(500, { error: "Orca saved that text but couldn't read it." });
    return reply(201, { material: materialFromRow(data), pages, generation: await startUploadJob(db, student.id, id) });
  });
}
