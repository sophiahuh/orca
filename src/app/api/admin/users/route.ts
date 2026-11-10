import { isUserSort } from "@/lib/admin/stats";
import { forAdmin } from "@/lib/server/admin";
import { users } from "@/lib/server/admin-queries";
import { reply } from "@/lib/server/student";

/** GET ?sort=joined|spend|active → one row per profile. Admins only (404 to anyone else). */
export const runtime = "nodejs";

export async function GET(request: Request) {
  return forAdmin(request, async (_admin, db) => {
    const sort = new URL(request.url).searchParams.get("sort") ?? undefined;
    return reply(200, { users: await users(db, isUserSort(sort) ? sort : "joined") });
  });
}
