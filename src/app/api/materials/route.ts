import { z } from "zod";
import { UploadRequest, startUpload } from "@/lib/server/materials";
import { rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { forStudent, reply } from "@/lib/server/student";
import { uploadReply } from "@/lib/server/upload-reply";

/**
 * POST { courseId, filename, size, mime, hash, type, assigned, due, reflect } → start an upload.
 * 201 { material, upload: { path, token } }: send the file to Storage with the token, then
 * POST /api/materials/:id/process. 200 { duplicate }: the course already has this file.
 * A duplicate also says what happens to its questions (`generation`, see upload-reply.ts).
 * 413 over 30 MB, 415 not a PDF, 404 not your course. See `src/lib/server/materials.ts`.
 */
export const runtime = "nodejs";
// A duplicate whose questions were never built starts the job here (inline mode runs it after the response).
export const maxDuration = 300;

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
    // Decision 10: at most LIMITS.rate.upload starts a day per student (a re-upload of a known file counts too).
    const rate = await rateLimit(db, student.id, "upload");
    if (!rate.ok) return tooManyRequests(rate);
    return uploadReply(db, student.id, await startUpload(db, student.id, parsed.data));
  });
}
