/**
 * Shapes of every pipeline step's model output (validated with zod on the way in) and of each
 * step's input (validated by the route before a prompt is built). Shared by the server routes and
 * the browser path for browser-only providers.
 */
import { z } from "zod";

/** Every string the model returns has a length limit (decision 13); longer ones fail the schema. */
const SHORT = 240;
const TEXT = 1200;

const Anchor = z.object({
  locator: z.string().max(60).describe("e.g. 'slide 14'"),
  excerpt: z.string().max(SHORT).describe("Short quote or close paraphrase from that place"),
});

/* ── Extract: structure and signals, no questions ──────────────────────── */

export const ExtractOutput = z.object({
  topics: z
    .array(
      z.object({
        localId: z.string().max(60).describe("Your own short id for a new topic, e.g. 't1'. For an existing topic, repeat its id."),
        existingId: z.string().max(60).nullable().describe("The id of the existing topic this is, or null for a new one"),
        name: z.string().min(1).max(60),
        aliases: z.array(z.string().max(60)).max(6).describe("Other names the material uses for it"),
        summary: z.string().max(400),
        slideStart: z.number().int().min(1),
        slideEnd: z.number().int().min(1),
      }),
    )
    .max(8),
  objectives: z
    .array(
      z.object({
        localId: z.string().max(60).describe("Your own short id for a new objective, e.g. 'o1'. For an existing objective, repeat its id."),
        existingId: z.string().max(60).nullable().describe("The id of the existing objective this material covers, or null for a new one"),
        topicRef: z.string().max(60).describe("localId of a topic above, or the id of an existing topic"),
        name: z.string().min(1).max(120).describe("'Can …' statement of one skill, e.g. 'Convert between decimal and n-bit 2's complement'"),
        description: z.string().max(400),
        aliases: z.array(z.string().max(120)).max(6),
        origin: z.enum(["material", "inferred"]).describe("'inferred' only when it comes from general knowledge of the subject, not this material"),
        places: z.array(Anchor).max(12).describe("Every place that genuinely teaches or uses it; empty for inferred"),
        emphasis: z
          .object({ kind: z.enum(["tested", "skipped"]), quote: z.string().max(240) })
          .nullable()
          .describe("Only when the material explicitly says it will or won't be examined, quoted; else null"),
      }),
    )
    .max(40),
  relations: z
    .array(
      z.object({
        from: z.string().max(60).describe("Topic localId or existing topic id"),
        to: z.string().max(60).describe("Topic localId or existing topic id"),
        type: z.enum(["used-in", "has-a-kind", "alternative-to", "related"]),
        anchor: Anchor.nullable(),
        reason: z.string().max(300).describe("One specific sentence on why this link is there: what B needs from A, which limitation one works around, or what the contrast teaches"),
      }),
    )
    .max(60),
  instructionsFound: z
    .array(z.string().max(SHORT))
    .max(20)
    .describe("Quoted spans of the material that address an AI or try to steer it (instructions, requests for an outcome, role tags); empty when there are none"),
});
export type ExtractOutput = z.infer<typeof ExtractOutput>;

/* ── Reconcile: is this candidate one of the existing items? ──────────── */

export const ReconcileOutput = z.object({
  decision: z.enum(["same", "new", "uncertain"]),
  matchId: z.string().nullable().describe("The existing item's id when decision is 'same' (or the closest one when 'uncertain'); else null"),
  reasoning: z.string().max(600),
});
export type ReconcileOutput = z.infer<typeof ReconcileOutput>;

/* ── Generate: questions for objectives ────────────────────────────────── */

const Rubric = z.object({
  requiredIdeas: z.array(z.string().max(SHORT)).min(1).max(8),
  acceptableAlternatives: z.array(z.string().max(SHORT)).max(12),
  knownMisconceptions: z.array(z.object({ description: z.string().max(SHORT), indicativePhrasing: z.array(z.string().max(SHORT)).max(8) })).max(8),
});

export const GeneratedQuestion = z.object({
  objectiveId: z.string().max(60).describe("Exactly one of the objective ids given"),
  kind: z.enum(["Multiple choice", "True or false", "Short answer"]),
  tier: z.enum(["retrieval", "mechanism", "application", "connection", "transfer"]),
  prompt: z.string().min(1).max(TEXT),
  options: z.array(z.string().min(1).max(SHORT)).max(4).describe("4 choices for MC, ['True','False'] for TF, empty for short answer"),
  answer: z.number().int().min(-1).describe("Index into options; -1 for short answer"),
  exact: z.array(z.string().max(120)).max(12).nullable().describe("Short answer with one exact form: every accepted spelling. Else null"),
  rubric: Rubric.nullable().describe("Short answer graded in prose: the rubric. Else null"),
  explanation: z.string().min(1).max(TEXT),
  anchor: Anchor.nullable().describe("Where in the material it comes from; null only for an inferred objective"),
  figureSlide: z.number().int().min(1).nullable().describe("Slide whose diagram or table the student must see; else null"),
});
export type GeneratedQuestion = z.infer<typeof GeneratedQuestion>;

export const GenerateOutput = z.object({ questions: z.array(GeneratedQuestion).max(60) });
export type GenerateOutput = z.infer<typeof GenerateOutput>;

/* ── Deep: harder questions written when a deep review starts ───────── */

/** Dive questions are multi-step problems with worked solutions: longer than quiz questions. */
export const DEEP_TEXT = 4000;

/** A deep-review question: a short answer that takes a few minutes (no recall tier, no choices). */
export const DeepQuestion = GeneratedQuestion.extend({
  explanation: z.string().min(1).max(DEEP_TEXT),
  kind: z.literal("Short answer"),
  tier: z.enum(["mechanism", "application", "connection", "transfer"]),
  options: z.array(z.string()).max(0).describe("Always empty"),
  answer: z.literal(-1),
  prompt: z.string().min(1).max(DEEP_TEXT).describe("Readable plain text: short paragraphs, line-separated givens, and numbered line-separated steps when appropriate; use \\n for line breaks, never Markdown or HTML"),
});
export const DeepOutput = z.object({ questions: z.array(DeepQuestion).max(40) });
export type DeepOutput = z.infer<typeof DeepOutput>;

/* ── Step inputs (checked by the route) ────────────────────────────────── */

const Page = z.object({ n: z.number().int().min(1), text: z.string().max(6000) });
const Named = z.object({ id: z.string(), name: z.string(), aliases: z.array(z.string()), description: z.string().optional(), rejected: z.boolean() });
// The short label is display text (often the whole name for courses made before initials), not a ref.
const Course = z.object({ name: z.string().max(120), short: z.string().max(120) });
const MaterialType = z.enum(["Lecture", "Syllabus", "Homework", "Past exam", "Practice exam", "Practice problems", "Other"]);

export const ExtractInput = z.object({
  course: Course,
  material: z.object({ filename: z.string().max(200), type: MaterialType }),
  pages: z.array(Page).min(1).max(400),
  existingTopics: z.array(Named.extend({ id: z.string() })).max(200),
  existingObjectives: z.array(Named.extend({ topicId: z.string() })).max(1000),
});
export type ExtractInput = z.infer<typeof ExtractInput>;

export const ReconcileInput = z.object({
  kind: z.enum(["topic", "objective"]),
  candidate: z.object({ name: z.string(), aliases: z.array(z.string()), description: z.string() }),
  existing: z.array(Named).min(1).max(12),
});
export type ReconcileInput = z.infer<typeof ReconcileInput>;

export const GenerateInput = z.object({
  course: Course,
  material: z.object({ filename: z.string().max(200), type: MaterialType }),
  pages: z.array(Page).min(1).max(400),
  topic: z.object({ name: z.string(), summary: z.string() }),
  objectives: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        description: z.string(),
        origin: z.enum(["material", "inferred", "authored"]),
        need: z.number().int().min(1).max(8),
        existingPrompts: z.array(z.string()).max(40),
      }),
    )
    .min(1)
    .max(12),
});
export type GenerateInput = z.infer<typeof GenerateInput>;

/* ── Link: how a course's topics relate (a focused pass after each upload, or on demand) ── */

export const LinkInput = z.object({
  course: Course,
  /** Each topic by a short ref ("t1"…), with its summary; `isNew` marks this upload's topics. */
  topics: z.array(z.object({ ref: z.string(), name: z.string(), summary: z.string(), isNew: z.boolean() })).min(2).max(200),
  /** Links the course already has, by ref (not to be repeated, except those that need a reason). */
  existing: z.array(z.object({ from: z.string(), to: z.string(), type: z.string(), needsReason: z.boolean().optional() })).max(1000),
});
export type LinkInput = z.infer<typeof LinkInput>;

export const LinkOutput = z.object({
  links: z
    .array(
      z.object({
        from: z.string().max(20).describe("A topic ref"),
        to: z.string().max(20).describe("A topic ref"),
        type: z.enum(["used-in", "has-a-kind", "alternative-to", "related"]),
        reason: z.string().max(300).describe("One specific sentence on why this link is there: what B needs from A, which limitation one works around, or what the contrast teaches"),
      }),
    )
    .max(120),
});
export type LinkOutput = z.infer<typeof LinkOutput>;

/* ── Reflect: which objectives a homework reflection says the student doesn't understand ── */

export const ReflectInput = z.object({
  course: Course,
  material: z.object({ filename: z.string().max(200), type: MaterialType }),
  note: z.string().min(1).max(2000),
  objectives: z.array(z.object({ id: z.string(), name: z.string(), description: z.string(), topic: z.string() })).min(1).max(400),
});
export type ReflectInput = z.infer<typeof ReflectInput>;

export const ReflectOutput = z.object({
  matches: z
    .array(
      z.object({
        objectiveId: z.string().max(60),
        sure: z.boolean().describe("true when the note plainly names this skill; false when you are inferring it"),
        reasoning: z.string().max(300).describe("One sentence, quoting the note"),
      }),
    )
    .max(10),
});
export type ReflectOutput = z.infer<typeof ReflectOutput>;

/* ── Transcribe: handwritten or scanned pages, read from their images ── */

/** At most this many pages go in one transcribe call (each a page image). */
export const TRANSCRIBE_PAGES_PER_CALL = 4;

export const TranscribeInput = z.object({
  course: Course,
  material: z.object({ filename: z.string().max(200) }),
  /** Each page's number and its rendered image (base64 JPEG, no data: prefix; about 5 MB at most). */
  pages: z
    .array(z.object({ n: z.number().int().min(1), image: z.string().min(1).max(7_000_000) }))
    .min(1)
    .max(TRANSCRIBE_PAGES_PER_CALL),
});
export type TranscribeInput = z.infer<typeof TranscribeInput>;

export const TranscribeOutput = z.object({
  pages: z
    .array(
      z.object({
        n: z.number().int().min(1).describe("The page's number, as given"),
        text: z.string().max(6000).describe("Everything on the page written out as text; empty when the page is blank"),
      }),
    )
    .max(TRANSCRIBE_PAGES_PER_CALL),
});
export type TranscribeOutput = z.infer<typeof TranscribeOutput>;

/* ── Describe: the figures on typed slides, from their images (the slide's text stays as it is) ── */

export const DescribeInput = z.object({
  course: Course,
  material: z.object({ filename: z.string().max(200) }),
  /** Each slide's number, its text (to say what's already there) and its rendered image. */
  pages: z
    .array(z.object({ n: z.number().int().min(1), text: z.string().max(6000), image: z.string().min(1).max(7_000_000) }))
    .min(1)
    .max(TRANSCRIBE_PAGES_PER_CALL),
});
export type DescribeInput = z.infer<typeof DescribeInput>;

export const DescribeOutput = z.object({
  pages: z
    .array(
      z.object({
        n: z.number().int().min(1).describe("The slide's number, as given"),
        figures: z.string().max(2000).describe("What the slide's figures show that its text doesn't say; empty when it has only decoration"),
      }),
    )
    .max(TRANSCRIBE_PAGES_PER_CALL),
});
export type DescribeOutput = z.infer<typeof DescribeOutput>;

/** Every step: its input and output schemas. */
export const STEPS = {
  extract: { input: ExtractInput, output: ExtractOutput },
  reconcile: { input: ReconcileInput, output: ReconcileOutput },
  generate: { input: GenerateInput, output: GenerateOutput },
  deep: { input: GenerateInput, output: DeepOutput },
  link: { input: LinkInput, output: LinkOutput },
  reflect: { input: ReflectInput, output: ReflectOutput },
  transcribe: { input: TranscribeInput, output: TranscribeOutput },
  describe: { input: DescribeInput, output: DescribeOutput },
} as const;
export type StepName = keyof typeof STEPS;
export type StepInput<S extends StepName> = z.infer<(typeof STEPS)[S]["input"]>;
export type StepOutput<S extends StepName> = z.infer<(typeof STEPS)[S]["output"]>;
