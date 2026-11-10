import { z } from "zod";
import { MATERIAL_TYPES, type MaterialType } from "@/lib/data";
import { heldBackByDefault } from "@/lib/material/hold-back";
import { tooManyRequests } from "@/lib/server/rate-limit";
import { forStudent, reply } from "@/lib/server/student";
import { addTextMaterial } from "@/lib/server/text-material";

/**
 * Pasted text as material (owner, 2026-11-07: one paste box; the type decides how it's read): a
 * syllabus, notes, or an exported AI chat. A public AI-chat link is also taken here; it is always
 * an "AI chat". The work is `addTextMaterial` (src/lib/server/text-material.ts), shared with the
 * connector's add_material.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const requestSchema = z.object({
  courseId: z.uuid(), type: z.enum(MATERIAL_TYPES as [MaterialType, ...MaterialType[]]),
  assigned: date, due: date, text: z.string().trim().optional(), url: z.string().trim().max(2048).optional(),
  /** Kept hidden for a practice test (contract section 5); default: the type is Past exam or Practice exam. */
  heldBack: z.boolean().optional(),
}).refine((value) => Boolean(value.text || value.url), { message: "Paste some text or enter a public AI chat link." });

export async function POST(request: Request) {
  return forStudent(request, async (student, db) => {
    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return reply(400, { error: "Paste some text or enter a public AI chat link." });
    // Kept hidden for a practice test when asked, else by type (contract section 5, hold-back).
    const out = await addTextMaterial(db, student.id, { ...parsed.data, heldBack: parsed.data.heldBack ?? heldBackByDefault(parsed.data.type) });
    if (out.status === 429) return tooManyRequests(out.verdict);
    return reply(out.status, out.body);
  });
}
