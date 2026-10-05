/**
 * Supabase on the server, for route handlers. Two clients, kept apart on purpose:
 *
 * - `signedInUser(request)` answers who is calling, from the session cookie (`@supabase/ssr`) or an
 *   `Authorization: Bearer <access token>` header (scripts and tests). The token is checked with
 *   Supabase Auth, not just decoded.
 * - `adminClient()` uses the secret key and bypasses row-level security. Code that uses it must
 *   scope every query to the user `signedInUser` returned, never to an id from the request body.
 *
 * Task 4 adds the browser client, the proxy that refreshes the session cookie, and the auth screens.
 */
import { createServerClient } from "@supabase/ssr";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Database } from "./database.types";
import { publicSupabaseEnv, serverSupabaseEnv } from "./env";

export type OrcaSupabase = SupabaseClient<Database>;

/** The signed-in user's id, or null when the caller isn't signed in (or the session is invalid). */
export async function signedInUser(request: Request): Promise<{ id: string } | null> {
  const { url, publishableKey } = publicSupabaseEnv();
  const bearer = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  if (bearer) {
    const client = createClient<Database>(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.auth.getUser(bearer);
    return error || !data.user ? null : { id: data.user.id };
  }
  const store = await cookies();
  const client = createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        // A refreshed session is written back when the handler may set cookies; the proxy (Task 4)
        // does it on every request.
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          /* read-only cookie store */
        }
      },
    },
  });
  const { data, error } = await client.auth.getUser();
  return error || !data.user ? null : { id: data.user.id };
}

/** Service-role client. Server only; bypasses RLS, so scope every query to the signed-in user. */
export function adminClient(): OrcaSupabase {
  const { url, secretKey } = serverSupabaseEnv();
  return createClient<Database>(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
