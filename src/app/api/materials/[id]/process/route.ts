import { z } from "zod";
import { processUpload } from "@/lib/server/materials";
import { forStudent, reply } from "@/lib/server/student";
import { uploadReply } from "@/lib/server/upload-reply";

/**
 * POST → read an uploaded file on the server into its pages (`material_pages`), once it's in
 * Storage, then start building its questions. 200 { material, pages, hidden, generation } (again
 * on a repeat; `generation` in src/lib/server/jobs/start.ts), 200 { duplicate } when the course
 * already has this file, 404 not yours, 409 not uploaded yet or being read, 413/415/422 a file Orca
 * won't read (the material is marked failed with why). See `src/lib/server/materials.ts`.
 */
export const runtime = "nodejs";
// Reading a 150-page deck takes a few seconds; with ORCA_JOBS=inline the job that builds the
// questions then runs after the response, within this budget (production uses Trigger.dev).
export const maxDuration = 300;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forStudent(request, async (student, db) => {
    if (!z.uuid().safeParse(id).success) return reply(404, { error: "No such upload." });
    return uploadReply(db, student.id, await processUpload(db, student.id, id));
  });
}
