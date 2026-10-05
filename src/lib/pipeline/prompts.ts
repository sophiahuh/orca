/**
 * Prompt builders for every pipeline step. Each returns { system, context, prompt }: `context` is
 * the long, repeated part (the material's text) and goes first so a provider with prompt caching
 * reuses it across the calls of one upload.
 */
import type { AgreementInput, AmbiguityInput, ExtractInput, GenerateInput, ReconcileInput, SolveInput, StepInput, StepName } from "./schemas.ts";

export interface BuiltPrompt {
  system: string;
  /** Long, stable text placed before `prompt` (cacheable); null when the step has none. */
  context: string | null;
  prompt: string;
}

/** Question-quality rules (mirrors docs/QUIZ-RUBRIC.md). */
export const QUIZ_RUBRIC = `Rules for every question:
- Every question works on a concrete instance: a given bit pattern, expression, circuit, array, code snippet or scenario. "Retrieval" means running a procedure on that instance (convert this, simplify this, trace this), never reciting a definition. "Mechanism" means explaining why or how in one sentence.
- Assume the course's level, not the topic's. If the course is upper-level, early lectures are refreshers: a question answerable from a definition alone is too easy. Target apply/analyse. At most one pure-recall question per objective, and only for a fact students actually forget.
- Never test notation or vocabulary before the place that defines it; a question may only assume terms from its own slide range or earlier.
- If the question needs a diagram or table, set figureSlide and say "In the figure, …". Never describe a picture the student can't see.
- Distractors must be wrong for a reason a student might believe (the dual operation, an off-by-one, the unsigned reading of a signed pattern). No joke options.
- Every claim traces to the material (the anchor). Don't paraphrase the material's sentence as the prompt; apply the idea so understanding, not reading, is what's tested.
- Multiple choice: exactly four options, exactly one defensible answer. True/false: only for statements with a tempting wrong reading, at most one per objective.
- Answerable in under a minute without paper. The explanation teaches: why the right answer is right and why the most tempting distractor is wrong, in one or two sentences.`;

const MAX_CONTEXT_CHARS = 180_000;

/** The material as numbered slides, trimmed to fit. Identical bytes for every call of one upload. */
export function materialContext(input: Pick<ExtractInput, "course" | "material" | "pages">): string {
  let total = 0;
  const slides = input.pages
    .map((p) => `[slide ${p.n}]\n${p.text.trim()}`)
    .filter((s) => s.length > 12)
    .filter((s) => (total += s.length) <= MAX_CONTEXT_CHARS);
  return `Course: ${input.course.name} (${input.course.short}).
Material: "${input.material.filename}" (${input.material.type}), ${input.pages.length} slides or pages.

${slides.join("\n\n")}`;
}

const list = (items: Array<{ id: string; name: string; aliases: string[]; rejected: boolean; description?: string; topicId?: string }>) =>
  items.length
    ? items
        .map((i) => `- ${i.id}${i.topicId ? ` (topic ${i.topicId})` : ""}: ${i.name}${i.aliases.length ? ` [also: ${i.aliases.join("; ")}]` : ""}${i.rejected ? " — REJECTED by the student: never propose it again" : ""}${i.description ? `\n  ${i.description}` : ""}`)
        .join("\n")
    : "(none yet)";

const TYPE_RULES: Record<ExtractInput["material"]["type"], string> = {
  Lecture: "This is a lecture: it introduces topics and objectives. Create topics for what it teaches and objectives for each skill.",
  Syllabus: "This is a syllabus: create the course's topics and objectives from its schedule and learning outcomes. Places are the syllabus lines that name them. Skip logistics (grading, office hours, policies).",
  Homework: "This is homework: it practises what lectures taught. Attach coverage to existing objectives (existingId, with each problem that requires the skill as a place). Create a new objective or topic only when a problem clearly needs a skill nothing existing covers.",
  "Past exam": "This is an exam: attach coverage to existing objectives (each question that requires the skill is a place). Create a new objective only when a question clearly needs a skill nothing existing covers.",
  "Practice exam": "This is a practice exam: attach coverage to existing objectives (each question that requires the skill is a place). Create a new objective only when a question clearly needs a skill nothing existing covers.",
  "Practice problems": "These are practice problems: attach coverage to existing objectives (each problem that requires the skill is a place). Create a new objective only when a problem clearly needs a skill nothing existing covers.",
  Other: "Map what this material teaches onto the course: reuse existing topics and objectives where they fit, create new ones where they don't.",
};

export function extractPrompt(input: ExtractInput): BuiltPrompt {
  return {
    system: `You map one piece of college course material onto a course's structure for a spaced-repetition study app.
Infer the subject from the material itself. Work only from what is present: return empty arrays rather than invent. Return JSON only, matching the schema.

Definitions:
- A topic is something a student would review as a unit (2 to 6 per lecture). Skip logistics.
- An objective is one "can do X" skill a question can test, e.g. "Convert between decimal and n-bit 2's complement". One skill per objective; 2 to 6 per topic.
- A place is somewhere the material genuinely teaches or uses the objective (a slide or section on it, a worked example, a problem that requires it), cited by locator and a short excerpt. A passing mention is not a place.
- origin "inferred" is for a skill the material clearly relies on but never teaches (general knowledge of the subject). It has no places. Use it sparingly.
- emphasis only when the material explicitly says something will or won't be examined ("this will be on the exam", "you won't be tested on this"), quoting it.
- builds-on: "B builds on A" only when the material shows A being used to do B. from = B, to = A.

Reuse before you create: when the material covers an existing topic or objective, return it with its existingId (and its id as localId) and this material's places. Never propose anything marked REJECTED.`,
    context: materialContext(input),
    prompt: `${TYPE_RULES[input.material.type]}

Existing topics:
${list(input.existingTopics)}

Existing objectives:
${list(input.existingObjectives)}

Map the material above onto this course.`,
  };
}

export function reconcilePrompt(input: ReconcileInput): BuiltPrompt {
  return {
    system: "You decide whether a newly extracted course item duplicates an existing one. Return JSON only, matching the schema.",
    context: null,
    prompt: `You are reconciling one newly extracted course ${input.kind} against the course's existing ${input.kind}s.
Decide exactly one of: "same" (the same underlying ${input.kind === "topic" ? "topic" : "skill"} as one existing item, possibly under a different name; set matchId to its id), "new" (genuinely different), or "uncertain" (you are not confident either way; set matchId to the closest one). Never guess "same" or "new" when you're not sure. Items marked rejected count too: if the candidate is the same as a rejected item, answer "same" with its id.

Candidate: ${JSON.stringify(input.candidate)}

Existing: ${JSON.stringify(input.existing)}`,
  };
}

export function generatePrompt(input: GenerateInput): BuiltPrompt {
  const objectives = input.objectives
    .map(
      (o) =>
        `- ${o.id}: ${o.name}${o.description ? ` — ${o.description}` : ""}\n  write ${o.need} question${o.need === 1 ? "" : "s"}${o.origin === "inferred" ? "; INFERRED (not taught in this material): anchor must be null and the prompt must not claim to come from the course" : "; anchor each one to the material"}${
          o.existingPrompts.length ? `\n  already asked (don't repeat or rephrase): ${o.existingPrompts.map((p) => JSON.stringify(p)).join("; ")}` : ""
        }`,
    )
    .join("\n");
  return {
    system: `You write quick-review quiz questions for a spaced-repetition study app, from one piece of college course material. Work only from the material: do not invent facts. Return JSON only, matching the schema.

${QUIZ_RUBRIC}`,
    context: materialContext(input),
    prompt: `Topic: ${input.topic.name}. ${input.topic.summary}

Write questions for these objectives (tag each question with its objective id):
${objectives}

Mix per objective: at least one "Short answer" retrieval question on a concrete instance with an exact answer (set exact to every accepted spelling, rubric null) where the skill has one exact form; a "mechanism" short answer answerable in one sentence (set rubric with 1–3 requiredIdeas, exact null) when the objective has a why or how; the rest "Multiple choice" with four options where choosing between plausible alternatives is itself the skill; at most one "True or false". Keep every question under a minute.`,
  };
}

const questionBlock = (q: SolveInput["questions"][number]) =>
  `[${q.id}] (${q.kind}) ${q.prompt}${q.options.length ? `\nOptions: ${q.options.map((o, i) => `${i}: ${o}`).join(" | ")}` : ""}${q.context ? `\nThe slide the question refers to says:\n${q.context}` : ""}`;

export function solvePrompt(input: SolveInput): BuiltPrompt {
  return {
    system: "You answer quiz questions yourself, independently. Return JSON only, matching the schema.",
    context: null,
    prompt: `Solve each question on your own. For a choice question give the option index in "choice" (text null); for a short-answer question give your answer in "text" (choice null), as briefly as the question allows. Don't ask for clarification; answer every id.

${input.questions.map(questionBlock).join("\n\n")}`,
  };
}

export function ambiguityPrompt(input: AmbiguityInput): BuiltPrompt {
  return {
    system: "You review quiz questions for ambiguity. Return JSON only, matching the schema.",
    context: null,
    prompt: `For each question: is there more than one option a reasonable student could defensibly pick as correct, or is the marked option actually wrong? Answer honestly; don't assume the marked option is right because it's marked. ambiguous = true for either problem.

${input.questions.map((q) => `${questionBlock(q)}\nMarked correct: ${q.marked}`).join("\n\n")}`,
  };
}

export function agreementPrompt(input: AgreementInput): BuiltPrompt {
  return {
    system: "You check whether an independently written answer agrees with a question's rubric. Return JSON only, matching the schema.",
    context: null,
    prompt: `For each item: does the independent answer agree with what the rubric requires? Judge substantive agreement, not wording.

${input.items.map((i) => `[${i.id}] ${i.prompt}\nRubric: ${JSON.stringify(i.rubric)}\nIndependent answer: ${i.independentAnswer}`).join("\n\n")}`,
  };
}

export function buildPrompt<S extends StepName>(step: S, input: StepInput<S>): BuiltPrompt {
  switch (step) {
    case "extract":
      return extractPrompt(input as ExtractInput);
    case "reconcile":
      return reconcilePrompt(input as ReconcileInput);
    case "generate":
      return generatePrompt(input as GenerateInput);
    case "solve":
      return solvePrompt(input as SolveInput);
    case "ambiguity":
      return ambiguityPrompt(input as AmbiguityInput);
    case "agreement":
      return agreementPrompt(input as AgreementInput);
    default:
      throw new Error(`Unknown pipeline step "${String(step)}"`);
  }
}
