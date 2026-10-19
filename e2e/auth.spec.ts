import { createClient } from "@supabase/supabase-js";
import { type Page, expect, test } from "@playwright/test";

/**
 * Accounts against the local Supabase stack, which captures every email in Mailpit: sign up, confirm
 * from the emailed link, sign out, wrong password, reset password, and the signed-out redirect.
 * These tests start signed out (they use Playwright's own `test`, not the signed-in one in fixture.ts).
 */
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
const PASSWORD = "correct-horse-1";

const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });

/** The link in the newest email to this address (waits for it to arrive). */
async function emailedLink(email: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const list = (await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json()) as { messages: { ID: string }[] };
    if (list.messages.length) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${list.messages[0].ID}`)).json()) as { Text: string };
      const link = /https?:\/\/\S+\/auth\/v1\/verify\S*/.exec(msg.Text)?.[0];
      if (link) return link.replace(/[)>\]]+$/, "");
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No email arrived for ${email}`);
}

async function clearInbox(email: string) {
  await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`, { method: "DELETE" });
}

async function signInVia(page: Page, email: string, password: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
}

const created: string[] = [];
test.afterEach(async () => {
  const db = admin();
  for (const id of created.splice(0)) await db.auth.admin.deleteUser(id);
});

async function confirmedStudent(): Promise<string> {
  const email = `auth-${crypto.randomUUID()}@example.test`;
  const { data, error } = await admin().auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw new Error(error?.message);
  created.push(data.user.id);
  return email;
}

test("a signed-out visit goes to sign-in, and every page carries a Content-Security-Policy", async ({ page, request }) => {
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fsettings/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();

  const res = await request.get("/sign-in");
  const csp = res.headers()["content-security-policy"];
  expect(csp).toMatch(/script-src 'self' 'nonce-[^']+'/);
  expect(csp).toContain("frame-ancestors 'none'");
});

test.describe("sign up", () => {
  test.use({ timezoneId: "America/New_York" });

  test("confirming from the email signs you in, with your timezone; sign out ends it", async ({ page }) => {
    const email = `auth-${crypto.randomUUID()}@example.test`;
    await page.goto("/sign-up");
    await page.getByLabel("Name").fill("Sophia");
    // The sea buddy (Figma: 13 · Sign up): picking one shows it in the top bar right away.
    await page.getByRole("radio", { name: "Turtle" }).click();
    await expect(page.locator("[data-part=top-bar] [data-avatar=turtle]")).toBeVisible();
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("short");
    await page.getByRole("button", { name: "Sign up" }).click();
    // The field's own minimum stops it before the server is asked.
    await expect(page).toHaveURL(/\/sign-up$/);

    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign up" }).click();
    await expect(page.getByRole("status")).toContainText("Check your email");

    // Not signed in until the link is followed.
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/sign-in/);

    await page.goto(await emailedLink(email));
    await page.goto("/settings");
    // The Account card edits contacts in place (e427e9c): the email and name are inputs.
    await expect(page.locator("[data-part=account-email]")).toHaveValue(email);
    await expect(page.getByRole("textbox", { name: "Username" })).toHaveValue("Sophia");
    await expect(page.getByRole("combobox", { name: "Timezone" })).toHaveValue("America/New_York");
    // The profile's avatar and name came from sign-up; the top bar shows the avatar.
    await expect(page.locator("[data-part=top-bar] [data-avatar=turtle]")).toBeVisible();
    await expect(page.getByRole("radio", { name: "Turtle" })).toHaveAttribute("aria-checked", "true");

    const { data: users } = await admin().auth.admin.listUsers({ perPage: 1000 });
    const user = users.users.find((u) => u.email === email);
    if (user) created.push(user.id);
    const profile = await admin().from("profiles").select("timezone, avatar, name").eq("owner_id", user!.id).single();
    expect(profile.data).toEqual({ timezone: "America/New_York", avatar: "turtle", name: "Sophia" });

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    await page.goto("/");
    await expect(page).toHaveURL(/\/sign-in\?next=%2F$/);
  });
});

/** How many emails Mailpit holds for this address. */
async function emailCount(email: string): Promise<number> {
  const list = (await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json()) as { messages_count: number };
  return list.messages_count;
}

test.describe("resend the confirmation email", () => {
  test("the sign-up notice offers it, after the minute Supabase needs between two emails", async ({ page }) => {
    const email = `auth-${crypto.randomUUID()}@example.test`;
    await page.goto("/sign-up");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign up" }).click();
    await expect(page.getByRole("status")).toContainText("Check your email");
    await emailedLink(email);

    // One just went out, so the offer starts with its wait and counts down.
    const resend = page.locator("[data-part=resend-confirmation]");
    await expect(resend).toContainText("Didn't get the email?");
    const waiting = resend.getByRole("button", { name: /resend it in \d+ s/ });
    await expect(waiting).toBeDisabled();
    const first = Number(/\d+/.exec((await waiting.textContent())!)![0]);
    await expect.poll(async () => Number(/\d+/.exec((await waiting.textContent())!)![0])).toBeLessThan(first);
    expect(await emailCount(email)).toBe(1);

    const { data: users } = await admin().auth.admin.listUsers({ perPage: 1000 });
    const user = users.users.find((u) => u.email === email);
    if (user) created.push(user.id);
  });

  test("logging in before confirming offers it too; a confirmed or unknown address gets the same words and no email", async ({ page }) => {
    const email = `auth-${crypto.randomUUID()}@example.test`;
    const { data, error } = await admin().auth.admin.createUser({ email, password: PASSWORD, email_confirm: false });
    if (error || !data.user) throw new Error(error?.message);
    created.push(data.user.id);
    await clearInbox(email);

    await signInVia(page, email, PASSWORD);
    await expect(page.locator("form [role=alert]")).toHaveText("Confirm your email first: open the link we sent you.");
    // No email yet for this account, so the offer is open: one click sends the confirmation link.
    const resend = page.locator("[data-part=resend-confirmation]");
    await resend.getByRole("button", { name: "resend it", exact: true }).click();
    await expect(resend.getByRole("status")).toHaveText("If that address is waiting to be confirmed, we sent a new link.");
    expect(await emailedLink(email)).toContain("type=signup");
    await expect.poll(() => emailCount(email)).toBe(1);
    // Then the wait, so a second click can't be refused by the server for coming too soon.
    await expect(resend.getByRole("button", { name: /resend it in \d+ s/ })).toBeDisabled();

    // Confirmed from that link, the account signs in and the offer is gone.
    await page.goto(await emailedLink(email));
    await page.goto("/settings");
    await expect(page.locator("[data-part=account-email]")).toHaveValue(email);

    // A wrong password never reveals whether the address is confirmed, so no offer either.
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    await signInVia(page, email, "not-the-password");
    await expect(page.locator("form [role=alert]")).toHaveText("Invalid email or password.");
    await expect(resend).toHaveCount(0);
  });
});

test("a wrong password gets the same generic error as an unknown email", async ({ page }) => {
  const email = await confirmedStudent();
  await signInVia(page, email, "not-the-password");
  await expect(page.locator("form [role=alert]")).toHaveText("Invalid email or password.");
  await signInVia(page, `nobody-${crypto.randomUUID()}@example.test`, "not-the-password");
  await expect(page.locator("form [role=alert]")).toHaveText("Invalid email or password.");
  await expect(page).toHaveURL(/\/sign-in/);

  await signInVia(page, email, PASSWORD);
  await expect(page).toHaveURL(/:\d+\/$/);
});

test("forgot password: the emailed link lets you choose a new one", async ({ page }) => {
  const email = await confirmedStudent();
  await clearInbox(email);
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText("If that email has an account");

  await page.goto(await emailedLink(email));
  await expect(page).toHaveURL(/\/reset-password/);
  await page.getByLabel("New password").fill("a-brand-new-pass-2");
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page).not.toHaveURL(/\/reset-password/);

  await page.goto("/settings");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  await signInVia(page, email, PASSWORD);
  await expect(page.locator("form [role=alert]")).toHaveText("Invalid email or password.");
  await signInVia(page, email, "a-brand-new-pass-2");
  await expect(page).not.toHaveURL(/\/sign-in/);
});

test("emailed links bring you back to SITE_URL, not to whatever address the request used", async ({ page }) => {
  const email = `auth-${crypto.randomUUID()}@example.test`;
  // The same server, reached by another name: a link built from the Host header would point here.
  await page.goto("http://127.0.0.1:3100/sign-up");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByRole("status")).toContainText("Check your email");
  const link = new URL(await emailedLink(email));
  expect(link.searchParams.get("redirect_to")).toBe("http://localhost:3100/auth/callback");
  const { data: users } = await admin().auth.admin.listUsers({ perPage: 1000 });
  const user = users.users.find((u) => u.email === email);
  if (user) created.push(user.id);
});

test("a token-hash link (hosted email templates) signs you in from any browser; a recovery one lands on the new-password form", async ({ browser, baseURL }) => {
  const email = await confirmedStudent();
  // What the hosted templates put in the email: the hash, not a one-browser code.
  const magic = await admin().auth.admin.generateLink({ type: "magiclink", email });
  expect(magic.error).toBeNull();
  // A browser that never asked for the link.
  const other = await browser.newContext();
  const page = await other.newPage();
  await page.goto(`${baseURL}/auth/callback?token_hash=${magic.data.properties!.hashed_token}&type=magiclink&next=/settings`);
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.locator("[data-part=account-email]")).toHaveValue(email);
  await other.close();

  const recovery = await admin().auth.admin.generateLink({ type: "recovery", email });
  const third = await browser.newContext();
  const page3 = await third.newPage();
  await page3.goto(`${baseURL}/auth/callback?token_hash=${recovery.data.properties!.hashed_token}&type=recovery&next=/`);
  await expect(page3).toHaveURL(/\/reset-password$/);
  await third.close();

  // A bad or reused hash goes to sign-in with the link notice, signed out.
  const fourth = await browser.newContext();
  const page4 = await fourth.newPage();
  await page4.goto(`${baseURL}/auth/callback?token_hash=${magic.data.properties!.hashed_token}&type=magiclink`);
  await expect(page4).toHaveURL(/\/sign-in\?notice=link$/);
  await fourth.close();
});
