import { z } from "zod";
import { UploadRequest, startUpload } from "@/lib/server/materials";
import { forStudent, reply } from "@/lib/server/student";

/**
 * POST { courseId, filename, size, mime, hash, type, assigned, due, reflect } → start an upload.
 * 201 { material, upload: { path, token } }: send the file to Storage with the token, then
 * POST /api/materials/:id/process. 200 { duplicate }: the course already has this file.
 * 413 over 25 MB, 415 not a PDF, 404 not your course. See `src/lib/server/materials.ts`.
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  return forStudent(request, async (student, db) => {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return reply(400, { error: "Send the upload's details as JSON." });
    }
    const parsed = UploadRequest.safeParse(raw);
    if (!parsed.success) return reply(400, { error: "Those aren't an upload's details.", issues: z.flattenError(parsed.error).fieldErrors });
    return startUpload(db, student.id, parsed.data);
  });
}
