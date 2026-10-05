"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { safeNext } from "@/lib/auth/paths";
import { passwordProblem, validEmail } from "@/lib/auth/validate";
import { SupabaseNotConfiguredError } from "@/lib/supabase/env";
import { cookieClient } from "@/lib/supabase/server";

/** What a form shows after submitting: an error, or a notice (the next step, e.g. "check your email"). */
export type AuthState = { error?: string; notice?: string } | undefined;

const text = (data: FormData, key: string) => (typeof data.get(key) === "string" ? (data.get(key) as string) : "");

async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") || host?.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

/** Runs one auth call; a database that isn't configured is reported as such, never as a bad password. */
async function withClient(run: (client: Awaited<ReturnType<typeof cookieClient>>) => Promise<AuthState>): Promise<AuthState> {
  try {
    return await run(await cookieClient());
  } catch (e) {
    if (e instanceof SupabaseNotConfiguredError) return { error: e.message };
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
  redirect(next);
}

export async function signUp(_: AuthState, data: FormData): Promise<AuthState> {
  const email = text(data, "email").trim();
  const password = text(data, "password");
  const timezone = text(data, "timezone");
  if (!validEmail(email)) return { error: "Enter a valid email address." };
  const problem = passwordProblem(password);
  if (problem) return { error: problem };
  return withClient(async (client) => {
    const { error } = await client.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${await origin()}/auth/callback`, data: timezone ? { timezone } : {} },
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
  redirect("/");
}

export async function signOut(): Promise<void> {
  try {
    await (await cookieClient()).auth.signOut();
  } catch (e) {
    if (!(e instanceof SupabaseNotConfiguredError)) throw e;
  }
  redirect("/sign-in");
}
