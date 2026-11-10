import test from "node:test";
import assert from "node:assert/strict";
import { forAdmin } from "../../src/lib/server/admin.ts";
import { SupabaseNotConfiguredError } from "../../src/lib/supabase/env.ts";

/**
 * The admin gate's own decisions, without a database: a fake service client answers the profile
 * read and records the security event the gate writes. Loads through tests/support/hooks.mjs.
 */
function fakeDb(profile: { is_admin: boolean } | null) {
  const inserted: Record<string, unknown>[] = [];
  const db = {
    from(table: string) {
      if (table === "profiles") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile, error: null }) }) }) };
      }
      if (table === "security_events") {
        return {
          insert: async (row: Record<string, unknown>) => {
            inserted.push(row);
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { db: db as never, inserted };
}

const request = () => new Request("http://orca.test/api/admin/users?sort=spend");

test("a signed-out caller and a plain student both get 404 (not 401 or 403), and nothing is logged", async () => {
  for (const [who, user] of [
    ["signed out", null],
    ["a student", { id: "student-1" }],
  ] as const) {
    const { db, inserted } = fakeDb(user ? { is_admin: false } : null);
    let handled = false;
    const res = await forAdmin(
      request(),
      async () => {
        handled = true;
        return Response.json({});
      },
      { db: () => db, user: async () => user },
    );
    assert.equal(res.status, 404, who);
    assert.deepEqual(await res.json(), { error: "Not found" }, who);
    assert.equal(res.headers.get("cache-control"), "no-store", who);
    assert.equal(handled, false, `${who}: the handler never runs`);
    assert.deepEqual(inserted, [], `${who}: no admin_read is logged`);
  }
});

test("an account without a profile row is not an admin either", async () => {
  const { db } = fakeDb(null);
  const res = await forAdmin(request(), async () => Response.json({}), { db: () => db, user: async () => ({ id: "ghost" }) });
  assert.equal(res.status, 404);
});

test("an admin reaches the handler with their id and the client, and the read is logged with its route", async () => {
  const { db, inserted } = fakeDb({ is_admin: true });
  const res = await forAdmin(
    request(),
    async (admin, client) => {
      assert.equal(admin.id, "owner-1");
      assert.equal(client, db);
      return Response.json({ ok: true });
    },
    { db: () => db, user: async () => ({ id: "owner-1" }) },
  );
  assert.equal(res.status, 200);
  assert.deepEqual(inserted, [{ owner_id: "owner-1", kind: "admin_read", check: "route", severity: "weak", quote: "/api/admin/users?sort=spend" }]);
});

test("without Supabase configured the gate answers 503, saying so", async () => {
  const res = await forAdmin(request(), async () => Response.json({}), {
    db: () => {
      throw new SupabaseNotConfiguredError(["SUPABASE_SECRET_KEY"]);
    },
    user: async () => null,
  });
  assert.equal(res.status, 503);
  assert.match(((await res.json()) as { error: string }).error, /SUPABASE_SECRET_KEY/);
});
