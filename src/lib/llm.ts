/**
 * Bring-your-own-LLM. Students connect the model they already pay for; Orca
 * never stores their key server-side. The config lives in the browser (store →
 * localStorage) and rides along with each chat request.
 *
 * Shared between client and server: no secrets, no SDK imports here.
 */

export type LlmProvider = "anthropic" | "openai" | "gemini" | "openrouter" | "ollama";

export interface LlmConfig {
  provider: LlmProvider;
  model: string;
  apiKey: string;
  /** Only for self-hosted / OpenAI-compatible endpoints (Ollama, LM Studio…). */
  baseUrl?: string;
}

export interface ProviderInfo {
  label: string;
  /** Best-effort defaults; the settings panel fetches the live list from the provider. */
  defaultModel: string;
  suggestedModels: string[];
  keyUrl?: string;
  keyPlaceholder: string;
  needsKey: boolean;
  /** OpenAI-compatible base URL (everything except Anthropic goes through this shape). */
  baseUrl?: string;
  /** Called from the browser, not our server (local models). */
  browserOnly?: boolean;
  blurb: string;
}

export const PROVIDERS: Record<LlmProvider, ProviderInfo> = {
  anthropic: {
    label: "Claude (Anthropic)",
    defaultModel: "claude-opus-5-5",
    suggestedModels: ["claude-opus-5-5", "claude-fable-5-1", "claude-sonnet-5-5", "claude-haiku-4-5"],
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyPlaceholder: "sk-ant-…",
    needsKey: true,
    blurb: "Uses your Anthropic API key. Opus 5.5 is the default.",
  },
  openai: {
    label: "OpenAI",
    defaultModel: "",
    suggestedModels: [],
    keyUrl: "https://platform.openai.com/api-keys",
    keyPlaceholder: "sk-…",
    needsKey: true,
    baseUrl: "https://api.openai.com/v1",
    blurb: "Uses your OpenAI API key. Pick a model after connecting.",
  },
  gemini: {
    label: "Gemini (Google)",
    defaultModel: "",
    suggestedModels: [],
    keyUrl: "https://aistudio.google.com/app/apikey",
    keyPlaceholder: "AIza…",
    needsKey: true,
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    blurb: "Uses a Google AI Studio key. Pick a model after connecting.",
  },
  openrouter: {
    label: "OpenRouter",
    defaultModel: "",
    suggestedModels: [],
    keyUrl: "https://openrouter.ai/keys",
    keyPlaceholder: "sk-or-…",
    needsKey: true,
    baseUrl: "https://openrouter.ai/api/v1",
    blurb: "One key, hundreds of models.",
  },
  ollama: {
    label: "Ollama (local)",
    defaultModel: "",
    suggestedModels: [],
    keyPlaceholder: "not needed",
    needsKey: false,
    baseUrl: "http://localhost:11434/v1",
    browserOnly: true,
    blurb: "Runs on your own computer. Start Ollama with OLLAMA_ORIGINS set to this site.",
  },
};

export const PROVIDER_ORDER: LlmProvider[] = ["anthropic", "openai", "gemini", "openrouter", "ollama"];

export function llmReady(c: LlmConfig | null | undefined): c is LlmConfig {
  if (!c || !c.model) return false;
  const p = PROVIDERS[c.provider];
  return p.needsKey ? c.apiKey.trim().length > 0 : true;
}

/** "claude-opus-5-5" → "Claude Opus 5.5", "gpt-4.1-mini" → "GPT 4.1 Mini". */
export function modelLabel(id: string) {
  const bare = id.split("/").pop() ?? id;
  return bare
    .replace(/^claude-/, "Claude ")
    .replace(/-(\d+)-(\d+)(?=$|-)/, " $1.$2")
    .replace(/-/g, " ")
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\bGpt\b/, "GPT");
}

/* ── Extraction and grading wire helpers ──── */

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/* ── OpenAI-compatible wire helpers (used by the server route and the Ollama browser path) ── */

export function compatBaseUrl(c: LlmConfig) {
  return (c.baseUrl || PROVIDERS[c.provider].baseUrl || "").replace(/\/+$/, "");
}

export interface CompatOptions {
  maxTokens?: number;
  /** Ask for a JSON object reply (OpenAI `response_format`). Retried without it if the provider rejects it. */
  json?: boolean;
  signal?: AbortSignal;
}

export async function compatChat(c: LlmConfig, system: string, messages: ChatTurn[], opts: CompatOptions = {}): Promise<string> {
  const attempt = (json: boolean) =>
    fetch(`${compatBaseUrl(c)}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(c.apiKey ? { authorization: `Bearer ${c.apiKey}` } : {}),
      ...(c.provider === "openrouter" ? { "HTTP-Referer": "https://orca.study", "X-Title": "Orca" } : {}),
    },
      body: JSON.stringify({
        model: c.model,
        messages: [{ role: "system", content: system }, ...messages],
        max_tokens: opts.maxTokens ?? 1024,
        ...(json ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: opts.signal,
    });
  let res = await attempt(Boolean(opts.json));
  if (!res.ok && opts.json && res.status === 400) res = await attempt(false);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${PROVIDERS[c.provider].label} returned ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }> };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) return content.map((p) => p.text ?? "").join("").trim();
  return "";
}

export async function compatModels(c: Pick<LlmConfig, "provider" | "apiKey" | "baseUrl">, signal?: AbortSignal): Promise<string[]> {
  const res = await fetch(`${compatBaseUrl(c as LlmConfig)}/models`, {
    headers: c.apiKey ? { authorization: `Bearer ${c.apiKey}` } : {},
    signal,
  });
  if (!res.ok) throw new Error(`${PROVIDERS[c.provider].label} returned ${res.status} when listing models`);
  const data = (await res.json()) as { data?: Array<{ id: string }> };
  return (data.data ?? []).map((m) => m.id).filter(Boolean).sort();
}
