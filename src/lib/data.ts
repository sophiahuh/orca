/**
 * Orca data model + seed data for the v1 prototype.
 *
 * Everything here is client-side mock data persisted to localStorage by
 * `store.tsx`. When a backend lands (Supabase), these types become the
 * table shapes and the seed becomes a migration.
 */

import { ALD_TOPICS } from "./content/ald";

/** Path canvas layout: first node y and vertical gap between nodes (854-wide canvas). */
export const PATH_NODE_GAP = 120;
export const PATH_TOP = 240;

export type IslandVariant = "ald" | "circuit" | "signals" | "linear" | "stats";

export type TopicStatus = "done" | "current" | "locked";

export interface Topic {
  id: string;
  name: string;
  status: TopicStatus;
  lessons: number;
  lessonsDone: number;
  /** Node centre in the 854-wide path canvas. */
  pos: { x: number; y: number };
  /** One-paragraph summary (from extracted course material). */
  summary?: string;
  /** Where this topic came from. */
  source?: { filename: string; slideStart: number; slideEnd: number };
}

export interface Course {
  id: string;
  slug: string;
  name: string;
  /** Short label shown on the island pill and due cards, e.g. "ALD". */
  short: string;
  variant: IslandVariant;
  /** Top-left of the 280×230 island frame in the 854×834 map canvas. */
  pos: { x: number; y: number };
  topics: Topic[];
  /** Optional hand-tuned trail path. Generated from topic positions if absent. */
  trail?: string;
}

export type DueWhen = "today" | "tomorrow";

export interface DueItem {
  id: string;
  courseId: string;
  title: string;
  when: DueWhen;
  topicId?: string;
}

export type Cadence = "Daily" | "Weekly" | "1 wk before exam";
export type Duration = "5 min" | "15 min" | "30 min" | "1 hour" | "3 hours" | "10 hours";

export interface ReviewRow {
  duration: Duration;
  cadence: Cadence;
}

export interface ReviewConfig {
  quick: ReviewRow;
  deep: ReviewRow;
  exam: ReviewRow;
}

export type WeightKey = "homework" | "practiceExams" | "practiceProblems" | "lectures";
/** Built-in keys plus any custom material types the student adds. */
export type Weights = Record<string, number>;

export const WEIGHT_LABELS: Record<WeightKey, string> = {
  homework: "Homework",
  practiceExams: "Practice exams",
  practiceProblems: "Practice problems",
  lectures: "Lectures",
};

export function weightLabel(key: string) {
  return (WEIGHT_LABELS as Record<string, string>)[key] ?? key;
}

/** Normalise raw slider values to percentages that sum to ~100. */
export function weightPercents(w: Weights): Record<string, number> {
  const sum = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  return Object.fromEntries(Object.entries(w).map(([k, v]) => [k, Math.round((v / sum) * 100)]));
}

export type EventKind = "hw" | "lab" | "rev" | "exam";

export interface CalendarEvent {
  id: string;
  /** ISO date, YYYY-MM-DD */
  date: string;
  kind: EventKind;
  title: string;
  courseId?: string;
}

export type MaterialType =
  | "Past exam"
  | "Practice problems"
  | "Practice exam"
  | "Homework"
  | "Lecture"
  | "Other";

export interface Material {
  id: string;
  courseId: string;
  filename: string;
  type: MaterialType;
  assigned: string | null;
  due: string | null;
  reflect: boolean;
}

/* ── Quiz ─────────────────────────────────────────────────────────────── */
export interface TruthRow {
  cells: string[];
}

/** Bloom-ish tiers from the assessment blueprint: what the question asks the student to do. */
export type QuestionTier = "retrieval" | "mechanism" | "application" | "connection" | "transfer";

/** Rubric for grading a short free-text answer (never the grader's own judgement). */
export interface AnswerRubric {
  requiredIdeas: string[];
  acceptableAlternatives: string[];
  knownMisconceptions: Array<{ description: string; indicativePhrasing: string[] }>;
}

export interface QuizQuestion {
  id: string;
  kind: "Multiple choice" | "True or false" | "Short answer";
  tier?: QuestionTier;
  topic: string;
  prompt: string;
  /** Optional inline truth table shown under the prompt. */
  table?: { headers: string[]; rows: TruthRow[] };
  /** Choices for MC/TF; empty for short answer. */
  options: string[];
  /** Index into options; -1 for short answer. */
  answer: number;
  /** Short answer: accepted exact answers (normalised before comparing). Checked on-device, no model. */
  exact?: string[];
  /** Short answer without an exact form: graded by a model against this rubric. */
  rubric?: AnswerRubric;
  explanation: string;
  /** Where in the course material this question is grounded. */
  anchor?: { locator: string; excerpt: string };
  /** A figure the student needs to see (cropped slide or redrawn diagram). */
  figure?: { src: string; alt: string };
  /** The objective this question tests. Missing on generated questions until extraction assigns one. */
  objectiveId?: string;
}

/* ── Seed ─────────────────────────────────────────────────────────────── */

export const DEFAULT_CONFIG: ReviewConfig = {
  quick: { duration: "5 min", cadence: "Daily" },
  deep: { duration: "3 hours", cadence: "Weekly" },
  exam: { duration: "10 hours", cadence: "1 wk before exam" },
};

export const DEFAULT_WEIGHTS: Weights = {
  homework: 30,
  practiceExams: 35,
  practiceProblems: 25,
  lectures: 10,
};

/** ALD's trail comes from the authored lecture content; the first two topics start complete. */
const ALD_POSITIONS = defaultTopicPositions(ALD_TOPICS.length);
const ALD_SEED_TOPICS: Topic[] = ALD_TOPICS.map((t, i) => ({
  id: t.id,
  name: t.name,
  status: i < 1 ? "done" : i === 1 ? "current" : "locked",
  lessons: 1,
  lessonsDone: i < 1 ? 1 : 0,
  pos: ALD_POSITIONS[i],
  summary: t.summary,
  source: t.source,
}));

export const SEED_COURSES: Course[] = [
  {
    id: "ald",
    slug: "ald",
    name: "Advanced Logic Design",
    short: "ALD",
    variant: "ald",
    pos: { x: 70, y: 110 },
    topics: ALD_SEED_TOPICS,
  },
  {
    id: "circuit",
    slug: "circuit-analysis",
    name: "Circuit Analysis",
    short: "Circuit Analysis",
    variant: "circuit",
    pos: { x: 500, y: 80 },
    topics: [
      { id: "ohm", name: "Ohm's Law", status: "done", lessons: 3, lessonsDone: 3, pos: { x: 330, y: 240 } },
      { id: "kcl-kvl", name: "KCL & KVL", status: "current", lessons: 5, lessonsDone: 1, pos: { x: 450, y: 350 } },
      { id: "thevenin", name: "Thévenin", status: "locked", lessons: 4, lessonsDone: 0, pos: { x: 330, y: 480 } },
      { id: "rc", name: "RC Circuits", status: "locked", lessons: 4, lessonsDone: 0, pos: { x: 210, y: 610 } },
      { id: "ac", name: "AC Analysis", status: "locked", lessons: 5, lessonsDone: 0, pos: { x: 330, y: 725 } },
    ],
  },
  {
    id: "signals",
    slug: "signals",
    name: "Signals & Systems",
    short: "Signals",
    variant: "signals",
    pos: { x: 290, y: 330 },
    topics: [
      { id: "lti", name: "LTI Systems", status: "current", lessons: 4, lessonsDone: 0, pos: { x: 330, y: 240 } },
      { id: "convolution", name: "Convolution", status: "locked", lessons: 5, lessonsDone: 0, pos: { x: 450, y: 350 } },
      { id: "fourier", name: "Fourier", status: "locked", lessons: 6, lessonsDone: 0, pos: { x: 330, y: 480 } },
      { id: "laplace", name: "Laplace", status: "locked", lessons: 4, lessonsDone: 0, pos: { x: 210, y: 610 } },
    ],
  },
  {
    id: "linear",
    slug: "linear-algebra",
    name: "Linear Algebra",
    short: "Linear Algebra",
    variant: "linear",
    pos: { x: 40, y: 470 },
    topics: [
      { id: "vectors", name: "Vectors", status: "current", lessons: 3, lessonsDone: 0, pos: { x: 330, y: 240 } },
      { id: "matrices", name: "Matrices", status: "locked", lessons: 5, lessonsDone: 0, pos: { x: 450, y: 350 } },
      { id: "eigen", name: "Eigenvalues", status: "locked", lessons: 4, lessonsDone: 0, pos: { x: 330, y: 480 } },
    ],
  },
  {
    id: "stats",
    slug: "statistics",
    name: "Statistics",
    short: "Statistics",
    variant: "stats",
    pos: { x: 540, y: 450 },
    topics: [
      { id: "prob", name: "Probability", status: "current", lessons: 4, lessonsDone: 0, pos: { x: 330, y: 240 } },
      { id: "dist", name: "Distributions", status: "locked", lessons: 5, lessonsDone: 0, pos: { x: 450, y: 350 } },
      { id: "inference", name: "Inference", status: "locked", lessons: 5, lessonsDone: 0, pos: { x: 330, y: 480 } },
    ],
  },
];

export const SEED_DUE: DueItem[] = [
  { id: "d1", courseId: "circuit", title: "Quick review", when: "today", topicId: "kcl-kvl" },
  { id: "d2", courseId: "ald", title: "Boolean Algebra", when: "today", topicId: "boolean-algebra" },
  { id: "d3", courseId: "ald", title: "Review Logic Circuits", when: "tomorrow", topicId: "logic-circuits-switches" },
  { id: "d4", courseId: "ald", title: "Exam 1 prep", when: "tomorrow", topicId: "karnaugh-maps" },
];

export const SEED_EVENTS: CalendarEvent[] = [
  { id: "e1", date: "2026-09-03", kind: "hw", title: "Circuits HW", courseId: "circuit" },
  { id: "e2", date: "2026-09-08", kind: "lab", title: "ALD Lab 2", courseId: "ald" },
  { id: "e3", date: "2026-09-10", kind: "hw", title: "ALD HW 3", courseId: "ald" },
  { id: "e4", date: "2026-09-15", kind: "rev", title: "Review Intro", courseId: "ald" },
  { id: "e5", date: "2026-09-17", kind: "exam", title: "ALD midterm", courseId: "ald" },
  { id: "e6", date: "2026-09-22", kind: "hw", title: "Circuits HW 4", courseId: "circuit" },
  { id: "e7", date: "2026-09-24", kind: "rev", title: "K-Maps quiz", courseId: "ald" },
  { id: "e8", date: "2026-09-30", kind: "rev", title: "Quick review", courseId: "circuit" },
  { id: "e9", date: "2026-10-01", kind: "rev", title: "Exam 1 prep", courseId: "ald" },
  { id: "e10", date: "2026-10-06", kind: "hw", title: "Circuits HW 5", courseId: "circuit" },
  { id: "e11", date: "2026-10-08", kind: "lab", title: "ALD Lab 3", courseId: "ald" },
  { id: "e12", date: "2026-10-13", kind: "rev", title: "Verilog review", courseId: "ald" },
  { id: "e13", date: "2026-10-20", kind: "exam", title: "Circuits midterm", courseId: "circuit" },
  { id: "e14", date: "2026-10-27", kind: "rev", title: "Fourier review", courseId: "signals" },
];

export const MATERIAL_TYPES: readonly MaterialType[] = ["Past exam", "Practice problems", "Practice exam", "Homework", "Lecture", "Other"];

/* ── Dates ────────────────────────────────────────────────────────────── */
export function toISODate(d: Date) {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatUSDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

export const SEED_MATERIALS: Material[] = [
  {
    id: "m1",
    courseId: "ald",
    filename: "ALD_HW3.pdf",
    type: "Homework",
    assigned: "2026-09-24",
    due: "2026-10-01",
    reflect: true,
  },
];

/* ── Helpers ──────────────────────────────────────────────────────────── */

export function courseProgress(course: Course) {
  const done = course.topics.filter((t) => t.status === "done").length;
  return { done, total: course.topics.length, pct: course.topics.length ? done / course.topics.length : 0 };
}

export function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function shortName(name: string) {
  const words = name.trim().split(/\s+/);
  if (words.length >= 3) return words.map((w) => w[0]?.toUpperCase() ?? "").join("");
  return name;
}

/** Smooth cubic trail through topic centres (used when a course has no hand-tuned trail). */
export function trailFromPoints(points: { x: number; y: number }[]) {
  if (points.length < 2) return "";
  let d = `M${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const p0 = points[i - 1];
    const p1 = points[i];
    const dy = p1.y - p0.y;
    d += ` C${p0.x} ${p0.y + dy * 0.55} ${p1.x} ${p1.y - dy * 0.55} ${p1.x} ${p1.y}`;
  }
  return d;
}

/** Canvas height needed to show n topics (never shorter than the 834 design frame). */
export function pathCanvasHeight(n: number) {
  return Math.max(834, PATH_TOP + Math.max(0, n - 1) * PATH_NODE_GAP + 110);
}

/** Default node layout for a new course: a lazy S-curve down the canvas. */
export function defaultTopicPositions(n: number) {
  const xs = [330, 450, 330, 210, 330, 450, 330];
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) out.push({ x: xs[i % xs.length], y: PATH_TOP + i * PATH_NODE_GAP });
  return out;
}

export function formatSeconds(total: number) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
