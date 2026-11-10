import { forAdmin } from "@/lib/server/admin";
import { overview } from "@/lib/server/admin-queries";
import { reply } from "@/lib/server/student";

/** GET → the overview tiles. Admins only (404 to anyone else). */
export const runtime = "nodejs";

export async function GET(request: Request) {
  return forAdmin(request, async (_admin, db) => reply(200, await overview(db)));
}
