import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { LlmError, NO_CREDIT_MESSAGE, SPEND_LIMIT_MESSAGE, completeJson } from "../src/lib/llm-server.ts";
import type { TokenUsage } from "../src/lib/pricing.ts";

/**
 * The OpenAI path (Responses API), against a fake `fetch`: strict Structured Outputs, the material
 * cached explicitly, the same bounds as Anthropic (a quota refusal is the spend limit and never
 * retried; a 429 with retry-after and a 5xx are, at most twice), and every reply's tokens metered.
 */
const config = { provider: "openai" as const, model: "gpt-6.1-sol", apiKey: "test-key", baseUrl: "http://127.0.0.1:9/v1" };
const Out = z.object({ ok: z.boolean(), note: z.string().max(10).nullable() });
const parse = (t: string) => Out.parse(JSON.parse(t));

type Reply = { status: number; headers?: Record<string, string>; body: unknown };

function fakeFetch(replies: Reply[]) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, body: JSON.parse(String(init?.body)) });
    const r = replies.shift();
    if (!r) throw new Error("the fake API ran out of replies");
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json", ...(r.headers ?? {}) } });
  };
  return { fetch: fetchImpl, calls };
}

const usage = { input_tokens: 10_000, output_tokens: 300, input_tokens_details: { cached_tokens: 6_000, cache_write_tokens: 2_000 } };
const reply = (text: string, extra: object = {}): Reply => ({
  status: 200,
  body: { model: "gpt-6.1-sol-2026-04-30", status: "completed", output: [{ type: "reasoning" }, { type: "message", content: [{ type: "output_text", text }] }], usage, ...extra },
});

test("a call sends a strict schema and caches only the material, and its tokens are metered", async () => {
  const api = fakeFetch([reply('{"ok":true,"note":null}')]);
  const usages: Array<{ u: TokenUsage; model: string }> = [];
  const out = await completeJson(config, "sys", "the question", Out, parse, { context: "the material", effort: "high", maxTokens: 500, onUsage: (u, model) => void usages.push({ u, model }), fetch: api.fetch });
  assert.deepEqual(out, { ok: true, note: null });
  assert.equal(api.calls[0].url, "http://127.0.0.1:9/v1/responses");
  const body = api.calls[0].body as { instructions: string; input: Array<{ content: Array<Record<string, unknown>> }>; text: { format: { strict: boolean; schema: { required: string[]; additionalProperties: boolean } } }; prompt_cache_options: unknown; reasoning: unknown; max_output_tokens: number; store: boolean };
  assert.equal(body.instructions, "sys");
  assert.deepEqual(body.input[0].content, [
    { type: "input_text", text: "the material", prompt_cache_breakpoint: { mode: "explicit" } },
    { type: "input_text", text: "the question" },
  ]);
  assert.deepEqual(body.prompt_cache_options, { mode: "explicit" });
  assert.equal(body.text.format.strict, true);
  assert.deepEqual(body.text.format.schema.required, ["ok", "note"]);
  assert.equal(body.text.format.schema.additionalProperties, false);
  assert.deepEqual(body.reasoning, { effort: "high" });
  assert.equal(body.max_output_tokens, 500);
  assert.equal(body.store, false);
  // input_tokens includes the cached and cache-written ones.
  assert.deepEqual(usages, [{ u: { inputTokens: 2_000, outputTokens: 300, cacheWriteTokens: 2_000, cacheReadTokens: 6_000 }, model: "gpt-6.1-sol-2026-04-30" }]);
});

test("a quota refusal is the spend limit: reported as the budget used up, never retried", async () => {
  const api = fakeFetch([{ status: 429, body: { error: { message: "You exceeded your current quota", type: "insufficient_quota", code: "insufficient_quota" } } }, reply('{"ok":true,"note":null}')]);
  await assert.rejects(completeJson(config, "sys", "hi", Out, parse, { fetch: api.fetch, retryBackoffMs: 1 }), (e: unknown) => e instanceof LlmError && e.status === 429 && e.spendLimit && e.message === SPEND_LIMIT_MESSAGE);
  assert.equal(api.calls.length, 1);
  const broke = fakeFetch([{ status: 429, body: { error: { message: "You have no credits remaining.", type: "insufficient_quota", code: "credit_balance_exhausted" } } }]);
  await assert.rejects(completeJson(config, "sys", "hi", Out, parse, { fetch: broke.fetch, retryBackoffMs: 1 }), (e: unknown) => e instanceof LlmError && e.spendLimit && e.message === NO_CREDIT_MESSAGE);
  assert.equal(broke.calls.length, 1);
});

test("a 429 with retry-after and a 5xx are retried at most twice; a 429 without it and a 400 are not", async () => {
  const api = fakeFetch([
    { status: 429, headers: { "retry-after": "0.001" }, body: { error: { message: "Rate limit reached", type: "rate_limit_error" } } },
    { status: 500, body: { error: { message: "oops", type: "server_error" } } },
    reply('{"ok":true,"note":"x"}'),
  ]);
  assert.deepEqual(await completeJson(config, "sys", "hi", Out, parse, { fetch: api.fetch, retryBackoffMs: 1 }), { ok: true, note: "x" });
  assert.equal(api.calls.length, 3);
  const busy = { status: 503, body: { error: { message: "busy" } } };
  const giveUp = fakeFetch([busy, busy, busy, reply('{"ok":true,"note":null}')]);
  await assert.rejects(completeJson(config, "sys", "hi", Out, parse, { fetch: giveUp.fetch, retryBackoffMs: 1 }), (e: unknown) => e instanceof LlmError && e.status === 502);
  assert.equal(giveUp.calls.length, 3);
  const limited = fakeFetch([{ status: 429, body: { error: { message: "Rate limit reached", type: "rate_limit_error" } } }]);
  await assert.rejects(completeJson(config, "sys", "hi", Out, parse, { fetch: limited.fetch, retryBackoffMs: 1 }), (e: unknown) => e instanceof LlmError && e.status === 429 && !e.spendLimit);
  assert.equal(limited.calls.length, 1);
  const bad = fakeFetch([{ status: 400, body: { error: { message: "bad schema", type: "invalid_request_error" } } }]);
  await assert.rejects(completeJson(config, "sys", "hi", Out, parse, { fetch: bad.fetch, retryBackoffMs: 1 }), (e: unknown) => e instanceof LlmError && e.status === 400 && /bad schema/.test(e.message));
});

test("a cut-off, refused or malformed reply fails with a reason, and is still metered", async () => {
  let metered = 0;
  const onUsage = () => void metered++;
  const cut = fakeFetch([reply('{"ok":', { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } })]);
  await assert.rejects(completeJson(config, "sys", "hi", Out, parse, { fetch: cut.fetch, onUsage }), (e: unknown) => e instanceof LlmError && e.status === 413);
  const refused = fakeFetch([{ status: 200, body: { model: "gpt-6.1-sol", status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }], usage } }]);
  await assert.rejects(completeJson(config, "sys", "hi", Out, parse, { fetch: refused.fetch, onUsage }), (e: unknown) => e instanceof LlmError && e.status === 422);
  const wrong = fakeFetch([reply('{"ok":"yes"}')]);
  await assert.rejects(completeJson(config, "sys", "hi", Out, parse, { fetch: wrong.fetch, onUsage }), (e: unknown) => e instanceof LlmError && e.status === 502 && /expected shape/.test(e.message));
  assert.equal(metered, 3);
});

test("an older model gets no explicit cache options and a model without reasoning no effort", async () => {
  const api = fakeFetch([reply('{"ok":true,"note":null}')]);
  await completeJson({ ...config, model: "gpt-4.1" }, "sys", "hi", Out, parse, { context: "m", fetch: api.fetch });
  const body = api.calls[0].body as Record<string, unknown> & { input: Array<{ content: Array<Record<string, unknown>> }> };
  assert.equal(body.prompt_cache_options, undefined);
  assert.equal(body.reasoning, undefined);
  assert.equal(body.input[0].content[0].prompt_cache_breakpoint, undefined);
});
