import assert from "node:assert/strict";
import { test } from "node:test";
import { isGuestOnlyPath, isPublicPath, safeNext } from "../src/lib/auth/paths.ts";
import { SiteUrlError, linkOrigin } from "../src/lib/auth/site.ts";
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

test("emailed links come from SITE_URL; production never builds them from the Host header", () => {
  assert.equal(linkOrigin({ siteUrl: "https://orca.example/", production: true }), "https://orca.example");
  assert.equal(linkOrigin({ siteUrl: " https://orca.example/some/path?x=1 ", production: true, host: "evil.example" }), "https://orca.example");
  assert.equal(linkOrigin({ siteUrl: "http://localhost:3100", production: true }), "http://localhost:3100", "a local address may be plain http");
  assert.throws(() => linkOrigin({ siteUrl: "http://orca.example", production: true }), SiteUrlError, "https only in production");
  assert.throws(() => linkOrigin({ siteUrl: "orca.example", production: false }), SiteUrlError);
  assert.throws(() => linkOrigin({ siteUrl: "javascript:alert(1)", production: false }), SiteUrlError);
  // Development without SITE_URL: the request's host, http for local addresses.
  assert.equal(linkOrigin({ siteUrl: undefined, production: false, host: "localhost:3100", proto: null }), "http://localhost:3100");
  assert.equal(linkOrigin({ siteUrl: undefined, production: false, host: "preview.example", proto: "https" }), "https://preview.example");
  assert.throws(() => linkOrigin({ siteUrl: undefined, production: false, host: "evil.example/path", proto: null }), SiteUrlError);
  // Production without SITE_URL: no link, whatever the request says.
  assert.throws(() => linkOrigin({ siteUrl: undefined, production: true, host: "orca.example", proto: "https" }), SiteUrlError);
});
