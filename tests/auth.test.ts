import assert from "node:assert/strict";
import { test } from "node:test";
import { isGuestOnlyPath, isPublicPath, safeNext } from "../src/lib/auth/paths.ts";
import { passwordProblem, validEmail } from "../src/lib/auth/validate.ts";
import { contentSecurityPolicy } from "../src/lib/csp.ts";

test("only the account screens and the email callback are public", () => {
  for (const p of ["/sign-in", "/sign-up", "/forgot-password", "/reset-password", "/auth/callback"]) assert.ok(isPublicPath(p), p);
  for (const p of ["/", "/home", "/settings", "/course/x", "/sign-in-evil", "/auth"]) assert.ok(!isPublicPath(p), p);
  assert.ok(isGuestOnlyPath("/sign-in"));
  assert.ok(!isGuestOnlyPath("/reset-password"));
});

test("safeNext only allows same-site paths", () => {
  assert.equal(safeNext("/course/ald?x=1"), "/course/ald?x=1");
  for (const bad of ["//evil.com", "https://evil.com", "/\\evil.com", "/\t/evil.com", "/\n/evil.com", "/\r/evil.com", "/.//evil.com", "/a/..//evil.com", "/%2e%2e//evil.com", "/a/%2e%2e//evil.com", "evil", "", null, undefined]) assert.equal(safeNext(bad), "/", String(bad));
});

test("passwords need 8 characters and emails an @", () => {
  assert.ok(passwordProblem("1234567"));
  assert.equal(passwordProblem("12345678"), null);
  assert.ok(validEmail("a@b.co"));
  assert.ok(!validEmail("nope"));
});

test("the CSP needs the nonce for scripts, allows Supabase, and forbids framing", () => {
  const csp = contentSecurityPolicy({ nonce: "abc", supabaseUrl: "http://127.0.0.1:54321", dev: false });
  assert.match(csp, /script-src 'self' 'nonce-abc' 'strict-dynamic'(;|$)/);
  assert.doesNotMatch(csp, /unsafe-eval/);
  assert.match(csp, /connect-src 'self' http:\/\/127\.0\.0\.1:54321 ws:\/\/127\.0\.0\.1:54321/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(contentSecurityPolicy({ nonce: "abc", dev: true }), /'unsafe-eval'/);
});
