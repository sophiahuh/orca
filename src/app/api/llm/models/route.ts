import { PROVIDERS, type LlmProvider } from "@/lib/llm";
import { LlmError, listModels } from "@/lib/llm-server";
import { forStudent, reply } from "@/lib/server/student";

/**
 * POST { provider, apiKey } → { models: string[] }. Doubles as "test connection" for the hidden
 * "Your AI" settings (kept until bring-your-own model is decided). Needs a signed-in student. The
 * provider's own address is always used: a caller-named `baseUrl` would make this a request from
 * Orca's server to any URL (review finding, 2026-10-06), so it is refused.
 */
export async function POST(request: Request) {
  return forStudent(request, async () => {
    let body: { provider?: LlmProvider; apiKey?: string; baseUrl?: unknown };
    try {
      body = await request.json();
    } catch {
      return reply(400, { error: "Invalid JSON body." });
    }
    const provider = body.provider;
    if (!provider || !(provider in PROVIDERS)) return reply(400, { error: "Unknown provider." });
    if (body.baseUrl !== undefined) return reply(400, { error: "Orca only lists models from the provider's own address." });
    if (PROVIDERS[provider].browserOnly) return reply(400, { error: "List this provider's models from the browser." });
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    if (PROVIDERS[provider].needsKey && !apiKey) return reply(400, { error: "Add an API key first." });
    try {
      const models = await listModels({ provider, apiKey });
      return reply(200, { models });
    } catch (error) {
      if (error instanceof LlmError) return reply(error.status, { error: error.message });
      return reply(502, { error: "Couldn't list models." });
    }
  });
}
