import test from "node:test";
import assert from "node:assert/strict";
import { CanvasError, canvasClient } from "../../src/lib/canvas/client.ts";

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;
const fakeFetch = (handle: Handler) => ((input: URL | RequestInfo, init?: RequestInit) => handle(new URL(String(input)), init ?? {})) as unknown as typeof fetch;
const json = (body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } });

test("the site must be an https origin", () => {
  assert.throws(() => canvasClient({ baseUrl: "http://canvas.test", token: "t" }), CanvasError);
  assert.throws(() => canvasClient({ baseUrl: "https://canvas.test/courses", token: "t" }), CanvasError);
  assert.doesNotThrow(() => canvasClient({ baseUrl: "https://courseworks2.columbia.edu", token: "t" }));
});

test("getAll sends the token, asks for 100 a page and follows Link next until the last page", async () => {
  const calls: string[] = [];
  const client = canvasClient({
    baseUrl: "https://canvas.test",
    token: "secret",
    fetch: fakeFetch((url, init) => {
      calls.push(url.href);
      assert.equal(new Headers(init.headers).get("authorization"), "Bearer secret");
      const page = url.searchParams.get("page") ?? "1";
      if (page === "1") return json([{ id: 1 }, { id: 2 }], { link: '<https://canvas.test/api/v1/courses?per_page=100&page=2>; rel="next"' });
      return json([{ id: 3 }]);
    }),
  });
  const all = await client.getAll<{ id: number }>("/courses", { enrollment_state: "active" });
  assert.deepEqual(all.map((c) => c.id), [1, 2, 3]);
  assert.equal(calls[0], "https://canvas.test/api/v1/courses?per_page=100&enrollment_state=active");
  assert.equal(calls[1], "https://canvas.test/api/v1/courses?per_page=100&page=2");
});

test("a 401 says the token was refused; a next page on another site is refused", async () => {
  const unauthorized = canvasClient({ baseUrl: "https://canvas.test", token: "t", fetch: fakeFetch(() => new Response("", { status: 401 })) });
  await assert.rejects(unauthorized.get("/users/self"), (e: unknown) => e instanceof CanvasError && e.status === 401);
  const elsewhere = canvasClient({ baseUrl: "https://canvas.test", token: "t", fetch: fakeFetch(() => json([{ id: 1 }], { link: '<https://evil.test/api/v1/x?page=2>; rel="next"' })) });
  await assert.rejects(elsewhere.getAll("/courses"), (e: unknown) => e instanceof CanvasError && /another site/.test(e.message));
});

test("download follows the signed redirect without the token and refuses big files", async () => {
  const seen: Array<{ href: string; auth: string | null }> = [];
  const client = canvasClient({
    baseUrl: "https://canvas.test",
    token: "secret",
    fetch: fakeFetch((url, init) => {
      seen.push({ href: url.href, auth: new Headers(init.headers).get("authorization") });
      if (url.hostname === "canvas.test") return new Response(null, { status: 302, headers: { location: "https://storage.test/blob?sig=1" } });
      return new Response(new Uint8Array([37, 80, 68, 70]), { status: 200, headers: { "content-length": "4" } });
    }),
  });
  const bytes = await client.download("https://canvas.test/files/9/download?download_frd=1", 1024);
  assert.deepEqual([...bytes], [37, 80, 68, 70]);
  assert.deepEqual(seen, [
    { href: "https://canvas.test/files/9/download?download_frd=1", auth: "Bearer secret" },
    { href: "https://storage.test/blob?sig=1", auth: null },
  ]);
  await assert.rejects(client.download("https://canvas.test/files/9/download", 2), (e: unknown) => e instanceof CanvasError && e.status === 413);
  await assert.rejects(client.download("https://other.test/files/9/download", 1024), CanvasError);
});

test("every hop is checked: a redirect to a private address is refused, on downloads and on API calls (2026-11-08)", async () => {
  const seen: string[] = [];
  const client = canvasClient({
    baseUrl: "https://canvas.test",
    token: "secret",
    hopAllowed: async (url) => url.hostname !== "10.0.0.5",
    fetch: fakeFetch((url) => {
      seen.push(url.href);
      if (url.hostname === "canvas.test") return new Response(null, { status: 302, headers: { location: "https://10.0.0.5/secret" } });
      return new Response("leaked", { status: 200 });
    }),
  });
  await assert.rejects(client.download("https://canvas.test/files/9/download", 1024), (e: unknown) => e instanceof CanvasError && /won't fetch/.test(e.message));
  await assert.rejects(client.get("/courses"), (e: unknown) => e instanceof CanvasError && /won't fetch/.test(e.message));
  assert.ok(seen.every((href) => !href.includes("10.0.0.5")), "the private host was never fetched");
  // Without a check, https is still required.
  const plain = canvasClient({ baseUrl: "https://canvas.test", token: "t", fetch: fakeFetch(() => new Response(null, { status: 302, headers: { location: "http://canvas.test/x" } })) });
  await assert.rejects(plain.get("/courses"), (e: unknown) => e instanceof CanvasError && /off https/.test(e.message));
});
