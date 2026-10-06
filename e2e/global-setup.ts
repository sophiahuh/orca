import type { FullConfig } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * Stops the run before any test unless the app's model calls go to this machine (the fake API in
 * `e2e/fake-anthropic.ts`): a test must never call a real model. The usual cause is a local dev
 * server on the test port that was started with a real key; stop it and rerun.
 *
 * `/api/llm/status` needs a signed-in student (Task 8), so the check creates a throwaway confirmed
 * account with the secret key (as e2e/fixture.ts does), asks with its access token, and deletes it.
 * It also checks the route refuses a signed-out caller, so the guard can't be passing by accident.
 */
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
  } finally {
    await admin.auth.admin.deleteUser(created.data.user.id);
  }
}
