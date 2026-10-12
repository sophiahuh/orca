import test from "node:test";
import assert from "node:assert/strict";

/**
 * The evidence route's own decisions, without a server: with no Supabase settings it answers 503
 * and says which variables are missing, before reading the body or asking who's signed in
 * (`forStudent` in src/lib/server/student.ts). Loads through tests/support/hooks.mjs.
 */
test("POST /api/evidence answers 503, naming the missing settings, when Supabase isn't configured", async () => {
  const saved = { ...process.env };
  for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY"]) delete process.env[k];
  try {
    const { POST } = await import("../../src/app/api/evidence/route.ts");
    const res = await POST(new Request("http://orca.test/api/evidence", { method: "POST", body: JSON.stringify({ kind: "answer" }) }));
    assert.equal(res.status, 503);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /isn't connected to its database/);
    assert.match(body.error, /NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY/);
    assert.equal(res.headers.get("cache-control"), "no-store");
  } finally {
    Object.assign(process.env, saved);
  }
});
