/**
 * Course material → topics + quiz questions. Shared schema + prompt builder,
 * used by /api/extract and (for browser-only providers) the client.
 */
import { z } from "zod";
import type { QuizQuestion, Topic } from "./data";

export interface DocumentText {
  filename: string;
  type: string;
  pages: Array<{ n: number; text: string }>;
}

export const ExtractedTopic = z.object({
  name: z.string().min(1).max(60).describe("Short topic name as a student would say it, e.g. 'Karnaugh Maps'"),
  summary: z.string().min(1).max(400).describe("Two or three sentences a student could review from"),
  slideStart: z.number().int().min(1),
  slideEnd: z.number().int().min(1),
  keyTerms: z.array(z.string()).max(8),
});

export const ExtractedQuestion = z.object({
  topic: z.string().describe("Exactly one of the topic names above"),
  kind: z.enum(["Multiple choice", "True or false"]),
  prompt: z.string().min(1),
  options: z.array(z.string().min(1)).min(2).max(4),
  answer: z.number().int().min(0).describe("Index into options"),
  explanation: z.string().min(1).describe("One or two sentences; say why the right answer is right"),
  anchor: z.object({
    locator: z.string().describe("e.g. 'slide 14'"),
    excerpt: z.string().max(200).describe("Short quote or close paraphrase from that slide"),
  }),
  figureSlide: z.number().int().min(1).nullable().optional().describe("Slide number whose diagram or table the student must see to answer; null when the question stands alone"),
});

export const ExtractionSchema = z.object({
  topics: z.array(ExtractedTopic).min(1).max(8),
  questions: z.array(ExtractedQuestion).max(40),
});

export type Extraction = z.infer<typeof ExtractionSchema>;

export const EXTRACTION_SYSTEM = `You turn one piece of college course material into a short study trail for a spaced-repetition app.
Work only from the material you are given. Do not invent facts, and do not use outside knowledge for claims.
Return JSON only, matching the schema you are given, with no commentary.`;

export function extractionPrompt(course: { name: string; short: string }, doc: DocumentText, existingTopics: string[]) {
  const body = doc.pages
    .map((p) => `[slide ${p.n}]\n${p.text.trim()}`)
    .filter((s) => s.length > 12)
    .join("\n\n");

  const existing = existingTopics.length ? `Topics already on this course's trail: ${existingTopics.join(", ")}. Reuse an existing name only when the material is clearly the same topic; otherwise choose a new name.` : "";

  return `Course: ${course.name} (${course.short}).
Material: "${doc.filename}" (${doc.type}), ${doc.pages.length} slides.
${existing}

Tasks:
1. Split the material into 2 to 6 topics in the order they are taught. Skip logistics (syllabus, grading, office hours, contact details). A topic is something a student would review as a unit.
2. For each topic write 4 to 6 quiz questions a student can answer from memory in under a minute: recall or one-step application, never multi-step derivations or drawing. Use "True or false" for at most a third of them. Multiple choice needs exactly 4 plausible options with exactly one correct. Never copy a slide sentence verbatim as the prompt; paraphrase and apply the idea. Each question must cite the slide it comes from.
3. Each question gets a one or two sentence explanation that teaches, not just confirms.
4. Prefer questions that stand alone in words. When a question only makes sense with a diagram or table from a slide, set figureSlide to that slide number and phrase the prompt as "In the figure, …"; otherwise set figureSlide to null.

Output schema (JSON):
{
  "topics": [{ "name": string, "summary": string, "slideStart": number, "slideEnd": number, "keyTerms": string[] }],
  "questions": [{ "topic": string, "kind": "Multiple choice" | "True or false", "prompt": string, "options": string[], "answer": number, "explanation": string, "anchor": { "locator": string, "excerpt": string }, "figureSlide": number | null }]
}

Material follows.

${body}`;
}

/** Pull the first JSON object out of a model reply (handles code fences and chatter). */
export function parseExtraction(text: string): Extraction {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("The model did not return JSON.");
  const raw = JSON.parse(cleaned.slice(start, end + 1));
  return ExtractionSchema.parse(raw);
}

/* ── Turning an extraction into app data ─────────────────────────────── */

export function slugifyTopic(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function questionsByTopic(x: Extraction, filename: string, figures: Record<number, string> = {}): Record<string, QuizQuestion[]> {
  const out: Record<string, QuizQuestion[]> = {};
  const topicIds = new Map(x.topics.map((t) => [t.name.toLowerCase(), slugifyTopic(t.name)]));
  x.questions.forEach((q, i) => {
    const id = topicIds.get(q.topic.toLowerCase()) ?? slugifyTopic(q.topic);
    if (q.answer >= q.options.length) return; // malformed; skip rather than teach the wrong thing
    (out[id] ??= []).push({
      id: `${id}-${filename}-${i}`.replace(/[^a-z0-9-]+/gi, "-").toLowerCase(),
      kind: q.kind,
      topic: q.topic,
      prompt: q.prompt,
      options: q.options,
      answer: q.answer,
      explanation: q.explanation,
      anchor: q.anchor,
      figure: q.figureSlide && figures[q.figureSlide] ? { src: figures[q.figureSlide], alt: `Slide ${q.figureSlide} of ${filename}` } : undefined,
    });
  });
  return out;
}

export function topicsFrom(x: Extraction, filename: string): Array<Omit<Topic, "status" | "pos" | "lessonsDone">> {
  return x.topics.map((t) => ({
    id: slugifyTopic(t.name),
    name: t.name,
    summary: t.summary,
    lessons: 1,
    source: { filename, slideStart: t.slideStart, slideEnd: t.slideEnd },
  }));
}
