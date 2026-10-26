import assert from "node:assert/strict";
import test from "node:test";
import { fetchPublicPage, isPublicAddress } from "../../src/lib/server/public-page.ts";

test("only public internet addresses pass", () => {
  for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700::6810:85e5"]) assert.equal(isPublicAddress(ip), true, ip);
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fe80::1", "fd00::1", "::ffff:10.0.0.1", "::ffff:127.0.0.1", "::10.0.0.1", "64:ff9b::a00:1", "2001:db8::1", "localhost", "not an ip"])
    assert.equal(isPublicAddress(ip), false, ip);
});

const html = (body: string, init: ResponseInit = {}) => new Response(body, { status: 200, headers: { "content-type": "text/html" }, ...init });
const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });
const publicDns = async () => ["93.184.216.34"];

test("a page on a public host is read; each redirect is followed and checked", async () => {
  const seen: string[] = [];
  const fake = (async (url: URL) => {
    seen.push(url.href);
    return url.hostname === "chat.openai.com" ? redirect("https://chatgpt.com/share/x") : html("<p>hi</p>");
  }) as unknown as typeof fetch;
  const page = await fetchPublicPage("https://chat.openai.com/share/x", { userAgent: "t", fetch: fake, lookup: publicDns, allowHost: (h) => ["chat.openai.com", "chatgpt.com"].includes(h) });
  assert.deepEqual(page, { ok: true, html: "<p>hi</p>", url: "https://chatgpt.com/share/x" });
  assert.deepEqual(seen, ["https://chat.openai.com/share/x", "https://chatgpt.com/share/x"]);
});

test("a host resolving to a private address, or a redirect to one, is refused before it's fetched", async () => {
  const fetched: string[] = [];
  const fake = (async (url: URL) => {
    fetched.push(url.hostname);
    return url.hostname === "public.example" ? redirect("http://internal.example/admin") : html("secret");
  }) as unknown as typeof fetch;
  const lookup = async (host: string) => (host === "public.example" ? ["93.184.216.34"] : ["10.0.0.5"]);
  const options = { userAgent: "t", fetch: fake, lookup, schemes: ["https:", "http:"] as const };
  assert.deepEqual(await fetchPublicPage("http://internal.example/", options), { ok: false, reason: "blocked" });
  assert.deepEqual(await fetchPublicPage("https://public.example/", options), { ok: false, reason: "blocked" });
  assert.deepEqual(await fetchPublicPage("http://169.254.169.254/latest/meta-data", options), { ok: false, reason: "blocked" });
  assert.deepEqual(fetched, ["public.example"]);
});

test("a redirect off the allowed hosts, too many redirects, or http where https is required is refused", async () => {
  const offHost = (async () => redirect("https://evil.example/")) as unknown as typeof fetch;
  assert.deepEqual(await fetchPublicPage("https://chatgpt.com/share/x", { userAgent: "t", fetch: offHost, lookup: publicDns, allowHost: (h) => h === "chatgpt.com" }), { ok: false, reason: "blocked" });
  const loop = (async () => redirect("https://chatgpt.com/share/x")) as unknown as typeof fetch;
  assert.deepEqual(await fetchPublicPage("https://chatgpt.com/share/x", { userAgent: "t", fetch: loop, lookup: publicDns }), { ok: false, reason: "unreachable" });
  assert.deepEqual(await fetchPublicPage("http://chatgpt.com/share/x", { userAgent: "t", fetch: loop, lookup: publicDns }), { ok: false, reason: "blocked" });
});

test("a page over the size cap, a body that fails mid-read, or a non-HTML answer is refused, never thrown", async () => {
  const big = (async () => html("x".repeat(2000))) as unknown as typeof fetch;
  assert.deepEqual(await fetchPublicPage("https://a.example/", { userAgent: "t", fetch: big, lookup: publicDns, maxBytes: 1000 }), { ok: false, reason: "too-big" });
  const broken = (async () =>
    new Response(new ReadableStream({ pull: (c) => c.error(new Error("connection reset")) }), { status: 200, headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
  assert.deepEqual(await fetchPublicPage("https://a.example/", { userAgent: "t", fetch: broken, lookup: publicDns }), { ok: false, reason: "unreachable" });
  const json = (async () => new Response("{}", { headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
  assert.deepEqual(await fetchPublicPage("https://a.example/", { userAgent: "t", fetch: json, lookup: publicDns }), { ok: false, reason: "not-html" });
});
