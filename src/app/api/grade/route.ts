import { type LlmConfig, PROVIDERS, llmReady } from "@/lib/llm";
import { LlmError, completeJson } from "@/lib/llm-server";
import { GRADE_SYSTEM, GradeSchema, gradePrompt, parseGradeLoose } from "@/lib/grading";
import type { AnswerRubric } from "@/lib/data";

/** POST { llm?, question, rubric, response } → GradeResult. Short free-text answers only. */
export const runtime = "nodejs";

interface Body {
  llm?: Partial<LlmConfig> | null;
  question?: string;
  rubric?: AnswerRubric;
  response?: string;
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const { question, rubric } = body;
  const response = typeof body.response === "string" ? body.response.trim().slice(0, 2000) : "";
  if (!question || !rubric || !Array.isArray(rubric.requiredIdeas) || !response) {
    return Response.json({ error: "Send question, rubric and a response." }, { status: 400 });
  }
  const raw = body.llm;
  const student: LlmConfig | null =
    raw && typeof raw.provider === "string" && raw.provider in PROVIDERS
      ? { provider: raw.provider, model: String(raw.model ?? "").trim(), apiKey: String(raw.apiKey ?? "").trim(), baseUrl: typeof raw.baseUrl === "string" ? raw.baseUrl : undefined }
      : null;
  const serverKey = process.env.ANTHROPIC_API_KEY;
  const config: LlmConfig | null = llmReady(student) ? student : serverKey ? { provider: "anthropic", model: "claude-opus-5-5", apiKey: serverKey } : null;
  if (!config) return Response.json({ error: "No model available to grade this answer." }, { status: 400 });

  try {
    const safeRubric: AnswerRubric = {
      requiredIdeas: rubric.requiredIdeas.filter((s) => typeof s === "string"),
      acceptableAlternatives: Array.isArray(rubric.acceptableAlternatives) ? rubric.acceptableAlternatives.filter((s) => typeof s === "string") : [],
      knownMisconceptions: Array.isArray(rubric.knownMisconceptions) ? rubric.knownMisconceptions.filter((m) => m && typeof m.description === "string") : [],
    };
    const result = await completeJson(config, GRADE_SYSTEM, gradePrompt(String(question), safeRubric, response), GradeSchema, parseGradeLoose, { effort: "low", maxTokens: 1024 });
    return Response.json(result);
  } catch (error) {
    if (error instanceof LlmError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "Grading failed." }, { status: 500 });
  }
}
