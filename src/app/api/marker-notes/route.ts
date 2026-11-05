import { z } from "zod";
import { LIMITS } from "@/lib/limits";
import { acceptNotes } from "@/lib/server/notes";
import { forStudent, reply } from "@/lib/server/student";

/**
 * PUT { markers } → how the student marks confusion in their handwritten notes (weak points first,
 * Plan B): 200 { markers } (null clears it), 400 when refused. Screened like Notes for Orca; the page
 * reader gets it as a description, never instructions.
 */
export const runtime = "nodejs";

const Body = z.object({ markers: z.string().max(LIMITS.markerChars).nullable() });

export async function PUT(request: Request) {
  return forStudent(request, async (student, db) => {
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return reply(400, { error: `The description is at most ${LIMITS.markerChars} characters.` });
    const out = await acceptNotes(db, student.id, parsed.data.markers, { kind: "marker_notes", maxChars: LIMITS.markerChars });
    if (!out.ok) return out.response;
    const { error } = await db.from("profiles").update({ marker_notes: out.text }).eq("owner_id", student.id);
    if (error) return reply(500, { error: "Orca couldn't save how you mark your notes." });
    return reply(200, { markers: out.text });
  });
}
