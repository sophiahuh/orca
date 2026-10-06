"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { DEFAULT_AVATAR, isAvatar } from "@/lib/avatars";
import { safeNext } from "@/lib/auth/paths";
import { SiteUrlError, linkOrigin, siteUrl } from "@/lib/auth/site";
import { passwordProblem, validEmail } from "@/lib/auth/validate";
import { SupabaseNotConfiguredError } from "@/lib/supabase/env";
import { cookieClient } from "@/lib/supabase/server";

/** What a form shows after submitting: an error, or a notice (the next step, e.g. "check your email"). */
export type AuthState = { error?: string; notice?: string } | undefined;

const text = (data: FormData, key: string) => (typeof data.get(key) === "string" ? (data.get(key) as string) : "");

/** Where an emailed link brings the student back: `SITE_URL` (src/lib/auth/site.ts); the request's host only in development. */
async function origin(): Promise<string> {
  const h = await headers();
  return linkOrigin({
    siteUrl: siteUrl(),
    production: process.env.NODE_ENV === "production",
    host: h.get("x-forwarded-host") ?? h.get("host"),
    proto: h.get("x-forwarded-proto"),
  });
}

/**
 * Runs one auth call; a database that isn't configured is reported as such, never as a bad
 * password, and a site address that's missing stops the email with a message instead of a link
 * to the wrong place (the cause is logged for the owner; the student sees that it's Orca's fault).
 */
async function withClient(run: (client: Awaited<ReturnType<typeof cookieClient>>) => Promise<AuthState>): Promise<AuthState> {
  try {
    return await run(await cookieClient());
  } catch (e) {
    if (e instanceof SupabaseNotConfiguredError) return { error: e.message };
    if (e instanceof SiteUrlError) {
      console.error(`auth: ${e.message}`);
      return { error: "Orca can't send email links right now (its site address isn't configured). Try again later." };
    }
    throw e;
  }
}

export async function signIn(_: AuthState, data: FormData): Promise<AuthState> {
  const email = text(data, "email").trim();
  const password = text(data, "password");
  const next = safeNext(text(data, "next"));
  const result = await withClient(async (client) => {
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (!error) return undefined;
    // "Email not confirmed" is only revealed to someone who knows the password.
    if (error.code === "email_not_confirmed") return { error: "Confirm your email first: open the link we sent you." };
    return { error: "Invalid email or password." };
  });
  if (result) return result;
  // Signed in, the student's courses are home; "/" is only the welcome screen.
  redirect(next === "/" ? "/home" : next);
}

export async function signUp(_: AuthState, data: FormData): Promise<AuthState> {
  const email = text(data, "email").trim();
  const password = text(data, "password");
  const timezone = text(data, "timezone");
  // The name and the sea-buddy avatar (Figma: 13 · Sign up) ride along as metadata; the profile
  // trigger keeps a real creature and a non-empty name, and falls back otherwise.
  const name = text(data, "name").trim().slice(0, 80);
  const avatarChoice = text(data, "avatar");
  const avatar = isAvatar(avatarChoice) ? avatarChoice : DEFAULT_AVATAR;
  if (!validEmail(email)) return { error: "Enter a valid email address." };
  const problem = passwordProblem(password);
  if (problem) return { error: problem };
  return withClient(async (client) => {
    const { error } = await client.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${await origin()}/auth/callback`, data: { ...(timezone ? { timezone } : {}), ...(name ? { name } : {}), avatar } },
    });
    // The same answer whether or not the address already has an account.
    if (error && error.status !== undefined && error.status >= 500) return { error: "Couldn't create the account. Try again in a moment." };
    if (error && error.code !== "user_already_exists") return { error: "Couldn't create the account. Check the details and try again." };
    return { notice: "Check your email: we sent a link to confirm your account." };
  });
}

export async function requestReset(_: AuthState, data: FormData): Promise<AuthState> {
  const email = text(data, "email").trim();
  if (!validEmail(email)) return { error: "Enter a valid email address." };
  return withClient(async (client) => {
    await client.auth.resetPasswordForEmail(email, { redirectTo: `${await origin()}/auth/callback?next=/reset-password` });
    return { notice: "If that email has an account, we sent a link to reset the password." };
  });
}

export async function updatePassword(_: AuthState, data: FormData): Promise<AuthState> {
  const password = text(data, "password");
  const problem = passwordProblem(password);
  if (problem) return { error: problem };
  const result = await withClient(async (client) => {
    const { error } = await client.auth.updateUser({ password });
    if (!error) return undefined;
    if (error.code === "same_password") return { error: "Choose a password you haven't used for this account." };
    return { error: "Couldn't update the password. Request a new link and try again." };
  });
  if (result) return result;
  redirect("/home");
}

export async function signOut(): Promise<void> {
  try {
    await (await cookieClient()).auth.signOut();
  } catch (e) {
    if (!(e instanceof SupabaseNotConfiguredError)) throw e;
  }
  redirect("/sign-in");
}
