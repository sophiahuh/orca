import { PROVIDERS, type LlmProvider } from "@/lib/llm";
import { LlmError, listModels } from "@/lib/llm-server";

/** POST { provider, apiKey, baseUrl? } → { models: string[] }. Doubles as "test connection". */
export async function POST(request: Request) {
  let body: { provider?: LlmProvider; apiKey?: string; baseUrl?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const provider = body.provider;
  if (!provider || !(provider in PROVIDERS)) return Response.json({ error: "Unknown provider." }, { status: 400 });
  if (PROVIDERS[provider].browserOnly) return Response.json({ error: "List this provider's models from the browser." }, { status: 400 });
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (PROVIDERS[provider].needsKey && !apiKey) return Response.json({ error: "Add an API key first." }, { status: 400 });

  try {
    const models = await listModels({ provider, apiKey, baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : undefined });
    return Response.json({ models });
  } catch (error) {
    if (error instanceof LlmError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "Couldn't list models." }, { status: 502 });
  }
}
