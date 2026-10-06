/**
 * Which model Orca's server runs on, from its environment. Pure (takes the environment as an
 * argument); loads under plain Node, so the server, the scripts and the tests resolve it the same way.
 *
 * - `ORCA_MODEL_PROVIDER` picks the provider: `openai` or `anthropic`. Set, it is the only provider
 *   used, and a missing key for it is a configuration error (thrown, never a quiet "no model").
 *   Unset, OpenAI is used when `OPENAI_API_KEY` is set, else Anthropic when `ANTHROPIC_API_KEY` is,
 *   else there is no model (uploads are stored without generating anything; prose is self-marked).
 * - `ORCA_MODEL` overrides the provider's default model. It must have a price in
 *   `src/lib/pricing.ts`, since every call is metered (decision 10).
 * - `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL` point the provider elsewhere (the tests' fake API).
 */
import { priceOf } from "./pricing.ts";

export type ServerProvider = "anthropic" | "openai";

export const SERVER_PROVIDERS: Readonly<Record<ServerProvider, { keyVar: string; baseUrlVar: string; defaultModel: string; label: string }>> = Object.freeze({
  anthropic: { keyVar: "ANTHROPIC_API_KEY", baseUrlVar: "ANTHROPIC_BASE_URL", defaultModel: "claude-opus-5-5", label: "Anthropic" },
  openai: { keyVar: "OPENAI_API_KEY", baseUrlVar: "OPENAI_BASE_URL", defaultModel: "gpt-6-luna", label: "OpenAI" },
});

/** The order an unset `ORCA_MODEL_PROVIDER` tries the keys in. */
const AUTO_ORDER: ServerProvider[] = ["openai", "anthropic"];

export interface ServerModel {
  provider: ServerProvider;
  model: string;
  apiKey: string;
  /** Only when the environment points the provider elsewhere. */
  baseUrl?: string;
}

/** The server's model settings contradict each other or name something Orca can't run. */
export class ModelConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelConfigError";
  }
}

type Env = Record<string, string | undefined>;

function chosenProvider(env: Env): ServerProvider | null {
  const raw = env.ORCA_MODEL_PROVIDER?.trim().toLowerCase();
  if (raw) {
    if (raw !== "anthropic" && raw !== "openai") throw new ModelConfigError(`ORCA_MODEL_PROVIDER is "${env.ORCA_MODEL_PROVIDER}"; it must be "openai" or "anthropic" (or unset).`);
    if (!env[SERVER_PROVIDERS[raw].keyVar]) throw new ModelConfigError(`ORCA_MODEL_PROVIDER is "${raw}" but ${SERVER_PROVIDERS[raw].keyVar} isn't set.`);
    return raw;
  }
  return AUTO_ORDER.find((p) => Boolean(env[SERVER_PROVIDERS[p].keyVar])) ?? null;
}

/** The model the server calls, or null when no key is set. Throws `ModelConfigError` for a bad setting. */
export function resolveServerModel(env: Env): ServerModel | null {
  const provider = chosenProvider(env);
  if (!provider) return null;
  const info = SERVER_PROVIDERS[provider];
  const model = env.ORCA_MODEL?.trim() || info.defaultModel;
  if (model.startsWith("claude-") !== (provider === "anthropic")) throw new ModelConfigError(`ORCA_MODEL "${model}" isn't an ${info.label} model, but the provider is ${provider}.`);
  if (!priceOf(model)) throw new ModelConfigError(`ORCA_MODEL "${model}" has no price in src/lib/pricing.ts; Orca won't call a model it can't meter.`);
  const baseUrl = env[info.baseUrlVar]?.trim();
  return { provider, model, apiKey: env[info.keyVar]!, ...(baseUrl ? { baseUrl } : {}) };
}

/** Whether `m`'s calls go to this machine (the tests' fake API) rather than the provider. */
export function callsAreLocal(m: ServerModel | null): boolean {
  if (!m?.baseUrl) return false;
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(m.baseUrl).hostname);
  } catch {
    return false;
  }
}
