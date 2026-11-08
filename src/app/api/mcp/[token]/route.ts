import { dayKeyIn } from "@/lib/mastery/objective-state";
import { handleRpc } from "@/lib/connector/mcp";
import { connectorTools, studentForToken } from "@/lib/server/connector";
import { rateLimit } from "@/lib/server/rate-limit";
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
// flag_check can start a top-up; with ORCA_JOBS=inline it runs after the response, within this budget.
export const maxDuration = 300;

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
  // The link is the only credential, so a leaked one is bounded per student (2026-11-08).
  const rate = await rateLimit(db, student.id, "connector");
  if (!rate.ok) return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message: rate.message } }), { status: 429, headers: { ...HEADERS, "retry-after": String(rate.retryAfterSeconds) } });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json(400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Send JSON." } });
  }
  // Evidence from the chat is filed under the student's day (their timezone, as the app's sessions
  // are): a review check missed in one chat can be passed in a later one.
  const { data: profile, error: profileError } = await db.from("profiles").select("timezone").eq("owner_id", student.id).maybeSingle();
  if (profileError) throw new Error(`Couldn't read the student's timezone: ${profileError.message}`);
  const session = `connector:${dayKeyIn(profile?.timezone ?? "UTC")(new Date().toISOString())}`;
  const reply = await handleRpc(raw, connectorTools(db, student.id), session);
  return json(reply.status, reply.body);
}

export function GET() {
  return json(405, { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Orca's connector answers POST only." } });
}

export function DELETE() {
  return new Response(null, { status: 200, headers: NO_STORE });
}
