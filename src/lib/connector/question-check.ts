/**
 * The pure part of add_questions (docs/superpowers/specs/2026-11-10-cram-mode-contracts.md, section
 * 4): a question Claude wrote is held to the same checks as one Orca's writer produced, in code,
 * before it is stored (Phase 4 plan, decision 13). The shape is `GeneratedQuestion`'s (the tier and
 * figure slide, which Claude doesn't give, left out); an exact answer stays plain text and is never
 * an expression (`isExpressionAnswer`); every string is sanitised and refused for HTML, a link, a URL
 * the material doesn't have or instruction-like text (`validateFields`); the math shown must render
 * (`mathProblem`); an anchor that names pages must name ones its material has. Refused questions are
 * dropped with a reason, never repaired.
 */
import type { AddQuestion } from "./mcp.ts";
import type { QuizQuestion } from "../data.ts";
import { isExpressionAnswer } from "../grading.ts";
import { locatorPages } from "../course/study.ts";
import { GeneratedQuestion } from "../pipeline/schemas.ts";
import { mathProblem } from "../math-text.ts";
import { validateFields } from "../untrusted/validate.ts";

/** What the checks know about the material an anchor names (`materialFacts` in src/lib/pipeline/run.ts); null when the question names none. */
export interface AnchorFacts {
  pages: ReadonlySet<number>;
  allowedUrls: ReadonlySet<string>;
}

/** A question as it will be stored: everything but its id, topic and the material's id. */
export type CheckedQuestion = Pick<QuizQuestion, "kind" | "prompt" | "options" | "answer" | "exact" | "rubric" | "explanation" | "anchor" | "objectiveId" | "source">;

/** The shape check: GeneratedQuestion without the fields Claude doesn't give. */
const Shape = GeneratedQuestion.omit({ tier: true, figureSlide: true });

const NO_URLS: ReadonlySet<string> = new Set();

export function checkQuestion(q: AddQuestion, facts: AnchorFacts | null): { ok: true; question: CheckedQuestion } | { ok: false; reason: string } {
  const short = q.kind === "Short answer";
  const shaped = Shape.safeParse({
    objectiveId: q.objectiveId,
    kind: q.kind,
    prompt: q.prompt,
    options: q.options ?? [],
    answer: short ? -1 : (q.answer ?? -1),
    exact: q.exact ?? null,
    rubric: q.rubric ?? null,
    explanation: q.explanation,
    anchor: q.anchor ? { locator: q.anchor.locator, excerpt: q.anchor.excerpt } : null,
  });
  if (!shaped.success) {
    const issue = shaped.error.issues[0];
    return { ok: false, reason: `${issue?.path.join(".") || "the question"} ${issue?.message ?? "has the wrong shape"}` };
  }
  const g = shaped.data;
  if (!short && (g.answer < 0 || g.answer >= g.options.length)) return { ok: false, reason: "a choice question needs options and the index of the right one" };
  if (short && !(g.exact && g.exact.length) && !g.rubric) return { ok: false, reason: "a short answer needs exact forms or a rubric" };
  // Exact answers are compared with what the student types, so they stay plain text (src/lib/pipeline/run.ts).
  if (g.exact?.some((e) => /\\[(\[]/.test(e))) return { ok: false, reason: "an exact answer is written as LaTeX" };
  if (short && g.exact?.some(isExpressionAnswer)) return { ok: false, reason: "an algebraic or Boolean expression as an exact answer (give a rubric or make it multiple choice)" };

  const texts = validateFields(
    {
      prompt: g.prompt,
      explanation: g.explanation,
      ...Object.fromEntries(g.options.map((o, i) => [`option ${i + 1}`, o])),
      ...Object.fromEntries((g.exact ?? []).map((e, i) => [`exact answer ${i + 1}`, e])),
      ...Object.fromEntries((g.rubric?.requiredIdeas ?? []).map((e, i) => [`required idea ${i + 1}`, e])),
      ...Object.fromEntries((g.rubric?.acceptableAlternatives ?? []).map((e, i) => [`alternative ${i + 1}`, e])),
      ...Object.fromEntries((g.rubric?.knownMisconceptions ?? []).flatMap((m, i) => [[`misconception ${i + 1}`, m.description], ...m.indicativePhrasing.map((ph, j) => [`misconception ${i + 1} phrasing ${j + 1}`, ph])])),
      ...(g.anchor ? { "anchor excerpt": g.anchor.excerpt } : {}),
    },
    { maxChars: 1200, allowedUrls: facts?.allowedUrls ?? NO_URLS },
  );
  if (!texts.ok) return { ok: false, reason: texts.reason };
  // Math is checked only in what the question shows (not the excerpt, quoted from the material, nor exact answers).
  for (const [name, text] of Object.entries(texts.values)) {
    if (name === "anchor excerpt" || name.startsWith("exact answer")) continue;
    const problem = mathProblem(text);
    if (problem) return { ok: false, reason: `${name} ${problem}` };
  }
  if (g.anchor && facts) {
    const named = locatorPages(g.anchor.locator);
    if (named.length && !named.every((n) => facts.pages.has(n))) return { ok: false, reason: `its anchor names ${g.anchor.locator.slice(0, 60)}, which that material doesn't have` };
  }
  const v = texts.values;
  return {
    ok: true,
    question: {
      objectiveId: g.objectiveId,
      kind: g.kind,
      prompt: v.prompt,
      options: short ? [] : g.options.map((_, i) => v[`option ${i + 1}`]),
      answer: short ? -1 : g.answer,
      ...(short && g.exact && g.exact.length ? { exact: g.exact.map((_, i) => v[`exact answer ${i + 1}`]) } : {}),
      ...(short && !(g.exact && g.exact.length) && g.rubric
        ? {
            rubric: {
              requiredIdeas: g.rubric.requiredIdeas.map((_, i) => v[`required idea ${i + 1}`]),
              acceptableAlternatives: g.rubric.acceptableAlternatives.map((_, i) => v[`alternative ${i + 1}`]),
              knownMisconceptions: g.rubric.knownMisconceptions.map((m, i) => ({ description: v[`misconception ${i + 1}`], indicativePhrasing: m.indicativePhrasing.map((_, j) => v[`misconception ${i + 1} phrasing ${j + 1}`]) })),
            },
          }
        : {}),
      explanation: v.explanation,
      ...(g.anchor ? { anchor: { locator: g.anchor.locator, excerpt: v["anchor excerpt"] } } : {}),
      source: "claude",
    },
  };
}
