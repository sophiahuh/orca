import { z } from "zod";
import { NOT_FOUND, forAdmin } from "@/lib/server/admin";
import { userDetail } from "@/lib/server/admin-queries";
import { reply } from "@/lib/server/student";

/** GET ?evidenceOffset=n → everything the user page shows. Admins only (404 to anyone else, and for an unknown id). */
export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return forAdmin(request, async (_admin, db) => {
    const id = z.uuid().safeParse((await params).id);
    if (!id.success) return reply(404, NOT_FOUND);
    const offset = Number(new URL(request.url).searchParams.get("evidenceOffset") ?? 0);
    const detail = await userDetail(db, id.data, { evidenceOffset: Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0 });
    return detail ? reply(200, detail) : reply(404, NOT_FOUND);
  });
}
