/**
 * Where the emailed links (confirm your email, reset your password) land. Two shapes:
 *
 * - `?code=`: Supabase's default (PKCE) templates. The exchange needs the browser that asked for
 *   the link, so a link opened elsewhere (a phone, another browser) fails and the person is told
 *   to sign in (an already-confirmed address works) or to ask for a new link.
 * - `?token_hash=&type=`: token-hash templates (set on the hosted project; `docs/SETUP-HOSTED.md`),
 *   which work from any browser. The hash is verified with Supabase Auth here and a session set.
 *
 * Either way `next` is checked to stay on this site.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { safeNext } from "@/lib/auth/paths";
import { SupabaseNotConfiguredError } from "@/lib/supabase/env";
import { cookieClient } from "@/lib/supabase/server";

const OtpType = z.enum(["signup", "invite", "magiclink", "recovery", "email_change", "email"]);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = OtpType.safeParse(url.searchParams.get("type"));
  const next = safeNext(url.searchParams.get("next"));
  const to = (path: string) => NextResponse.redirect(new URL(path, url.origin));
  if (!code && !(tokenHash && type.success)) return to("/sign-in?notice=link");
  try {
    const client = await cookieClient();
    const { error } = code ? await client.auth.exchangeCodeForSession(code) : await client.auth.verifyOtp({ token_hash: tokenHash!, type: type.data! });
    if (error) return to("/sign-in?notice=link");
  } catch (e) {
    if (e instanceof SupabaseNotConfiguredError) return to("/sign-in");
    throw e;
  }
  // A recovery link's job is the new password, whatever `next` says.
  return to(type.success && type.data === "recovery" && !code ? "/reset-password" : next);
}
