/**
 * Where the emailed links (confirm your email, reset your password) land. Supabase has already
 * checked the link and sends `?code=`, which is exchanged for a session here. The exchange needs the
 * browser that asked, so a link opened elsewhere (another device) fails: the person is told
 * to sign in (an already-confirmed address works) or to ask for a new link.
 */
import { NextResponse } from "next/server";
import { safeNext } from "@/lib/auth/paths";
import { SupabaseNotConfiguredError } from "@/lib/supabase/env";
import { cookieClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));
  const to = (path: string) => NextResponse.redirect(new URL(path, url.origin));
  if (!code) return to("/sign-in?notice=link");
  try {
    const { error } = await (await cookieClient()).auth.exchangeCodeForSession(code);
    if (error) return to("/sign-in?notice=link");
  } catch (e) {
    if (e instanceof SupabaseNotConfiguredError) return to("/sign-in");
    throw e;
  }
  return to(next);
}
