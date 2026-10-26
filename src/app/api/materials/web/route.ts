import { createHash } from "node:crypto";
import { z } from "zod";
import { materialFromRow } from "@/lib/supabase/app-rows";
import { sanitize } from "@/lib/untrusted/sanitize";
import { startUploadJob } from "@/lib/server/jobs/start";
import { fetchPublicPage } from "@/lib/server/public-page";
import { forStudent, reply } from "@/lib/server/student";
import { ownsCourse } from "@/lib/server/student";

export const runtime = "nodejs";
export const maxDuration = 300;

const requestSchema = z.object({ courseId: z.uuid(), url: z.string().url().max(2048), type: z.enum(["Syllabus", "Lecture", "Other"]), assigned: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() });

function pageText(html: string) {
  const headings = [...html.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi)].map((m) => m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, " ").replace(/<\/(?:p|div|li|h[1-6]|tr|br)[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\n\s*\n+/g, "\n").replace(/[ \t]+/g, " ").trim();
  return `${headings.length ? `Likely section headings (from the course website): ${headings.slice(0, 40).join(" | ")}\n\n` : ""}${text}`.slice(0, 180_000);
}

export async function POST(request: Request) {
  return forStudent(request, async (student, db) => {
    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return reply(400, { error: "Enter a valid public course-page URL." });
    const url = new URL(parsed.data.url);
    if (!(await ownsCourse(db, student.id, parsed.data.courseId))) return reply(404, { error: "No such course." });
    const page = await fetchPublicPage(url.href, { schemes: ["https:", "http:"], userAgent: "Orca course-material importer" });
    if (!page.ok) {
      if (page.reason === "blocked") return reply(400, { error: "Use a public http(s) website." });
      return reply(422, { error: page.reason === "unreachable" ? "Orca couldn't fetch that public page." : page.reason === "too-big" ? "That page is too large to read." : "That link needs to be a public HTML course page." });
    }
    // Stored as the model will see it (decision 13): invisible and control characters removed.
    const text = sanitize(pageText(page.html), 180_000).text;
    if (text.length < 80) return reply(422, { error: "Orca couldn't find enough readable course text on that page." });
    const id = crypto.randomUUID();
    const filename = `${url.hostname}${url.pathname === "/" ? "" : url.pathname}`.slice(0, 255);
    const hash = createHash("sha256").update(url.href).digest("hex");
    const { data, error } = await db.from("materials").insert({ id, owner_id: student.id, course_id: parsed.data.courseId, filename, type: parsed.data.type, assigned: parsed.data.assigned, due: parsed.data.due, reflect: false, status: "ready", content_hash: hash, mime: "text/html" }).select().single();
    if (error) return reply(error.code === "23505" ? 409 : 500, { error: error.code === "23505" ? "That course page was already added." : "Orca couldn't save that website." });
    const pages = [{ owner_id: student.id, material_id: id, n: 1, text }];
    const inserted = await db.from("material_pages").insert(pages);
    if (inserted.error) return reply(500, { error: "Orca saved the website but couldn't read it." });
    return reply(201, { material: materialFromRow(data), pages: [{ n: 1, text }], generation: await startUploadJob(db, student.id, id) });
  });
}
