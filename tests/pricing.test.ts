import test from "node:test";
import assert from "node:assert/strict";
import { MODEL_PRICES, UnpricedModelError, costUsd, totalTokens } from "../src/lib/pricing.ts";
import { ORCA_MODEL } from "../src/lib/server/model.ts";

test("Orca's model has a recorded price", () => {
  assert.ok(MODEL_PRICES[ORCA_MODEL], `${ORCA_MODEL} must be in MODEL_PRICES before any call is metered`);
});

test("a call's cost follows the published per-million prices, cache writes and reads included", () => {
  // Opus 5.5: $4 in, $20 out, $5 cache write, $0.20 cache read per million.
  const u = { inputTokens: 100_000, outputTokens: 10_000, cacheWriteTokens: 50_000, cacheReadTokens: 200_000 };
  assert.equal(costUsd("claude-opus-5-5", u), 0.89);
  assert.equal(totalTokens(u), 360_000);
  assert.equal(costUsd("claude-haiku-4-5", { inputTokens: 1_000_000, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 }), 1);
  assert.equal(costUsd("claude-opus-5-5", { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 }), 0.000024);
  assert.throws(() => costUsd("claude-made-up", u), UnpricedModelError);
});
