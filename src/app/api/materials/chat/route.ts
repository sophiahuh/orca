import { createHash } from "node:crypto";
import { z } from "zod";
import { aiChatFilename, chatTextFromHtml, isAIChatHost, isPublicAIChatUrl, normaliseAIChatTranscript, spokenChars } from "@/lib/material/ai-chat";
import { sanitize } from "@/lib/untrusted/sanitize";
import { materialFromRow } from "@/lib/supabase/app-rows";
import { startUploadJob } from "@/lib/server/jobs/start";
import { fetchPublicPage } from "@/lib/server/public-page";
import { ownsCourse, forStudent, reply } from "@/lib/server/student";

export const runtime = "nodejs";
export const maxDuration = 300;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const requestSchema = z.object({
  courseId: z.uuid(), type: z.enum(["Syllabus", "Lecture", "Handwritten notes", "Homework", "Past exam", "Practice exam", "Practice problems", "Other"]),
  assigned: date, due: date, text: z.string().trim().max(180_000).optional(), url: z.string().trim().max(2048).optional(),
}).refine((value) => Boolean(value.text || value.url), { message: "Paste a chat transcript or enter a public AI chat link." });

export async function POST(request: Request) {
  return forStudent(request, async (student, db) => {
    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return reply(400, { error: "Paste a chat transcript or enter a public AI chat link." });
    if (!(await ownsCourse(db, student.id, parsed.data.courseId))) return reply(404, { error: "No such course." });

    let text: string;
    let sourceUrl: string | undefined;
    if (parsed.data.url) {
      if (!isPublicAIChatUrl(parsed.data.url)) return reply(400, { error: "Use a public ChatGPT, Claude, or Gemini shared-chat link, or paste the transcript instead." });
      sourceUrl = parsed.data.url;
      const page = await fetchPublicPage(sourceUrl, { allowHost: isAIChatHost, userAgent: "Orca AI-chat material importer" });
      if (!page.ok) return reply(422, { error: page.reason === "unreachable" ? "Orca couldn't fetch that public AI chat. Paste its transcript instead." : page.reason === "too-big" ? "That AI chat page is too large to read. Paste its transcript instead." : "That link needs to be a publicly viewable AI chat." });
      text = chatTextFromHtml(page.html);
    } else {
      text = normaliseAIChatTranscript(parsed.data.text!);
    }
    // Stored as the model will see it (decision 13): invisible and control characters removed.
    text = sanitize(text, 180_000).text;
    if (spokenChars(text) < 80) return reply(422, { error: "Orca couldn't find enough readable chat text. Paste the conversation transcript instead." });
    const filename = aiChatFilename(sourceUrl);
    const hash = createHash("sha256").update(text).digest("hex");
    const { data: same, error: sameError } = await db.from("materials").select("id, filename").eq("owner_id", student.id).eq("course_id", parsed.data.courseId).eq("content_hash", hash).maybeSingle();
    if (sameError) return reply(500, { error: "Orca couldn't check that chat." });
    if (same) return reply(200, { duplicate: same, generation: await startUploadJob(db, student.id, same.id) });
    const id = crypto.randomUUID();
    const { data, error } = await db.from("materials").insert({ id, owner_id: student.id, course_id: parsed.data.courseId, filename, type: parsed.data.type, assigned: parsed.data.assigned, due: parsed.data.due, reflect: false, status: "ready", content_hash: hash, mime: "text/plain" }).select().single();
    if (error) return reply(500, { error: "Orca couldn't save that AI chat." });
    const saved = await db.from("material_pages").insert({ owner_id: student.id, material_id: id, n: 1, text });
    if (saved.error) return reply(500, { error: "Orca saved that AI chat but couldn't read it." });
    return reply(201, { material: materialFromRow(data), pages: [{ n: 1, text }], generation: await startUploadJob(db, student.id, id) });
  });
}
