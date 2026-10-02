/**
 * Grading a short answer. Exact answers (bit strings, numbers, small expressions)
 * are compared on-device after normalisation; everything else goes to the model
 * with a rubric, never the grader's own opinion.
 */
import { z } from "zod";
import type { AnswerRubric } from "./data";

export type GradeOutcome = "correct" | "partial" | "incorrect";

export interface GradeResult {
  outcome: GradeOutcome;
  /** One sentence for the student. */
  feedback: string;
  satisfied?: string[];
  misconception?: string | null;
}

/** Lowercase, drop spaces/underscores/commas, unify quote-like primes, strip a trailing period. */
export function normaliseExact(s: string) {
  return s
    .trim()
    .toLowerCase()
    .replace(/[\s_,]/g, "")
    .replace(/[’′`]/g, "'")
    .replace(/[−–]/g, "-")
    .replace(/×|·|\*/g, "")
    .replace(/\.$/, "");
}

export function gradeExact(response: string, accepted: string[]): GradeResult {
  const r = normaliseExact(response);
  const ok = accepted.some((a) => normaliseExact(a) === r);
  return ok
    ? { outcome: "correct", feedback: "Right." }
    : { outcome: "incorrect", feedback: `Not quite. Expected ${accepted[0]}.` };
}

export const GradeSchema = z.object({
  outcome: z.enum(["correct", "partial", "incorrect"]),
  satisfied: z.array(z.string()).describe("Which required ideas the response satisfied"),
  misconception: z.string().nullable().describe("The matched known misconception, or null"),
  feedback: z.string().max(240).describe("One sentence for the student: what was right, what was missing"),
});

export const GRADE_SYSTEM = `You grade one short student answer against a rubric for a college course. Never grade against your own general judgment of correctness; only against the rubric's criteria. Be fair to paraphrase and terse answers: a student who states the required idea in their own words is correct. Return JSON only.`;

export function gradePrompt(question: string, rubric: AnswerRubric, response: string) {
  return `Question: ${question}

Required ideas (all of these make a response "correct"; most of them with none wrong is "partial"):
${rubric.requiredIdeas.map((i) => `- ${i}`).join("\n")}

Acceptable alternative phrasings:
${rubric.acceptableAlternatives.map((i) => `- ${i}`).join("\n") || "- (none listed)"}

Known misconceptions (name the matching one if the response shows it):
${rubric.knownMisconceptions.map((m) => `- ${m.description} (phrasing like: ${m.indicativePhrasing.join("; ")})`).join("\n") || "- (none listed)"}

Student response:
"""
${response}
"""

Output: {"outcome": "correct" | "partial" | "incorrect", "satisfied": string[], "misconception": string | null, "feedback": string}`;
}

export function parseGradeLoose(text: string) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("The grader did not return JSON.");
  return GradeSchema.parse(JSON.parse(cleaned.slice(start, end + 1)));
}
