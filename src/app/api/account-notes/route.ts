import { z } from "zod";
import { LIMITS } from "@/lib/limits";
import { acceptNotes } from "@/lib/server/notes";
import { forStudent, reply } from "@/lib/server/student";

/** PUT { notes } → the student's Notes for Orca for all their classes: 200 { notes } (null clears them), 400 when refused. */
export const runtime = "nodejs";

const Body = z.object({ notes: z.string().max(LIMITS.notesChars).nullable() });

export async function PUT(request: Request) {
  return forStudent(request, async (student, db) => {
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return reply(400, { error: "Notes are at most 1,000 characters." });
    const notes = await acceptNotes(db, student.id, parsed.data.notes);
    if (!notes.ok) return notes.response;
    const { error } = await db.from("profiles").update({ orca_notes: notes.text }).eq("owner_id", student.id);
    if (error) return reply(500, { error: "Orca couldn't save your notes." });
    return reply(200, { notes: notes.text });
  });
}
