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

/* ── Prompting (shared so the browser-only path matches the server) ──── */

export interface ChatCourseContext {
  name: string;
  short: string;
  topics: Array<{ name: string; status: string }>;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export const SYSTEM_BASE = `You are Orca, a calm, encouraging study tutor inside a spaced-repetition app for college students.
Keep answers short and concrete (usually under 120 words). Prefer one worked example over a lecture.
When asked to quiz, ask ONE question at a time and wait for the answer before revealing anything.
When explaining, start from what the student likely already knows and build up.
Never pretend to have read course files you were not given.`;

export function systemFor(course: ChatCourseContext | null | undefined) {
  if (!course) return SYSTEM_BASE;
  const topics = course.topics.map((t) => `${t.name} (${t.status})`).join(", ");
  return `${SYSTEM_BASE}\n\nThe student is working in "${course.name}" (${course.short}). Topics on their path: ${topics}. "current" is what they are studying now.`;
}

/** Demo-mode replies when no model is connected. */
export function cannedReply(messages: ChatTurn[], course: ChatCourseContext | null | undefined) {
  const last = messages.at(-1)?.content.toLowerCase() ?? "";
  const topic = course?.topics.find((t) => t.status === "current")?.name ?? "your current topic";
  if (last.includes("quiz")) {
    return `Let's warm up on ${topic}. First question: in one sentence, what problem does ${topic} solve, and when would you reach for it? Answer in your own words and I'll check it.`;
  }
  if (last.includes("plan")) {
    return `Here's a light plan for the week: two 5-minute quick reviews on ${topic} (today and Thursday), one 30-minute deep session on the weekend, and a quick pass over anything you missed the night before class. Want me to put those on your calendar?`;
  }
  if (last.includes("explain")) {
    return `Think of ${topic} as a shortcut: instead of checking every case by hand, you look for patterns that let you collapse several cases into one rule. Start with the simplest example you can, write out every case, then circle the ones that behave the same. That circling is the whole idea.`;
  }
  return `I'm in demo mode: no AI is connected yet. Connect the model you already use under Settings → Your AI and I'll answer for real. Until then, ask me to "quiz me", "explain it simply", or "plan my week".`;
}

/* ── OpenAI-compatible wire helpers (used by the server route and the Ollama browser path) ── */

export function compatBaseUrl(c: LlmConfig) {
  return (c.baseUrl || PROVIDERS[c.provider].baseUrl || "").replace(/\/+$/, "");
}

export async function compatChat(c: LlmConfig, system: string, messages: ChatTurn[], signal?: AbortSignal): Promise<string> {
  const res = await fetch(`${compatBaseUrl(c)}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(c.apiKey ? { authorization: `Bearer ${c.apiKey}` } : {}),
      ...(c.provider === "openrouter" ? { "HTTP-Referer": "https://orca.study", "X-Title": "Orca" } : {}),
    },
    body: JSON.stringify({
      model: c.model,
      messages: [{ role: "system", content: system }, ...messages],
      max_tokens: 1024,
    }),
    signal,
  });
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
