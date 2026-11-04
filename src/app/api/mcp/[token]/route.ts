import { handleRpc } from "@/lib/connector/mcp";
import { connectorTools, studentForToken } from "@/lib/server/connector";
import { NO_STORE } from "@/lib/server/student";
import { SupabaseNotConfiguredError } from "@/lib/supabase/env";
import { adminClient } from "@/lib/supabase/server";

/**
 * The Claude connector's MCP endpoint. The student's secret token is the path (minted in Settings;
 * Claude's custom connectors take a URL and nothing else), so this route never uses the session
 * cookie. POST carries one JSON-RPC message (`src/lib/connector/mcp.ts`); GET (a client asking to
 * open a server-to-client stream) is refused: nothing here streams; DELETE (end of session) is a no-op.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

const HEADERS = { ...NO_STORE, "content-type": "application/json" };
const json = (status: number, body: unknown) => new Response(body === null ? null : JSON.stringify(body), { status, headers: HEADERS });

export async function POST(request: Request, context: RouteContext<"/api/mcp/[token]">) {
  const { token } = await context.params;
  let db;
  let student;
  try {
    db = adminClient();
    student = await studentForToken(db, token);
  } catch (e) {
    if (e instanceof SupabaseNotConfiguredError) return json(503, { jsonrpc: "2.0", id: null, error: { code: -32000, message: e.message } });
    throw e;
  }
  if (!student) return json(401, { jsonrpc: "2.0", id: null, error: { code: -32001, message: "This connector link isn't valid. Make a new one in Orca's Settings." } });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json(400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Send JSON." } });
  }
  // Evidence from the chat is filed under the day: a review check missed in one chat can be passed in a later one.
  const session = `connector:${new Date().toISOString().slice(0, 10)}`;
  const reply = await handleRpc(raw, connectorTools(db, student.id), session);
  return json(reply.status, reply.body);
}

export function GET() {
  return json(405, { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Orca's connector answers POST only." } });
}

export function DELETE() {
  return new Response(null, { status: 200, headers: NO_STORE });
}
