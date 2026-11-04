import test from "node:test";
import assert from "node:assert/strict";

/** The Canvas token at rest (`src/lib/server/canvas.ts`): round-trips, and a tampered or foreign value is refused. */
test("a Canvas token encrypts to something unreadable and decrypts back; tampering is refused", async () => {
  const saved = { ...process.env };
  Object.assign(process.env, { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "pk", SUPABASE_SECRET_KEY: "sb_secret_test_key_1234567890" });
  try {
    const { decryptToken, encryptToken, canvasSite } = await import("../../src/lib/server/canvas.ts");
    const token = "7~abcDEF123456789abcDEF123456789abcDEF123456789";
    const stored = encryptToken(token);
    assert.ok(stored.startsWith("v1."));
    assert.equal(stored.includes(token), false);
    assert.notEqual(encryptToken(token), stored, "a fresh nonce each time");
    assert.equal(decryptToken(stored), token);
    const [v, iv, tag, ct] = stored.split(".");
    assert.throws(() => decryptToken(`${v}.${iv}.${tag}.${ct.slice(0, -2)}AA`));
    assert.throws(() => decryptToken("plain-text"));

    // The site must be https, path-free and on the public internet (the token is sent there).
    const publicDns = async () => ["128.59.1.1"];
    assert.equal(await canvasSite("https://courseworks2.columbia.edu", publicDns), "https://courseworks2.columbia.edu");
    assert.equal(await canvasSite("  https://canvas.test/  ", publicDns), "https://canvas.test");
    await assert.rejects(canvasSite("http://canvas.test", publicDns), /https/);
    await assert.rejects(canvasSite("https://canvas.test/courses/1", publicDns), /no path/);
    await assert.rejects(canvasSite("https://canvas.internal", async () => ["10.0.0.4"]), /reach/);
    await assert.rejects(canvasSite("https://169.254.169.254", publicDns), /reach/);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});
