import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { LlmError, SPEND_LIMIT_MESSAGE, completeJson, retryable, usageOf } from "../src/lib/llm-server.ts";

/**
 * Bounded calls (Phase 4 plan, decision 10), against a fake `fetch` the SDK is given: a spend-limit
 * 429 is never retried and comes back as "budget used up"; a rate-limit 429 with retry-after and a
 * 5xx are retried, at most twice; every reply's token counts reach onUsage.
 */
const config = { provider: "anthropic" as const, model: "claude-opus-5-5", apiKey: "test-key" };
const Out = z.object({ ok: z.boolean() });

type Reply = { status: number; headers?: Record<string, string>; body: unknown } | { stream: { text: string; usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number } } };

/** A fetch that answers the Messages API with each reply in turn, as SSE for a success. */
function fakeFetch(replies: Reply[]) {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    const r = replies.shift();
    if (!r) throw new Error("the fake API ran out of replies");
    if ("stream" in r) {
      const { text, usage } = r.stream;
      const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
      const sse =
        ev("message_start", { message: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { ...usage, output_tokens: 1 } } }) +
        ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }) +
        ev("content_block_delta", { index: 0, delta: { type: "text_delta", text } }) +
        ev("content_block_stop", { index: 0 }) +
        ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: usage.output_tokens } }) +
        ev("message_stop", {});
      return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json", ...(r.headers ?? {}) } });
  };
  return { fetch: fetchImpl, calls };
}

const spendCap = {
  status: 429,
  body: { type: "error", error: { type: "rate_limit_error", message: "You have reached your API usage limits: your organization has crossed its monthly API usage threshold…", details: { error_code: "enforced_spend_limit_reached" } } },
};
const success = (usage = { input_tokens: 120, output_tokens: 30, cache_creation_input_tokens: 400, cache_read_input_tokens: 2000 }): Reply => ({ stream: { text: '{"ok":true}', usage } });

test("a spend-limit 429 is never retried and is reported as the budget being used up", async () => {
  const api = fakeFetch([spendCap, success()]);
  await assert.rejects(completeJson(config, "sys", "hi", Out, (t) => Out.parse(JSON.parse(t)), { fetch: api.fetch, retryBackoffMs: 1 }), (e: unknown) => e instanceof LlmError && e.status === 429 && e.spendLimit && e.message === SPEND_LIMIT_MESSAGE);
  assert.equal(api.calls.length, 1, "one request, no retry");
});

test("a spend limit the owner set (400) is reported the same way", async () => {
  const api = fakeFetch([{ status: 400, body: { type: "error", error: { type: "invalid_request_error", message: "You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC." } } }]);
  await assert.rejects(completeJson(config, "sys", "hi", Out, (t) => Out.parse(JSON.parse(t)), { fetch: api.fetch }), (e: unknown) => e instanceof LlmError && e.spendLimit);
  assert.equal(api.calls.length, 1);
});

test("a rate-limit 429 with retry-after and a 5xx are retried, at most twice, and the reply's tokens are metered", async () => {
  const usages: Array<{ u: ReturnType<typeof usageOf>; model: string }> = [];
  const api = fakeFetch([
    { status: 429, headers: { "retry-after": "0" }, body: { type: "error", error: { type: "rate_limit_error", message: "slow down" } } },
    { status: 529, body: { type: "error", error: { type: "overloaded_error", message: "busy" } } },
    success(),
  ]);
  const out = await completeJson(config, "sys", "hi", Out, (t) => Out.parse(JSON.parse(t)), { fetch: api.fetch, retryBackoffMs: 1, onUsage: (u, model) => void usages.push({ u, model }) });
  assert.deepEqual(out, { ok: true });
  assert.equal(api.calls.length, 3);
  assert.deepEqual(usages, [{ u: { inputTokens: 120, outputTokens: 30, cacheWriteTokens: 400, cacheReadTokens: 2000 }, model: "claude-opus-5-5" }]);
  const first = api.calls[0].body as { stream: boolean; max_tokens: number };
  assert.equal(first.stream, true, "every call streams");
  assert.equal(first.max_tokens, 16000);
});

test("a reply cut off mid-stream is metered with the tokens seen so far before the retry", async () => {
  const api = fakeFetch([success()]);
  const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  // First attempt: the start of a reply, then the connection drops.
  const dropped: typeof fetch = async () => {
    const body = new ReadableStream({
      start(c) {
        const enc = new TextEncoder();
        c.enqueue(enc.encode(ev("message_start", { message: { id: "msg_0", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5000, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } })));
        c.enqueue(enc.encode(ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } })));
        c.enqueue(enc.encode(ev("message_delta", { delta: { stop_reason: null, stop_sequence: null }, usage: { output_tokens: 20000 } })));
        // Erroring a stream discards what is still queued, so let the chunks be read first.
        setTimeout(() => c.error(new Error("connection reset")), 30);
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  let first = true;
  const fetchImpl: typeof fetch = (input, init) => (first ? ((first = false), dropped(input, init)) : api.fetch(input, init));
  const usages: Array<{ u: ReturnType<typeof usageOf>; model: string }> = [];
  const out = await completeJson(config, "sys", "hi", Out, (t) => Out.parse(JSON.parse(t)), { fetch: fetchImpl, retryBackoffMs: 1, onUsage: (u, model) => void usages.push({ u, model }) });
  assert.deepEqual(out, { ok: true });
  assert.equal(usages.length, 2, "the cut-off attempt and the successful one");
  assert.deepEqual(usages[0], { u: { inputTokens: 5000, outputTokens: 20000, cacheWriteTokens: 0, cacheReadTokens: 0 }, model: "claude-opus-5-5" });
});

test("a third transient failure gives up; a 400 is never retried", async () => {
  const overloaded = { status: 529, body: { type: "error", error: { type: "overloaded_error", message: "busy" } } };
  const api = fakeFetch([overloaded, overloaded, overloaded, success()]);
  await assert.rejects(completeJson(config, "sys", "hi", Out, (t) => Out.parse(JSON.parse(t)), { fetch: api.fetch, retryBackoffMs: 1 }), (e: unknown) => e instanceof LlmError && e.status === 502);
  assert.equal(api.calls.length, 3, "one try and two retries");
  const bad = fakeFetch([{ status: 400, body: { type: "error", error: { type: "invalid_request_error", message: "nope" } } }, success()]);
  await assert.rejects(completeJson(config, "sys", "hi", Out, (t) => Out.parse(JSON.parse(t)), { fetch: bad.fetch, retryBackoffMs: 1 }), (e: unknown) => e instanceof LlmError && e.status === 400 && !e.spendLimit);
  assert.equal(bad.calls.length, 1);
});

test("retryable: only transient failures, never a spend limit", () => {
  assert.equal(retryable(new Error("plain")), false);
});
