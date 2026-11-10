import { forAdmin } from "@/lib/server/admin";
import { spend } from "@/lib/server/admin-queries";
import { reply } from "@/lib/server/student";

/** GET ?days=30 → model spend by day, by kind and by model (everyone). Admins only. */
export const runtime = "nodejs";

export async function GET(request: Request) {
  return forAdmin(request, async (_admin, db) => {
    const days = Number(new URL(request.url).searchParams.get("days") ?? 30);
    return reply(200, await spend(db, { days: Number.isFinite(days) ? Math.floor(days) : 30 }));
  });
}
