/**
 * Orca data model + seed data for the v1 prototype.
 *
 * Everything here is client-side mock data persisted to localStorage by
 * `store.tsx`. When a backend lands (Supabase), these types become the
 * table shapes and the seed becomes a migration.
 */


/** Path canvas layout: first node y and vertical gap between nodes (854-wide canvas). */
export const PATH_NODE_GAP = 120;
export const PATH_TOP = 240;

export type IslandVariant = "ald" | "circuit" | "signals" | "linear" | "stats";

export interface Topic {
  id: string;
  name: string;
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

/** A topic with reviews due, derived from objective due times (never stored). */
export interface DueItem {
  id: string;
  courseId: string;
  topicId: string;
  title: string;
  when: DueWhen;
  /** How many of the topic's objectives are due. */
  count: number;
}

export type Cadence = "Daily" | "Weekly" | "1 wk before exam";
export type Duration = "5 min" | "10 min" | "15 min" | "30 min" | "1 hour" | "3 hours" | "10 hours";

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
  /** The upload this question was extracted from; absent for hand-written questions. */
  materialId?: string;
  /** The objective this question tests. Missing on generated questions until extraction assigns one. */
  objectiveId?: string;
}

/* ── Defaults ─────────────────────────────────────────────────────────── */

export const DEFAULT_CONFIG: ReviewConfig = {
  quick: { duration: "10 min", cadence: "Daily" },
  deep: { duration: "3 hours", cadence: "Weekly" },
  exam: { duration: "10 hours", cadence: "1 wk before exam" },
};

export const DEFAULT_WEIGHTS: Weights = {
  homework: 30,
  practiceExams: 35,
  practiceProblems: 25,
  lectures: 10,
};

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

/* ── Helpers ──────────────────────────────────────────────────────────── */

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
