/**
 * Server-side completion. Anthropic goes through the official SDK; everyone
 * else speaks the OpenAI-compatible chat.completions shape.
 * Never log or persist `config.apiKey`.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { type ChatCourseContext, type ChatTurn, type LlmConfig, PROVIDERS, compatChat, systemFor } from "./llm";

export class LlmError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

/** Models that accept `output_config.effort` and server-side refusal fallbacks. */
const EFFORT_MODELS = /^claude-(opus|sonnet|fable|mythos)-5|^claude-opus-4-[678]/;
const FALLBACK_MODELS = /^claude-(opus-5|sonnet-5-5|fable-5|mythos-5)/;

async function anthropicChat(config: LlmConfig, system: string, messages: ChatTurn[]) {
  const client = new Anthropic({ apiKey: config.apiKey });
  const useFallbacks = FALLBACK_MODELS.test(config.model);
  const effort = EFFORT_MODELS.test(config.model) ? ({ effort: "low" } as const) : undefined;

  try {
    const response = useFallbacks
      ? await client.beta.messages.create({
          model: config.model,
          max_tokens: 2048,
          system,
          output_config: effort,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          messages,
        })
      : await client.messages.create({
          model: config.model,
          max_tokens: 2048,
          system,
          output_config: effort,
          messages,
        });

    if (response.stop_reason === "refusal") {
      return "I can't help with that one, but I'm happy to keep going on your coursework.";
    }
    const text = response.content
      .filter((b): b is Extract<(typeof response.content)[number], { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    return text || "…";
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) throw new LlmError("Anthropic rejected that API key.", 401);
    if (error instanceof Anthropic.NotFoundError) throw new LlmError(`Anthropic doesn't know the model "${config.model}".`, 400);
    if (error instanceof Anthropic.RateLimitError) throw new LlmError("Anthropic is rate-limiting you. Try again in a moment.", 429);
    if (error instanceof Anthropic.BadRequestError) throw new LlmError(`Anthropic rejected the request: ${error.message}`, 400);
    if (error instanceof Anthropic.APIError) throw new LlmError(`Anthropic error (${error.status}).`, 502);
    throw error;
  }
}

function mapAnthropicError(error: unknown, model: string): never {
  if (error instanceof Anthropic.AuthenticationError) throw new LlmError("Anthropic rejected that API key.", 401);
  if (error instanceof Anthropic.NotFoundError) throw new LlmError(`Anthropic doesn't know the model "${model}".`, 400);
  if (error instanceof Anthropic.RateLimitError) throw new LlmError("Anthropic is rate-limiting you. Try again in a moment.", 429);
  if (error instanceof Anthropic.BadRequestError) throw new LlmError(`Anthropic rejected the request: ${error.message}`, 400);
  if (error instanceof Anthropic.APIError) throw new LlmError(`Anthropic error (${error.status}).`, 502);
  throw error;
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
  opts: { effort?: "low" | "medium"; maxTokens?: number } = {},
): Promise<T> {
  if (PROVIDERS[config.provider].browserOnly) {
    throw new LlmError(`${PROVIDERS[config.provider].label} runs in your browser, not on the server.`, 400);
  }
  if (config.provider === "anthropic") {
    const client = new Anthropic({ apiKey: config.apiKey });
    try {
      const response = await client.messages.parse({
        model: config.model,
        max_tokens: opts.maxTokens ?? 16000,
        system,
        output_config: { format: zodOutputFormat(schema), ...(EFFORT_MODELS.test(config.model) ? { effort: opts.effort ?? "medium" } : {}) },
        messages: [{ role: "user", content: prompt }],
      });
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
    text = await compatChat(config, system, [{ role: "user", content: prompt }], { maxTokens: opts.maxTokens ?? 16000, json: true });
  } catch (error) {
    throw new LlmError(error instanceof Error ? error.message : "The model provider returned an error.", 502);
  }
  try {
    return parseLoose(text);
  } catch (error) {
    throw new LlmError(`The model's reply didn't match the expected shape: ${error instanceof Error ? error.message.slice(0, 160) : "parse error"}`, 502);
  }
}

export async function completeChat(config: LlmConfig, course: ChatCourseContext | null, messages: ChatTurn[]) {
  const system = systemFor(course);
  if (PROVIDERS[config.provider].browserOnly) {
    throw new LlmError(`${PROVIDERS[config.provider].label} runs in your browser, not on the server.`, 400);
  }
  if (config.provider === "anthropic") return anthropicChat(config, system, messages);
  try {
    return await compatChat(config, system, messages);
  } catch (error) {
    throw new LlmError(error instanceof Error ? error.message : "The model provider returned an error.", 502);
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
  const { compatModels } = await import("./llm");
  try {
    return await compatModels(config);
  } catch (error) {
    throw new LlmError(error instanceof Error ? error.message : "Couldn't list models.", 502);
  }
}
