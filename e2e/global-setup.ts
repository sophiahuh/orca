import type { FullConfig } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

/**
 * Stops the run before any test unless the app's model calls go to this machine (the fake API in
 * `e2e/fake-anthropic.ts`): a test must never call a real model. The usual cause is a local dev
 * server on the test port that was started with a real key; stop it and rerun.
 *
 * `/api/llm/status` needs a signed-in student (Task 8), so the check creates a throwaway confirmed
 * account with the secret key (as e2e/fixture.ts does), asks with its access token, and deletes it.
 * It also checks the route refuses a signed-out caller, so the guard can't be passing by accident.
 *
 * Then it warms the dev server: `next dev` compiles a page the first time it's asked for, which
 * on CI can take longer than an assertion's 5 s. A test's `page.goto` waits for that, but a click
 * that navigates (the course page's settings link, "Start" on a dive) doesn't, and the first test
 * to reach each page was failing its `toHaveURL` with the browser still on the page before. Every
 * page is requested once here, as the guard's student, so the tests find them compiled.
 */
const PAGES = ["/", "/add-material", "/calendar", "/course/warm-up", "/course/warm-up/atlas", "/course/warm-up/objectives", "/course/warm-up/review", "/course/warm-up/settings", "/new-course", "/quiz/warm-up/warm-up", "/session/warm-up", "/settings", "/welcome", "/sign-in", "/sign-up", "/forgot-password", "/reset-password"];

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) throw new Error("No baseURL in playwright.config.ts");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !publishable || !secret) throw new Error("The model guard needs the Supabase URL and keys (playwright.config.ts sets them from the local stack).");
  const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url, secret, noSession);
  const email = `e2e-guard-${crypto.randomUUID()}@example.test`;
  const password = "e2e-password-1";
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`The model guard couldn't create its student: ${created.error?.message}`);
  try {
    const own = await createClient(url, publishable, noSession).auth.signInWithPassword({ email, password });
    if (own.error || !own.data.session) throw new Error(`The model guard couldn't sign in: ${own.error?.message}`);
    const res = await fetch(`${baseURL}/api/llm/status`, { headers: { authorization: `Bearer ${own.data.session.access_token}` } });
    if (!res.ok) throw new Error(`Couldn't ask ${baseURL} whether a model is connected (HTTP ${res.status}): ${await res.text()}`);
    const { serverModel, local } = (await res.json()) as { serverModel: string | null; local?: boolean };
    if (serverModel !== null && local !== true) {
      throw new Error(
        `The server at ${baseURL} calls a real model (${serverModel}); browser tests must only reach the fake API. ` +
          "Stop the dev server on that port (it was started with a key) and run the tests again.",
      );
    }
    if (serverModel === null) throw new Error(`The server at ${baseURL} has no model: it wasn't started with the fake API's settings (playwright.config.ts). Stop it and rerun.`);
    const anonymous = await fetch(`${baseURL}/api/llm/status`);
    if (anonymous.status !== 401) throw new Error(`${baseURL}/api/llm/status answered ${anonymous.status} to a signed-out caller; it must need a session.`);

    // The session cookies the app's own sign-in would set (as e2e/fixture.ts builds them), so the
    // signed-in pages render instead of redirecting to sign-in before they're compiled.
    const jar: { name: string; value: string }[] = [];
    const cookieClient = createServerClient(url, publishable, { cookies: { getAll: () => jar, setAll: (list) => list.forEach(({ name, value }) => jar.push({ name, value })) } });
    const session = await cookieClient.auth.signInWithPassword({ email, password });
    if (session.error) throw new Error(`The warm-up couldn't sign in: ${session.error.message}`);
    const cookie = jar.map(({ name, value }) => `${name}=${value}`).join("; ");
    for (const path of PAGES) {
      // Only the compile matters: an unknown course renders its empty state or a redirect, and
      // the guest-only pages redirect a signed-in visitor; nothing here is asserted.
      await fetch(`${baseURL}${path}`, { headers: { cookie }, redirect: "manual" }).catch(() => undefined);
    }
  } finally {
    await admin.auth.admin.deleteUser(created.data.user.id);
  }
}
