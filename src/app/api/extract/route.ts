import { type LlmConfig, PROVIDERS, llmReady } from "@/lib/llm";
import { LlmError, completeJson } from "@/lib/llm-server";
import { EXTRACTION_SYSTEM, ExtractionSchema, type DocumentText, extractionPrompt, parseExtraction } from "@/lib/extraction";

/**
 * POST /api/extract — turn one document's text into topics + quiz questions
 * using the student's connected model (or the server key as a fallback).
 * Body: { llm, course: {name, short}, existingTopics: string[], document: DocumentText }
 */

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_CHARS = 180_000;

interface Body {
  llm?: Partial<LlmConfig> | null;
  course?: { name?: string; short?: string };
  existingTopics?: string[];
  document?: Partial<DocumentText>;
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const doc = body.document;
  if (!doc || typeof doc.filename !== "string" || !Array.isArray(doc.pages) || doc.pages.length === 0) {
    return Response.json({ error: "Send a document with at least one page of text." }, { status: 400 });
  }
  const pages = doc.pages
    .filter((p) => p && typeof p.text === "string")
    .map((p, i) => ({ n: typeof p.n === "number" ? p.n : i + 1, text: p.text.slice(0, 6000) }));
  let total = 0;
  const trimmed = pages.filter((p) => (total += p.text.length) <= MAX_CHARS);
  if (trimmed.join("").length === 0 || pages.every((p) => p.text.trim().length < 20)) {
    return Response.json({ error: "That PDF has no readable text (it may be scanned images)." }, { status: 422 });
  }

  const course = { name: body.course?.name ?? "this course", short: body.course?.short ?? "this course" };
  const existingTopics = Array.isArray(body.existingTopics) ? body.existingTopics.filter((t) => typeof t === "string") : [];

  const raw = body.llm;
  const student: LlmConfig | null =
    raw && typeof raw.provider === "string" && raw.provider in PROVIDERS
      ? { provider: raw.provider, model: String(raw.model ?? "").trim(), apiKey: String(raw.apiKey ?? "").trim(), baseUrl: typeof raw.baseUrl === "string" ? raw.baseUrl : undefined }
      : null;
  const serverKey = process.env.ANTHROPIC_API_KEY;
  const config: LlmConfig | null = llmReady(student) ? student : serverKey ? { provider: "anthropic", model: "claude-opus-5-5", apiKey: serverKey } : null;
  if (!config) return Response.json({ error: "Connect your AI in Settings first." }, { status: 400 });

  try {
    const prompt = extractionPrompt(course, { filename: doc.filename, type: doc.type ?? "PDF", pages: trimmed }, existingTopics);
    const extraction = await completeJson(config, EXTRACTION_SYSTEM, prompt, ExtractionSchema, parseExtraction);
    return Response.json({ extraction, model: config.model, slidesRead: trimmed.length, slidesTotal: pages.length });
  } catch (error) {
    if (error instanceof LlmError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "Extraction failed." }, { status: 500 });
  }
}
