import { z } from "zod";
import { processUpload } from "@/lib/server/materials";
import { forStudent, reply } from "@/lib/server/student";

/**
 * POST → read an uploaded file on the server into its pages (`material_pages`), once it's in
 * Storage. 200 { material, pages, hidden } (again on a repeat), 200 { duplicate } when the course
 * already has this file, 404 not yours, 409 not uploaded yet or being read, 413/415/422 a file Orca
 * won't read (the material is marked failed with why). See `src/lib/server/materials.ts`.
 */
export const runtime = "nodejs";
// Reading a 150-page deck takes a few seconds.
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forStudent(request, async (student, db) => {
    if (!z.uuid().safeParse(id).success) return reply(404, { error: "No such upload." });
    return processUpload(db, student.id, id);
  });
}
