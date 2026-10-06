/**
 * Server-side completion. Anthropic goes through the official SDK; OpenAI through its Responses
 * API (strict Structured Outputs, explicit prompt caching, the same bounds and metering); everyone
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
import { openAiJsonSchema } from "./openai-schema.ts";
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
/** The provider account has no prepaid credit left (OpenAI's `credit_balance_exhausted`): nothing resets it but adding credit. */
export const NO_CREDIT_MESSAGE = "Orca's model account is out of credit. Nothing can be generated or graded until Orca's owner adds more.";

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
  if (error instanceof OpenAiError) {
    if (error.spendLimit) return false;
    if (error.status === 429) return error.retryAfterS !== null;
    return error.status === null || error.status >= 500;
  }
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

/**
 * A failed OpenAI request: `status` null when it never got an answer (connection, timeout). Billing
 * and quota refusals (`insufficient_quota`; developers.openai.com/api/docs/guides/error-codes, read
 * 2026-10-06) are the spend limit: never retried.
 */
export class OpenAiError extends Error {
  readonly status: number | null;
  readonly type: string | null;
  readonly code: string | null;
  readonly retryAfterS: number | null;
  readonly timedOut: boolean;
  constructor(message: string, opts: { status?: number | null; type?: string | null; code?: string | null; retryAfterS?: number | null; timedOut?: boolean } = {}) {
    super(message);
    this.name = "OpenAiError";
    this.status = opts.status ?? null;
    this.type = opts.type ?? null;
    this.code = opts.code ?? null;
    this.retryAfterS = opts.retryAfterS ?? null;
    this.timedOut = opts.timedOut ?? false;
  }
  get spendLimit(): boolean {
    return this.type === "insufficient_quota" || this.code === "insufficient_quota";
  }
}

/** The Responses API's token counts. Its `input_tokens` includes the cached and cache-written ones. */
export function openAiUsageOf(usage: { input_tokens: number; output_tokens: number; input_tokens_details?: { cached_tokens?: number | null; cache_write_tokens?: number | null } | null }): TokenUsage {
  const cacheReadTokens = usage.input_tokens_details?.cached_tokens ?? 0;
  const cacheWriteTokens = usage.input_tokens_details?.cache_write_tokens ?? 0;
  return { inputTokens: Math.max(0, usage.input_tokens - cacheReadTokens - cacheWriteTokens), outputTokens: usage.output_tokens, cacheWriteTokens, cacheReadTokens };
}

/** OpenAI models that take `reasoning.effort`. */
const OPENAI_REASONING_MODELS = /^(gpt-5|gpt-6|o\d)/;
/** OpenAI models with explicit prompt caching (GPT-5.6 and later): only the material is cached. */
const OPENAI_EXPLICIT_CACHE_MODELS = /^gpt-(5\.6|6)/;

function mapOpenAiError(error: unknown, model: string): never {
  if (!(error instanceof OpenAiError)) throw error;
  if (error.spendLimit) throw new LlmError(error.code === "credit_balance_exhausted" ? NO_CREDIT_MESSAGE : SPEND_LIMIT_MESSAGE, 429, { spendLimit: true });
  if (error.timedOut) throw new LlmError(`The model didn't answer within ${Math.round(LIMITS.modelTimeoutMs / 60_000)} minutes.`, 504);
  if (error.status === null) throw new LlmError("Couldn't reach OpenAI.", 502);
  if (error.status === 401) throw new LlmError("OpenAI rejected that API key.", 401);
  if (error.status === 404) throw new LlmError(`OpenAI doesn't know the model "${model}".`, 400);
  if (error.status === 429) throw new LlmError("OpenAI is rate-limiting you. Try again in a moment.", 429);
  if (error.status === 400) throw new LlmError(`OpenAI rejected the request: ${error.message}`, 400);
  throw new LlmError(`OpenAI error (${error.status}).`, 502);
}

interface OpenAiResponse {
  model?: string;
  status?: string;
  incomplete_details?: { reason?: string } | null;
  error?: { message?: string } | null;
  usage?: Parameters<typeof openAiUsageOf>[0];
  output?: Array<{ type: string; content?: Array<{ type: string; text?: string; refusal?: string }> }>;
}

/** One Responses API call (no retries; `completeJson` wraps it in `withRetries`). */
async function openAiRequest(config: LlmConfig, body: object, fetchImpl: typeof globalThis.fetch): Promise<OpenAiResponse> {
  const base = (config.baseUrl ?? PROVIDERS.openai.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  let res: Response;
  try {
    res = await fetchImpl(`${base}/responses`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(LIMITS.modelTimeoutMs),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new OpenAiError(error instanceof Error ? error.message : String(error), { timedOut });
  }
  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    let detail: { message?: string; type?: string; code?: string } = {};
    try {
      detail = (JSON.parse(raw) as { error?: typeof detail }).error ?? {};
    } catch {
      // Not JSON: the status says enough.
    }
    const after = Number(res.headers.get("retry-after"));
    throw new OpenAiError(detail.message ?? (raw.slice(0, 200) || `HTTP ${res.status}`), { status: res.status, type: detail.type ?? null, code: detail.code ?? null, retryAfterS: Number.isFinite(after) && after > 0 ? after : null });
  }
  return (await res.json()) as OpenAiResponse;
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
      const after = error instanceof Anthropic.APIError ? Number(error.headers?.get("retry-after")) : error instanceof OpenAiError ? (error.retryAfterS ?? NaN) : NaN;
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
    const client = new Anthropic({ apiKey: config.apiKey, maxRetries: 0, timeout: LIMITS.modelTimeoutMs, ...(config.baseUrl ? { baseURL: config.baseUrl } : {}), ...(opts.fetch ? { fetch: opts.fetch } : {}) });
    const fallback = FALLBACK_MODELS.test(config.model);
    try {
      // Streamed: a long reply (generate may write 24k tokens) would outlast a plain request, which the
      // SDK refuses to send; finalMessage() gathers it and parses it against the schema the same way.
      const response = await withRetries(
        async () => {
          const stream = client.beta.messages.stream({
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
          });
          // The tokens arrive before the content (message_start) and grow with it (message_delta). Kept
          // so a reply cut off by the timeout or a dropped connection is still metered: it was paid for.
          const seen: { partial: { usage: TokenUsage; model: string } | null } = { partial: null };
          stream.on("streamEvent", (ev) => {
            if (ev.type === "message_start") seen.partial = { usage: usageOf(ev.message), model: ev.message.model || config.model };
            else if (ev.type === "message_delta" && seen.partial) {
              const u = ev.usage;
              const was = seen.partial.usage;
              seen.partial = {
                ...seen.partial,
                usage: {
                  inputTokens: u.input_tokens ?? was.inputTokens,
                  outputTokens: u.output_tokens,
                  cacheWriteTokens: u.cache_creation_input_tokens ?? was.cacheWriteTokens,
                  cacheReadTokens: u.cache_read_input_tokens ?? was.cacheReadTokens,
                },
              };
            }
          });
          try {
            return await stream.finalMessage();
          } catch (error) {
            const { partial } = seen;
            if (partial && opts.onUsage) {
              try {
                await opts.onUsage(partial.usage, partial.model);
              } catch (meterError) {
                console.error(`A cut-off model reply couldn't be metered: ${meterError instanceof Error ? meterError.message : String(meterError)}`);
              }
            }
            // A connection that drops mid-reply surfaces as the stream's raw error, not an SDK one: it is a connection failure (retried, within the limit).
            if (error instanceof Anthropic.APIError) throw error;
            throw new Anthropic.APIConnectionError({ message: `The reply stream failed: ${error instanceof Error ? error.message : String(error)}`, cause: error instanceof Error ? error : undefined });
          }
        },
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
  if (config.provider === "openai") {
    const explicitCache = OPENAI_EXPLICIT_CACHE_MODELS.test(config.model);
    const body = {
      model: config.model,
      instructions: system,
      input: [
        {
          role: "user",
          content: [
            ...(opts.context ? [{ type: "input_text", text: opts.context, ...(explicitCache ? { prompt_cache_breakpoint: { mode: "explicit" } } : {}) }] : []),
            { type: "input_text", text: prompt },
          ],
        },
      ],
      max_output_tokens: opts.maxTokens ?? 16000,
      text: { format: { type: "json_schema", name: "orca_output", schema: openAiJsonSchema(schema), strict: true } },
      // Explicit mode: only the material (the breakpoint above) is written to the cache, never a one-off prompt.
      ...(explicitCache ? { prompt_cache_options: { mode: "explicit" } } : {}),
      ...(OPENAI_REASONING_MODELS.test(config.model) ? { reasoning: { effort: opts.effort ?? "medium" } } : {}),
      store: false,
    };
    try {
      // Not streamed: a reply cut off by the timeout reports no token counts, so it can't be metered.
      const response = await withRetries(() => openAiRequest(config, body, opts.fetch ?? globalThis.fetch), { backoffMs: opts.retryBackoffMs });
      if (response.usage && opts.onUsage) await opts.onUsage(openAiUsageOf(response.usage), response.model || config.model);
      if (response.status === "incomplete") {
        if (response.incomplete_details?.reason === "max_output_tokens") throw new LlmError("The material is too long for one pass. Try a smaller file.", 413);
        throw new LlmError("The model declined to process this material.", 422);
      }
      if (response.status === "failed") throw new LlmError(`OpenAI couldn't finish the reply: ${response.error?.message ?? "no reason given"}`, 502);
      const parts = (response.output ?? []).filter((o) => o.type === "message").flatMap((o) => o.content ?? []);
      if (parts.some((p) => p.type === "refusal")) throw new LlmError("The model declined to process this material.", 422);
      const out = parts.filter((p) => p.type === "output_text").map((p) => p.text ?? "").join("");
      try {
        return parseLoose(out);
      } catch (error) {
        throw new LlmError(`The model's reply didn't match the expected shape: ${error instanceof Error ? error.message.slice(0, 160) : "parse error"}`, 502);
      }
    } catch (error) {
      if (error instanceof LlmError) throw error;
      mapOpenAiError(error, config.model);
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
