/**
 * Supabase on the server, for route handlers. Two clients, kept apart on purpose:
 *
 * - `signedInUser(request)` answers who is calling, from the session cookie (`@supabase/ssr`) or an
 *   `Authorization: Bearer <access token>` header (scripts and tests). The token is checked with
 *   Supabase Auth, not just decoded.
 * - `adminClient()` uses the secret key and bypasses row-level security. Code that uses it must
 *   scope every query to the user `signedInUser` returned, never to an id from the request body.
 *
 * `cookieClient()` is the session-cookie client for server actions and route handlers that sign
 * people in or out. The browser client is `browser.ts`; `src/proxy.ts` refreshes the cookie.
 */
import { createServerClient } from "@supabase/ssr";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Database } from "./database.types";
import { publicSupabaseEnv, serverSupabaseEnv } from "./env";

export type OrcaSupabase = SupabaseClient<Database>;

/** A client that reads and writes the session cookie (server actions and route handlers). */
export async function cookieClient(): Promise<OrcaSupabase> {
  const { url, publishableKey } = publicSupabaseEnv();
  const store = await cookies();
  return createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        // A refreshed session is written back when the caller may set cookies; the proxy does it
        // on every request, so a read-only store (a server component) is fine.
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          /* read-only cookie store */
        }
      },
    },
  });
}

/** The signed-in user's id, or null when the caller isn't signed in (or the session is invalid). */
export async function signedInUser(request: Request): Promise<{ id: string } | null> {
  const { url, publishableKey } = publicSupabaseEnv();
  const bearer = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  if (bearer) {
    const client = createClient<Database>(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.auth.getUser(bearer);
    return error || !data.user ? null : { id: data.user.id };
  }
  const client = await cookieClient();
  const { data, error } = await client.auth.getUser();
  return error || !data.user ? null : { id: data.user.id };
}

/** Service-role client. Server only; bypasses RLS, so scope every query to the signed-in user. */
export function adminClient(): OrcaSupabase {
  const { url, secretKey } = serverSupabaseEnv();
  return createClient<Database>(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
