/**
 * The shared front of every route that acts for a signed-in student: Supabase must be configured
 * (503 otherwise, saying so), the caller must be signed in (401), and the handler gets the verified
 * user id and the service-role client. Anything the handler reads or writes with that client must
 * be scoped to that id.
 */
import { SupabaseNotConfiguredError } from "@/lib/supabase/env";
import { type OrcaSupabase, adminClient, signedInUser } from "@/lib/supabase/server";

export const NO_STORE = { "cache-control": "no-store" };

export function reply(status: number, body: unknown) {
  return Response.json(body, { status, headers: NO_STORE });
}

export async function forStudent(request: Request, handle: (student: { id: string }, db: OrcaSupabase) => Promise<Response>): Promise<Response> {
  let db: OrcaSupabase;
  let student: { id: string } | null;
  try {
    db = adminClient();
    student = await signedInUser(request);
  } catch (e) {
    if (e instanceof SupabaseNotConfiguredError) return reply(503, { error: e.message });
    throw e;
  }
  if (!student) return reply(401, { error: "Sign in to continue." });
  return handle(student, db);
}

/** Whether the course exists and is this student's. */
export async function ownsCourse(db: OrcaSupabase, ownerId: string, courseId: string): Promise<boolean> {
  const { data, error } = await db.from("courses").select("id").eq("owner_id", ownerId).eq("id", courseId).maybeSingle();
  if (error) throw new Error(`Couldn't read the course: ${error.message}`);
  return data !== null;
}
