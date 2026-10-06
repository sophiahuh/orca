/**
 * What a model call costs (Phase 4 plan, decision 10): the per-million-token prices of the models
 * Orca may run on, copied from Anthropic's pricing page, never from memory. Metering multiplies a
 * call's token counts by these and stores the result in `model_usage`; the daily budgets sum it.
 * Pure; loads under plain Node.
 *
 * Source: https://platform.claude.com/docs/en/about-claude/pricing, read 2026-10-06. Cache reads
 * are 0.05× base input on Opus 5.5 and 0.025× on Fable 5.1 (the page's footnotes), 0.1× elsewhere;
 * a 5-minute cache write is 1.25× base input. When a price changes, change it here and say so in
 * the commit.
 *
 * OpenAI (the server may run on it instead; `src/lib/model-config.ts`): Standard tier, from
 * https://developers.openai.com/api/docs/pricing and the GPT-6.1 Sol model page, read 2026-10-06.
 * OpenAI has one cache-write price (its cache lives 30 minutes), recorded in both write fields; a
 * prompt over 272K input tokens is billed at 2× input and cache rates and 1.5× output for the whole
 * request (`longContext`).
 */

/** USD per million tokens. */
export interface ModelPrice {
  input: number;
  output: number;
  /** Writing a prompt prefix to the 5-minute cache (what `completeJson` uses). */
  cacheWrite5m: number;
  /** Writing to the 1-hour cache (unused today; recorded so a change of cache length is priced right). */
  cacheWrite1h: number;
  cacheRead: number;
  /** A request whose input passes `overInputTokens` is billed at these multiples throughout (OpenAI). */
  longContext?: { overInputTokens: number; inputX: number; outputX: number };
}

const OPENAI_LONG = { overInputTokens: 272_000, inputX: 2, outputX: 1.5 } as const;

export const PRICES_READ_ON = "2026-10-06";

export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = Object.freeze({
  "claude-opus-5-5": { input: 4, output: 20, cacheWrite5m: 5, cacheWrite1h: 8, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5 },
  "claude-fable-5-1": { input: 10, output: 50, cacheWrite5m: 12.5, cacheWrite1h: 20, cacheRead: 0.25 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.2 },
  "claude-sonnet-5": { input: 2, output: 10, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.2 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheWrite5m: 1.25, cacheWrite1h: 2, cacheRead: 0.1 },
  "gpt-6-astra": { input: 10, output: 50, cacheWrite5m: 12.5, cacheWrite1h: 12.5, cacheRead: 1, longContext: OPENAI_LONG },
  "gpt-6.1-sol": { input: 2, output: 10, cacheWrite5m: 2.5, cacheWrite1h: 2.5, cacheRead: 0.1, longContext: OPENAI_LONG },
  "gpt-6-luna": { input: 0.1, output: 0.5, cacheWrite5m: 0.125, cacheWrite1h: 0.125, cacheRead: 0.01, longContext: OPENAI_LONG },
});

/** A call's token counts, as the Messages API reports them in `usage`. */
export interface TokenUsage {
  /** Input tokens after the last cache breakpoint (not the whole prompt). */
  inputTokens: number;
  outputTokens: number;
  /** Tokens written to the prompt cache this call. */
  cacheWriteTokens: number;
  /** Tokens read from the prompt cache this call. */
  cacheReadTokens: number;
}

export const NO_USAGE: TokenUsage = Object.freeze({ inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 });

/** Every token the call was billed for. */
export function totalTokens(u: TokenUsage): number {
  return u.inputTokens + u.outputTokens + u.cacheWriteTokens + u.cacheReadTokens;
}

export class UnpricedModelError extends Error {
  constructor(model: string) {
    super(`No price is recorded for model "${model}" (src/lib/pricing.ts); Orca won't meter a call it can't price`);
    this.name = "UnpricedModelError";
  }
}

/** The price for a model id, also when the API answers with a dated snapshot of a priced model (`…-20260301`, OpenAI's `…-2026-03-01`). */
export function priceOf(model: string): ModelPrice | null {
  return MODEL_PRICES[model] ?? MODEL_PRICES[model.replace(/-(\d{8}|\d{4}-\d{2}-\d{2})$/, "")] ?? null;
}

/** The call's cost in USD (5-minute cache writes). Throws for a model with no recorded price. */
export function costUsd(model: string, u: TokenUsage): number {
  const p = priceOf(model);
  if (!p) throw new UnpricedModelError(model);
  const allInput = u.inputTokens + u.cacheWriteTokens + u.cacheReadTokens;
  const long = p.longContext && allInput > p.longContext.overInputTokens ? p.longContext : null;
  const inX = long?.inputX ?? 1;
  const perToken = (price: number) => price / 1_000_000;
  const cost = u.inputTokens * perToken(p.input * inX) + u.outputTokens * perToken(p.output * (long?.outputX ?? 1)) + u.cacheWriteTokens * perToken(p.cacheWrite5m * inX) + u.cacheReadTokens * perToken(p.cacheRead * inX);
  // Six decimals, as the model_usage column stores it.
  return Math.round(cost * 1_000_000) / 1_000_000;
}
