/**
 * The admin gate (2026-11-10). The admin view is the owner's: `profiles.is_admin`, set only by SQL
 * in the Supabase dashboard, says who may open it. Everything else answers 404, never 401 or 403,
 * so the routes and pages don't tell a student (or a visitor) that they exist.
 *
 * - `forAdmin(request, handle)` fronts every `/api/admin/*` route the way `forStudent` fronts the
 *   student routes: Supabase must be configured (503), the caller must be signed in and an admin
 *   (404 otherwise), and the handler gets the admin's id and the service-role client. Every read
 *   through it is logged to `security_events` (kind `admin_read`, the route in `quote`).
 * - `requireAdmin(route)` is the same check for the `/admin` pages (server components): it answers
 *   the admin's id and the client, or calls `notFound()`.
 *
 * The dependencies are injectable so the decision can be tested without a database.
 */
import { notFound } from "next/navigation";
import { SupabaseNotConfiguredError } from "@/lib/supabase/env";
import { type OrcaSupabase, adminClient, cookieClient, signedInUser } from "@/lib/supabase/server";
import { reply } from "./student";

export interface Admin {
  id: string;
}

export interface AdminDeps {
  /** The service-role client. */
  db: () => OrcaSupabase;
  /** Who is calling, or null. */
  user: (request: Request) => Promise<{ id: string } | null>;
}

const live: AdminDeps = { db: adminClient, user: signedInUser };

/** Whether this account's profile is flagged `is_admin`. A missing profile is not an admin. */
export async function isAdmin(db: OrcaSupabase, userId: string): Promise<boolean> {
  const { data, error } = await db.from("profiles").select("is_admin").eq("owner_id", userId).maybeSingle();
  if (error) throw new Error(`Couldn't read the profile: ${error.message}`);
  return data?.is_admin === true;
}

/** Log one admin read. A failure to log fails the read: the view is only read with a record of it. */
export async function logAdminRead(db: OrcaSupabase, adminId: string, route: string): Promise<void> {
  const { error } = await db.from("security_events").insert({ owner_id: adminId, kind: "admin_read", check: "route", severity: "weak", quote: route.slice(0, 240) });
  if (error) throw new Error(`Couldn't log the admin read: ${error.message}`);
}

export const NOT_FOUND = { error: "Not found" };

/** The route's path and query, for the log. */
function routeOf(request: Request): string {
  try {
    const u = new URL(request.url);
    return u.pathname + u.search;
  } catch {
    return request.url;
  }
}

export async function forAdmin(request: Request, handle: (admin: Admin, db: OrcaSupabase) => Promise<Response>, deps: AdminDeps = live): Promise<Response> {
  let db: OrcaSupabase;
  let user: { id: string } | null;
  try {
    db = deps.db();
    user = await deps.user(request);
  } catch (e) {
    if (e instanceof SupabaseNotConfiguredError) return reply(503, { error: e.message });
    throw e;
  }
  if (!user || !(await isAdmin(db, user.id))) return reply(404, NOT_FOUND);
  await logAdminRead(db, user.id, routeOf(request));
  return handle(user, db);
}

/**
 * For the `/admin` pages. The signed-in user comes from the session cookie (checked with Supabase
 * Auth, as `signedInUser` does); anyone else sees the app's 404.
 */
export async function requireAdmin(route: string): Promise<{ admin: Admin; db: OrcaSupabase }> {
  let db: OrcaSupabase;
  let userId: string | null = null;
  try {
    db = adminClient();
    const session = await cookieClient();
    const { data, error } = await session.auth.getUser();
    userId = error || !data.user ? null : data.user.id;
  } catch (e) {
    if (e instanceof SupabaseNotConfiguredError) notFound();
    throw e;
  }
  if (!userId || !(await isAdmin(db, userId))) notFound();
  await logAdminRead(db, userId, route);
  return { admin: { id: userId }, db };
}
