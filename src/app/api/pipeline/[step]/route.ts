import type { z } from "zod";
import { type LlmConfig, PROVIDERS, llmReady } from "@/lib/llm";
import { LlmError, completeJson } from "@/lib/llm-server";
import { buildPrompt } from "@/lib/pipeline/prompts";
import { parseLooseJson } from "@/lib/pipeline/parse";
import { STEPS, type StepName } from "@/lib/pipeline/schemas";
import { STEP_BUDGET } from "@/lib/pipeline/budget";

/**
 * POST /api/pipeline/{extract|reconcile|generate|solve|ambiguity|agreement|reflect}
 * Body: { llm?, input } → { output, model }. The prompt is built here from the step's structured
 * input, so the route never forwards arbitrary prompts on Orca's key. Uses the student's model when
 * they connected one, else the server's ANTHROPIC_API_KEY.
 */
export const runtime = "nodejs";
export const maxDuration = 300;


export async function POST(request: Request, { params }: { params: Promise<{ step: string }> }) {
  const { step } = await params;
  if (!(step in STEPS)) return Response.json({ error: `Unknown step "${step}".` }, { status: 404 });
  const name = step as StepName;

  let body: { llm?: Partial<LlmConfig> | null; input?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsedInput = STEPS[name].input.safeParse(body.input);
  if (!parsedInput.success) return Response.json({ error: `Bad ${name} input: ${parsedInput.error.issues[0]?.message ?? "invalid"}` }, { status: 400 });

  const raw = body.llm;
  const student: LlmConfig | null =
    raw && typeof raw.provider === "string" && raw.provider in PROVIDERS
      ? { provider: raw.provider, model: String(raw.model ?? "").trim(), apiKey: String(raw.apiKey ?? "").trim(), baseUrl: typeof raw.baseUrl === "string" ? raw.baseUrl : undefined }
      : null;
  const serverKey = process.env.ANTHROPIC_API_KEY;
  const config: LlmConfig | null = llmReady(student) ? student : serverKey ? { provider: "anthropic", model: "claude-opus-5-5", apiKey: serverKey } : null;
  if (!config) return Response.json({ error: "Connect your AI in Settings first." }, { status: 400 });

  try {
    const built = buildPrompt(name, parsedInput.data as never);
    const schema: z.ZodType<unknown> = STEPS[name].output;
    const output = await completeJson(config, built.system, built.prompt, schema, (text) => schema.parse(parseLooseJson(text)), { ...STEP_BUDGET[name], context: built.context });
    return Response.json({ output, model: config.model });
  } catch (error) {
    if (error instanceof LlmError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: `The ${name} step failed.` }, { status: 500 });
  }
}
