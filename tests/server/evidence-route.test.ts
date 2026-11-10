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

/**
 * Server-written evidence never comes from the browser (cram mode contracts, section 5): a work or
 * signal event, an answer graded by Claude, or a connector flag is refused before the course is
 * even looked up. Supabase is "configured" with dummy settings and the auth check is answered by
 * a stubbed fetch; any other request would be a database read, so it fails the test.
 */
test("POST /api/evidence refuses work and signal events, claude-graded answers and connector flags from the browser", async () => {
  const saved = { ...process.env };
  const fetchWas = globalThis.fetch;
  const student = "10000000-0000-4000-8000-000000000001";
  Object.assign(process.env, { NEXT_PUBLIC_SUPABASE_URL: "http://supabase.test", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test", SUPABASE_SECRET_KEY: "sb_secret_test" });
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (/\/auth\/v1\/user$/.test(url)) return Response.json({ id: student, aud: "authenticated", role: "authenticated", email: "s@orca.test", app_metadata: {}, user_metadata: {}, created_at: "2026-11-10T00:00:00Z" });
    throw new Error(`The route reached the database for a request it should have refused: ${url}`);
  }) as typeof fetch;
  try {
    const { POST } = await import("../../src/app/api/evidence/route.ts");
    const course = "c0000000-0000-4000-8000-000000000001";
    const objective = "f0000000-0000-4000-8000-000000000001";
    const question = "a0000000-0000-4000-8000-000000000001";
    const id = "e0000000-0000-4000-8000-000000000001";
    const post = async (body: unknown) => {
      const res = await POST(new Request("http://orca.test/api/evidence", { method: "POST", headers: { authorization: "Bearer test-token", "content-type": "application/json" }, body: JSON.stringify(body) }));
      return { status: res.status, body: (await res.json()) as { error: string; issues?: Record<string, string[]> } };
    };
    const refused: Array<[string, unknown]> = [
      ["a work event", { kind: "work", id, courseId: course, objectiveId: objective, problem: "Add 0110 and 0011.", basis: "known-answer", outcome: "correct", source: "connector", sessionId: "s" }],
      ["a signal", { kind: "signal", id, courseId: course, objectiveId: objective, signal: "lost", source: "connector", sessionId: "s" }],
      ["an answer graded by Claude", { kind: "answer", id, courseId: course, questionId: question, outcome: "correct", grader: "claude", source: "quiz", sessionId: "s" }],
      ["an answer from the connector", { kind: "answer", id, courseId: course, questionId: question, outcome: "correct", grader: "choice", source: "connector", sessionId: "s" }],
      ["a connector flag", { kind: "confusion", id, courseId: course, objectiveId: objective, flagSource: "connector" }],
      ["a struggled connector flag", { kind: "confusion", id, courseId: course, objectiveId: objective, flagSource: "connector-struggled" }],
      ["a handwritten-marker flag", { kind: "confusion", id, courseId: course, objectiveId: objective, flagSource: "handwritten-marker" }],
    ];
    for (const [what, body] of refused) {
      const r = await post(body);
      assert.equal(r.status, 400, `${what} is refused`);
      assert.equal(r.body.error, "That isn't an evidence event.", what);
    }
  } finally {
    globalThis.fetch = fetchWas;
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});
