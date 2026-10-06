/**
 * Server-side completion. Anthropic goes through the official SDK; everyone
 * else speaks the OpenAI-compatible chat.completions shape.
 * Never log or persist `config.apiKey`.
 *
 * Bounded calls (Phase 4 plan, decision 10): every call has a timeout (`LIMITS.modelTimeoutMs`),
 * at most `LIMITS.modelRetries` retries, and retries only what's transient: connection failures,
 * 5xx and 529, and a 429 that carries `retry-after`. A spend-limit 429 (the organization's monthly
 * cap; no `retry-after`, `error_code: enforced_spend_limit_reached`) and a 400 from a spend limit
 * the owner set ("You have reached your specified … usage limits") are never retried and come back
 * as `LlmError` 429 with `spendLimit`, which callers show as "Orca's model budget is used up for
 * this month". Every reply's token counts go to `opts.onUsage`, which the server uses to meter.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { LIMITS } from "./limits.ts";
import { type LlmConfig, PROVIDERS, compatChat } from "./llm.ts";
import type { TokenUsage } from "./pricing.ts";
import type { ModelCtx } from "./server/model.ts";

export class LlmError extends Error {
  status: number;
  /** The provider refused because Orca's spend limit for the month is reached: never retried, never paid for. */
  spendLimit: boolean;
  constructor(message: string, status = 502, opts: { spendLimit?: boolean } = {}) {
    super(message);
    this.status = status;
    this.spendLimit = opts.spendLimit ?? false;
  }
}

export const SPEND_LIMIT_MESSAGE = "Orca's model budget is used up for this month. Nothing can be generated or graded until it resets.";

/** How the API says a spend limit is reached (platform.claude.com/docs/en/api/rate-limits, read 2026-10-06). */
type ApiError = InstanceType<typeof Anthropic.APIError>;

function isSpendLimit(error: ApiError): boolean {
  const body = error.error as { error?: { details?: { error_code?: string }; message?: string } } | undefined;
  const code = body?.error?.details?.error_code;
  const message = body?.error?.message ?? error.message ?? "";
  if (code === "enforced_spend_limit_reached") return true;
  if (error.status === 429 && !error.headers?.get("retry-after") && /usage limits/i.test(message)) return true;
  return error.status === 400 && /You have reached your specified (workspace )?API usage limits/i.test(message);
}

/** Whether a failed attempt may be tried again: only transient failures, and never a spend limit. */
export function retryable(error: unknown): boolean {
  if (error instanceof Anthropic.APIError) {
    if (isSpendLimit(error)) return false;
    if (error.status === 429) return Boolean(error.headers?.get("retry-after"));
    return error.status === undefined || error.status >= 500;
  }
  return error instanceof Anthropic.APIConnectionError;
}

/** The token counts of a reply, as the API reports them (cache writes and reads separately). */
export function usageOf(message: { usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null } }): TokenUsage {
  const u = message.usage;
  return { inputTokens: u.input_tokens, outputTokens: u.output_tokens, cacheWriteTokens: u.cache_creation_input_tokens ?? 0, cacheReadTokens: u.cache_read_input_tokens ?? 0 };
}

/** Models that accept `output_config.effort`. */
const EFFORT_MODELS = /^claude-(opus|sonnet|fable|mythos)-5|^claude-opus-4-[678]/;

/**
 * Models with safety classifiers that take server-side refusal fallbacks (`fallbacks: "default"`
 * routes a declined request to a model that can answer it, inside the same call).
 */
const FALLBACK_MODELS = /^claude-(fable-5-1|opus-5-5|opus-5|sonnet-5-5)$/;

function mapAnthropicError(error: unknown, model: string): never {
  if (error instanceof Anthropic.APIError && isSpendLimit(error)) throw new LlmError(SPEND_LIMIT_MESSAGE, 429, { spendLimit: true });
  if (error instanceof Anthropic.AuthenticationError) throw new LlmError("Anthropic rejected that API key.", 401);
  if (error instanceof Anthropic.NotFoundError) throw new LlmError(`Anthropic doesn't know the model "${model}".`, 400);
  if (error instanceof Anthropic.RateLimitError) throw new LlmError("Anthropic is rate-limiting you. Try again in a moment.", 429);
  if (error instanceof Anthropic.BadRequestError) throw new LlmError(`Anthropic rejected the request: ${error.message}`, 400);
  if (error instanceof Anthropic.APIConnectionTimeoutError) throw new LlmError(`The model didn't answer within ${Math.round(LIMITS.modelTimeoutMs / 60_000)} minutes.`, 504);
  if (error instanceof Anthropic.APIConnectionError) throw new LlmError("Couldn't reach Anthropic.", 502);
  if (error instanceof Anthropic.APIError) throw new LlmError(`Anthropic error (${error.status}).`, 502);
  throw error;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run `attempt` up to 1 + `LIMITS.modelRetries` times, backing off, honouring `retry-after`, for transient failures only. */
async function withRetries<T>(attempt: () => Promise<T>, opts: { retries?: number; backoffMs?: number } = {}): Promise<T> {
  const retries = opts.retries ?? LIMITS.modelRetries;
  const backoff = opts.backoffMs ?? 500;
  for (let n = 0; ; n++) {
    try {
      return await attempt();
    } catch (error) {
      if (n >= retries || !retryable(error)) throw error;
      const after = error instanceof Anthropic.APIError ? Number(error.headers?.get("retry-after")) : NaN;
      await sleep(Number.isFinite(after) && after > 0 ? Math.min(after, 60) * 1000 : backoff * 2 ** n);
    }
  }
}

/**
 * One-shot structured completion. Anthropic uses structured outputs (schema-enforced);
 * OpenAI-compatible providers get JSON mode plus a lenient parse + zod validation.
 */
export async function completeJson<T>(
  config: LlmConfig,
  system: string,
  prompt: string,
  schema: z.ZodType<T>,
  parseLoose: (text: string) => T,
  opts: {
    effort?: "low" | "medium" | "high";
    maxTokens?: number;
    /** Long text sent before `prompt` and cached (e.g. the material shared by every call of one upload). */
    context?: string | null;
    /** Who the call is for and why (`ModelCtx`); every call made with Orca's key passes it. */
    ctx?: ModelCtx;
    /** Called with every reply's token counts (also a refused or cut-off reply: those are paid for). The server meters here. */
    onUsage?: (usage: TokenUsage, model: string) => Promise<void> | void;
    /** Tests only: the SDK's fetch and the retry pacing. */
    fetch?: typeof globalThis.fetch;
    retryBackoffMs?: number;
  } = {},
): Promise<T> {
  if (PROVIDERS[config.provider].browserOnly) {
    throw new LlmError(`${PROVIDERS[config.provider].label} runs in your browser, not on the server.`, 400);
  }
  if (config.provider === "anthropic") {
    // The SDK's own retries are off: they would retry a spend-limit 429 too. withRetries decides.
    const client = new Anthropic({ apiKey: config.apiKey, maxRetries: 0, timeout: LIMITS.modelTimeoutMs, ...(opts.fetch ? { fetch: opts.fetch } : {}) });
    const fallback = FALLBACK_MODELS.test(config.model);
    try {
      // Streamed: a long reply (generate may write 24k tokens) would outlast a plain request, which the
      // SDK refuses to send; finalMessage() gathers it and parses it against the schema the same way.
      const response = await withRetries(
        () =>
          client.beta.messages
            .stream({
              model: config.model,
              max_tokens: opts.maxTokens ?? 16000,
              system,
              output_config: { format: betaZodOutputFormat(schema), ...(EFFORT_MODELS.test(config.model) ? { effort: opts.effort ?? "medium" } : {}) },
              messages: [
                {
                  role: "user",
                  content: [
                    ...(opts.context ? [{ type: "text" as const, text: opts.context, cache_control: { type: "ephemeral" as const } }] : []),
                    { type: "text" as const, text: prompt },
                  ],
                },
              ],
              ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
            })
            .finalMessage(),
        { backoffMs: opts.retryBackoffMs },
      );
      if (opts.onUsage) await opts.onUsage(usageOf(response), response.model || config.model);
      if (response.stop_reason === "refusal") throw new LlmError("The model declined to process this material.", 422);
      if (response.stop_reason === "max_tokens") throw new LlmError("The material is too long for one pass. Try a smaller file.", 413);
      if (response.parsed_output) return response.parsed_output;
      const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
      return parseLoose(text);
    } catch (error) {
      if (error instanceof LlmError) throw error;
      mapAnthropicError(error, config.model);
    }
  }
  let text: string;
  try {
    text = await compatChat(config, system, [{ role: "user", content: opts.context ? `${opts.context}\n\n${prompt}` : prompt }], { maxTokens: opts.maxTokens ?? 16000, json: true });
  } catch (error) {
    throw new LlmError(error instanceof Error ? error.message : "The model provider returned an error.", 502);
  }
  try {
    return parseLoose(text);
  } catch (error) {
    throw new LlmError(`The model's reply didn't match the expected shape: ${error instanceof Error ? error.message.slice(0, 160) : "parse error"}`, 502);
  }
}

export async function listModels(config: Pick<LlmConfig, "provider" | "apiKey" | "baseUrl">): Promise<string[]> {
  if (config.provider === "anthropic") {
    const client = new Anthropic({ apiKey: config.apiKey });
    try {
      const ids: string[] = [];
      for await (const m of client.models.list()) ids.push(m.id);
      return ids;
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) throw new LlmError("Anthropic rejected that API key.", 401);
      throw new LlmError("Couldn't reach Anthropic.", 502);
    }
  }
  const { compatModels } = await import("./llm.ts");
  try {
    return await compatModels(config);
  } catch (error) {
    throw new LlmError(error instanceof Error ? error.message : "Couldn't list models.", 502);
  }
}
