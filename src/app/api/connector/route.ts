import { linkOrigin } from "@/lib/auth/site";
import { connectorStatus, createConnectorToken, revokeConnectorToken } from "@/lib/server/connector";
import { forStudent, reply } from "@/lib/server/student";

/**
 * The student's Claude connector link (Settings → Claude connector).
 * GET → { connected, createdAt, lastUsedAt }. POST → { url }: a new link, shown once (an earlier
 * one stops working). DELETE → { revoked: true }.
 */
export const runtime = "nodejs";

export async function GET(request: Request) {
  return forStudent(request, async (student, db) => reply(200, await connectorStatus(db, student.id)));
}

export async function POST(request: Request) {
  return forStudent(request, async (student, db) => {
    let origin: string;
    try {
      origin = linkOrigin({ siteUrl: process.env.SITE_URL, production: process.env.NODE_ENV === "production", host: request.headers.get("host"), proto: request.headers.get("x-forwarded-proto") });
    } catch (e) {
      return reply(503, { error: e instanceof Error ? e.message : "Orca can't build the connector link." });
    }
    const token = await createConnectorToken(db, student.id);
    return reply(201, { url: `${origin}/api/mcp/${token}` });
  });
}

export async function DELETE(request: Request) {
  return forStudent(request, async (student, db) => {
    await revokeConnectorToken(db, student.id);
    return reply(200, { revoked: true });
  });
}
