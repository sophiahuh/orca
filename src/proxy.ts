/**
 * Next 16's proxy (the old middleware). On every request it (1) sets the Content-Security-Policy
 * with a fresh nonce, and (2) when Supabase is configured, refreshes the session cookie and sends
 * signed-out visitors to sign-in. Without the Supabase env vars it does only (1): the app then
 * shows "Orca isn't connected to its database" itself (decision 5). API routes answer 401 on their
 * own, so they are refreshed but never redirected.
 */
import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { isGuestOnlyPath, isPublicPath } from "@/lib/auth/paths";
import { contentSecurityPolicy } from "@/lib/csp";
import { publicSupabaseEnv } from "@/lib/supabase/env";

export async function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  let env: ReturnType<typeof publicSupabaseEnv> | undefined;
  try {
    env = publicSupabaseEnv();
  } catch {
    env = undefined;
  }
  const csp = contentSecurityPolicy({ nonce, supabaseUrl: env?.url, dev: process.env.NODE_ENV !== "production" });
  const forwarded = new Headers(request.headers);
  forwarded.set("x-nonce", nonce);
  forwarded.set("Content-Security-Policy", csp);

  const next = () => {
    const res = NextResponse.next({ request: { headers: forwarded } });
    res.headers.set("Content-Security-Policy", csp);
    return res;
  };
  let response = next();
  if (!env) return response;

  const refreshed: { name: string; value: string; options: Parameters<typeof response.cookies.set>[2] }[] = [];
  const supabase = createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = next();
        for (const { name, value, options } of list) {
          response.cookies.set(name, value, options);
          refreshed.push({ name, value, options });
        }
      },
    },
  });
  // getClaims() checks the token's signature and expiry locally, so a session revoked at Supabase
  // (sign-out elsewhere, a deleted account) still passes here until its hour is up. Accepted (Task 4
  // review): the proxy only chooses between a page and the sign-in redirect; every route and every
  // data read checks the session with Supabase Auth (`signedInUser` → `getUser`), and the browser's
  // own client fails on the next request, so a revoked session sees an empty shell at most.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims);
  const { pathname, search } = request.nextUrl;

  const redirect = (to: string) => {
    const url = request.nextUrl.clone();
    const [path, query] = to.split("?");
    url.pathname = path;
    url.search = query ? `?${query}` : "";
    const res = NextResponse.redirect(url);
    res.headers.set("Content-Security-Policy", csp);
    for (const { name, value, options } of refreshed) res.cookies.set(name, value, options);
    return res;
  };

  if (pathname.startsWith("/api/")) return response;
  if (!signedIn && !isPublicPath(pathname)) {
    return redirect(`/sign-in?next=${encodeURIComponent(pathname + search)}`);
  }
  if (signedIn && isGuestOnlyPath(pathname)) return redirect("/");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|mjs|js|css|woff2?)$).*)"],
};
