import { type ChatCourseContext, type ChatTurn, type LlmConfig, PROVIDERS, cannedReply, llmReady } from "@/lib/llm";
import { LlmError, completeChat } from "@/lib/llm-server";

/**
 * POST /api/chat — Orca's study tutor.
 *
 * Body: { messages, course?, llm? }
 *   llm = the student's own provider/model/key (bring-your-own-LLM). Keys are used for this
 *   request only and never stored or logged.
 * Precedence: student's model → server ANTHROPIC_API_KEY (Opus 5.5) → canned demo reply.
 */

export const runtime = "nodejs";

interface ChatBody {
  messages?: ChatTurn[];
  course?: Partial<ChatCourseContext> | null;
  llm?: Partial<LlmConfig> | null;
}

function normaliseCourse(raw: ChatBody["course"]): ChatCourseContext | null {
  if (!raw || typeof raw.name !== "string" || typeof raw.short !== "string") return null;
  return {
    name: raw.name,
    short: raw.short,
    topics: Array.isArray(raw.topics)
      ? raw.topics.filter((t) => t && typeof t.name === "string").map((t) => ({ name: t.name, status: String(t.status ?? "") }))
      : [],
  };
}

function normaliseLlm(raw: ChatBody["llm"]): LlmConfig | null {
  if (!raw || typeof raw.provider !== "string" || !(raw.provider in PROVIDERS)) return null;
  return {
    provider: raw.provider,
    model: typeof raw.model === "string" ? raw.model.trim() : "",
    apiKey: typeof raw.apiKey === "string" ? raw.apiKey.trim() : "",
    baseUrl: typeof raw.baseUrl === "string" ? raw.baseUrl.trim() : undefined,
  };
}

export async function POST(request: Request) {
  let body: ChatBody;
  try {
    body = (await request.json()) as ChatBody;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const messages = (body.messages ?? []).filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim());
  if (messages.length === 0 || messages[0].role !== "user") {
    return Response.json({ error: "Send at least one user message." }, { status: 400 });
  }

  const course = normaliseCourse(body.course);
  const student = normaliseLlm(body.llm);
  const serverKey = process.env.ANTHROPIC_API_KEY;

  const config: LlmConfig | null = llmReady(student)
    ? student
    : serverKey
      ? { provider: "anthropic", model: "claude-opus-5-5", apiKey: serverKey }
      : null;

  if (!config) {
    return Response.json({ reply: cannedReply(messages, course), demo: true });
  }

  try {
    const reply = await completeChat(config, course, messages);
    return Response.json({ reply, model: config.model });
  } catch (error) {
    if (error instanceof LlmError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "Something went wrong talking to your model." }, { status: 500 });
  }
}
