import { admin, expect, seedFixtureCourse, test } from "./fixture";

/**
 * The admin view (2026-11-10) is the owner's alone: `profiles.is_admin`, set only in the database.
 * A plain student gets the app's 404 on its pages and its API (never a 401 or 403 that would say
 * they exist); once the flag is set the pages render and the API answers.
 */
test("a plain student gets 404 on /admin and its API; an admin sees the view", async ({ page, student }) => {
  await seedFixtureCourse(student);
  const denied = await page.goto("/admin");
  expect(denied?.status()).toBe(404);
  await expect(page.locator('[data-part="admin"]')).toHaveCount(0);
  const api = await page.request.get("/api/admin/users");
  expect(api.status()).toBe(404);
  expect(await api.json()).toEqual({ error: "Not found" });
  expect((await page.request.get("/api/admin/overview")).status()).toBe(404);
  expect((await page.request.get(`/api/admin/users/${student.id}`)).status()).toBe(404);
  // No door to it on the map either.
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Add Course" })).toBeVisible();
  await expect(page.locator('[data-part="admin-link"]')).toHaveCount(0);

  // A student can't flag themselves (RLS + trigger); the owner does it in the database.
  const self = await student.db.from("profiles").update({ is_admin: true }).eq("owner_id", student.id);
  expect(self.error?.code).toBe("42501");
  const { error } = await admin().from("profiles").update({ is_admin: true }).eq("owner_id", student.id);
  expect(error).toBeNull();

  // The map now shows the Admin badge, which opens the view (owner, 2026-11-10).
  await page.goto("/");
  await page.locator('[data-part="admin-link"]').click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.locator('[data-part="admin-tiles"]')).toContainText("Users");
  const users = page.locator('[data-part="admin-users"]');
  await expect(users).toContainText(student.email);
  await expect(users).toContainText("admin");

  const listed = await page.request.get("/api/admin/users?sort=spend");
  expect(listed.status()).toBe(200);
  const body = (await listed.json()) as { users: Array<{ id: string; email: string; courses: number; isAdmin: boolean }> };
  const me = body.users.find((u) => u.id === student.id);
  expect(me).toMatchObject({ email: student.email, courses: 1, isAdmin: true });

  await page.goto("/admin/users?sort=active");
  await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
  await page.locator(`[data-part="admin-users"] a[href="/admin/users/${student.id}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/admin/users/${student.id}$`));
  await expect(page.locator('[data-part="admin-user-courses"]')).toContainText("Logic Fixture");
  await expect(page.locator('[data-part="admin-user-uploads"]')).toContainText("L01_Fixture.pdf");
  await expect(page.getByText("Page views and time on the app: not recorded")).toBeVisible();

  await page.goto("/admin/questions");
  await expect(page.getByRole("heading", { name: "Questions" })).toBeVisible();
  await expect(page.getByText("No thumbs down yet.")).toBeVisible();

  await page.goto("/admin/spend");
  await expect(page.getByRole("heading", { name: "Spend" })).toBeVisible();
  await expect(page.locator('[data-part="admin-spend-days"] tbody tr')).toHaveCount(30);

  // Every admin read was logged.
  const { data: events } = await admin().from("security_events").select("quote").eq("owner_id", student.id).eq("kind", "admin_read");
  const routes = (events ?? []).map((e) => e.quote);
  expect(routes).toEqual(expect.arrayContaining(["/admin", "/api/admin/users?sort=spend", "/admin/spend", "/admin/questions"]));
});

test("the heartbeat records when a signed-in tab was last open", async ({ page, student }) => {
  const before = await admin().from("profiles").select("last_active_at").eq("owner_id", student.id).single();
  expect(before.data?.last_active_at).toBeNull();
  const beat = page.waitForResponse((r) => r.url().endsWith("/api/heartbeat") && r.request().method() === "POST");
  await page.goto("/");
  expect((await beat).status()).toBe(204);
  await expect.poll(async () => (await admin().from("profiles").select("last_active_at").eq("owner_id", student.id).single()).data?.last_active_at).not.toBeNull();
  const faked = await student.db.from("profiles").update({ last_active_at: new Date(0).toISOString() }).eq("owner_id", student.id);
  expect(faked.error?.code).toBe("42501");
});
