"use client";

/**
 * Client-side app state for the v1 prototype.
 *
 * One React context, persisted to localStorage. Swap the persistence layer
 * for Supabase later without touching the screens: every screen only talks
 * to the hooks exported here.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  type CalendarEvent,
  type Course,
  type DueItem,
  type IslandVariant,
  type Material,
  type MaterialPages,
  type QuizResult,
  type Objective,
  type PipelineRun,
  type Relation,
  type ReviewConfig,
  type Weights,
  DEFAULT_CONFIG,
  DEFAULT_WEIGHTS,
  defaultTopicPositions,
  shortName,
  trailTopics,
  slugify,
} from "./data";
import type { LlmConfig } from "./llm";
import type { UploadPlan } from "./pipeline/run";
import { applyUploadPlan } from "./pipeline/apply";
import type { QuizQuestion } from "./data";
import type { AnswerEvent, ConfusionEvent, EvidenceEvent } from "./mastery/types";
import type { CourseStructure } from "./course/ops";
import { type CourseMastery, courseMastery } from "./mastery/course-mastery";
import { dueTopics } from "./mastery/due";
import { streakDays } from "./mastery/streak";
import { useNow } from "@/hooks/useNow";

interface OrcaState {
  courses: Course[];
  events: CalendarEvent[];
  materials: Material[];
  /** materialId → the upload's text, kept so questions can be topped up after sessions. */
  materialPages: Record<string, MaterialPages>;
  configs: Record<string, ReviewConfig>;
  weights: Record<string, Weights>;
  results: QuizResult[];
  onboarded: boolean;
  /** The student's own model connection (bring-your-own-LLM). Lives only in this browser. */
  llm: LlmConfig | null;
  /** Generated questions: courseId → topicId → questions. */
  questionBank: Record<string, Record<string, QuizQuestion[]>>;
  /** Course structure: courseId → objectiveId → objective. Created once, at upload; archived or merged, never deleted. */
  objectives: Record<string, Record<string, Objective>>;
  /** courseId → relations between objectives, from uploads. */
  relations: Record<string, Relation[]>;
  /** Every upload's pipeline run, newest last. */
  runs: PipelineRun[];
  /** Append-only answer log. Every learner-facing state is computed from it. */
  evidence: EvidenceEvent[];
}

const STORAGE_KEY = "orca:v8"; // v8: finished sessions carry mode and sessionId; uploads keep their text

const initialState: OrcaState = {
  // No built-in courses: every course is created by the student and filled from their uploads.
  courses: [],
  events: [],
  materials: [],
  materialPages: {},
  configs: {},
  weights: {},
  results: [],
  onboarded: false,
  llm: null,
  questionBank: {},
  objectives: {},
  relations: {},
  runs: [],
  evidence: [],
};

interface OrcaActions {
  addCourse: (name: string) => Course;
  setConfig: (courseId: string, config: ReviewConfig) => void;
  setWeights: (courseId: string, weights: Weights) => void;
  /** Record an uploaded file (and its due date on the calendar), with its text when it was read. The caller picks its id. */
  addMaterial: (m: Material, pages?: MaterialPages) => void;
  recordQuiz: (r: Omit<QuizResult, "finishedAt">) => void;
  /** Append one graded answer. The only way learner state changes. */
  recordEvidence: (e: Omit<AnswerEvent, "id" | "at" | "kind">) => void;
  /** A homework reflection: one confusion event per objective the student confirmed, and the note kept on the material. */
  recordReflection: (materialId: string, note: string, events: Array<Omit<ConfusionEvent, "id" | "at" | "kind" | "materialId" | "note">>) => void;
  setOnboarded: (v: boolean) => void;
  setLlm: (c: LlmConfig | null) => void;
  /** Merge an upload's pipeline result into a course and keep the run's record. */
  applyUpload: (courseId: string, plan: UploadPlan) => void;
  /** Apply a review operation (`src/lib/course/ops.ts`) to one course's topics, objectives and questions. */
  editStructure: (courseId: string, op: (s: CourseStructure) => CourseStructure) => void;
  reset: () => void;
}

type OrcaContextValue = OrcaState & OrcaActions & { hydrated: boolean };

const OrcaContext = createContext<OrcaContextValue | null>(null);

const VARIANT_CYCLE: IslandVariant[] = ["ald", "circuit", "signals", "linear", "stats"];

/** Free slots on the map for newly created islands (854×834 canvas). */
const OPEN_SLOTS = [
  { x: 70, y: 110 },
  { x: 560, y: 260 },
  { x: 120, y: 290 },
  { x: 330, y: 20 },
  { x: 560, y: 650 },
  { x: 40, y: 20 },
];

export function OrcaProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<OrcaState>(initialState);
  const [hydrated, setHydrated] = useState(false);

  // Load once on mount.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<OrcaState>;
        // Hydrating persisted state after mount is intentional: reading
        // localStorage during render would mismatch the server HTML.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setState((s) => ({ ...s, ...saved }));
      }
    } catch {
      /* ignore corrupt storage */
    }
    setHydrated(true);
  }, []);

  // Persist on change (after hydration so we never clobber saved data with seeds).
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage may be unavailable */
    }
  }, [state, hydrated]);

  const addCourse = useCallback<OrcaActions["addCourse"]>(
    (name) => {
      const id = `${slugify(name)}-${Date.now().toString(36)}`;
      const course: Course = {
        id,
        slug: slugify(name),
        name,
        short: shortName(name),
        variant: VARIANT_CYCLE[state.courses.length % VARIANT_CYCLE.length],
        pos: OPEN_SLOTS[state.courses.length % OPEN_SLOTS.length] ?? { x: 300, y: 300 },
        topics: [],
      };
      setState((s) => ({
        ...s,
        courses: [...s.courses, course],
        configs: { ...s.configs, [id]: DEFAULT_CONFIG },
        weights: { ...s.weights, [id]: DEFAULT_WEIGHTS },
        objectives: { ...s.objectives, [id]: {} },
      }));
      return course;
    },
    [state.courses.length],
  );

  const setConfig = useCallback<OrcaActions["setConfig"]>((courseId, config) => {
    setState((s) => ({ ...s, configs: { ...s.configs, [courseId]: config } }));
  }, []);

  const setWeights = useCallback<OrcaActions["setWeights"]>((courseId, weights) => {
    setState((s) => ({ ...s, weights: { ...s.weights, [courseId]: weights } }));
  }, []);

  const addMaterial = useCallback<OrcaActions["addMaterial"]>((m, pages) => {
    const id = m.id;
    setState((s) => {
      const events = [...s.events];
      if (m.due) {
        events.push({
          id: `ev-${id}`,
          date: m.due,
          kind: m.type === "Homework" ? "hw" : m.type === "Past exam" || m.type === "Practice exam" ? "exam" : "rev",
          title: m.filename.replace(/\.[a-z0-9]+$/i, ""),
          courseId: m.courseId,
        });
      }
      const materialPages = pages ? { ...s.materialPages, [id]: pages } : s.materialPages;
      return { ...s, materials: [...s.materials, m], materialPages, events };
    });
  }, []);

  const recordQuiz = useCallback<OrcaActions["recordQuiz"]>((r) => {
    setState((s) => ({
      ...s,
      results: [...s.results, { ...r, finishedAt: new Date().toISOString() }],
    }));
  }, []);

  const recordEvidence = useCallback<OrcaActions["recordEvidence"]>((e) => {
    const event: EvidenceEvent = { ...e, kind: "answer", id: crypto.randomUUID(), at: new Date().toISOString() };
    setState((s) => ({ ...s, evidence: [...s.evidence, event] }));
  }, []);

  const recordReflection = useCallback<OrcaActions["recordReflection"]>((materialId, note, events) => {
    const at = new Date().toISOString();
    const confusion: EvidenceEvent[] = events.map((e) => ({ ...e, kind: "confusion", id: crypto.randomUUID(), at, materialId, note }));
    setState((s) => ({
      ...s,
      evidence: [...s.evidence, ...confusion],
      materials: s.materials.map((m) => (m.id === materialId ? { ...m, reflection: { at, note, objectiveIds: events.map((e) => e.objectiveId) } } : m)),
    }));
  }, []);

  const setOnboarded = useCallback((v: boolean) => setState((s) => ({ ...s, onboarded: v })), []);
  const applyUpload = useCallback<OrcaActions["applyUpload"]>((courseId, plan) => {
    setState((s) => {
      const course = s.courses.find((c) => c.id === courseId);
      if (!course) throw new Error(`No course ${courseId}`);
      const next = applyUploadPlan(
        { topics: course.topics, objectives: s.objectives[courseId] ?? {}, bank: s.questionBank[courseId] ?? {}, relations: s.relations[courseId] ?? [] },
        plan,
      );
      const visible = trailTopics({ topics: next.topics });
      const positions = defaultTopicPositions(visible.length);
      const posOf = new Map(visible.map((t, i) => [t.id, positions[i]]));
      const topics = next.topics.map((t) => ({ ...t, pos: posOf.get(t.id) ?? t.pos }));
      return {
        ...s,
        courses: s.courses.map((c) => (c.id === courseId ? { ...c, trail: undefined, topics } : c)),
        objectives: { ...s.objectives, [courseId]: next.objectives },
        questionBank: { ...s.questionBank, [courseId]: next.bank },
        relations: { ...s.relations, [courseId]: next.relations },
        runs: [...s.runs, plan.run],
      };
    });
  }, []);

  const editStructure = useCallback<OrcaActions["editStructure"]>((courseId, op) => {
    setState((s) => {
      const course = s.courses.find((c) => c.id === courseId);
      if (!course) throw new Error(`No course ${courseId}`);
      const next = op({ topics: course.topics, objectives: s.objectives[courseId] ?? {}, bank: s.questionBank[courseId] ?? {} });
      // Lay the visible topics out again; archived ones keep their old spot.
      const visible = trailTopics({ topics: next.topics });
      const positions = defaultTopicPositions(visible.length);
      const posOf = new Map(visible.map((t, i) => [t.id, positions[i]]));
      const topics = next.topics.map((t) => ({ ...t, pos: posOf.get(t.id) ?? t.pos }));
      return {
        ...s,
        courses: s.courses.map((c) => (c.id === courseId ? { ...c, trail: undefined, topics } : c)),
        objectives: { ...s.objectives, [courseId]: next.objectives },
        questionBank: { ...s.questionBank, [courseId]: next.bank },
      };
    });
  }, []);

  const setLlm = useCallback((llm: LlmConfig | null) => setState((s) => ({ ...s, llm })), []);
  const reset = useCallback(() => setState(initialState), []);

  const value = useMemo<OrcaContextValue>(
    () => ({ ...state, hydrated, addCourse, setConfig, setWeights, addMaterial, recordQuiz, recordEvidence, recordReflection, setOnboarded, setLlm, applyUpload, editStructure, reset }),
    [state, hydrated, addCourse, setConfig, setWeights, addMaterial, recordQuiz, recordEvidence, recordReflection, setOnboarded, setLlm, applyUpload, editStructure, reset],
  );

  return <OrcaContext.Provider value={value}>{children}</OrcaContext.Provider>;
}

export function useOrca() {
  const ctx = useContext(OrcaContext);
  if (!ctx) throw new Error("useOrca must be used inside <OrcaProvider>");
  return ctx;
}

export function useCourse(idOrSlug: string | undefined) {
  const { courses } = useOrca();
  return courses.find((c) => c.id === idOrSlug || c.slug === idOrSlug);
}

/** Derived learner state for every course: objective states, topic progress, island level. */
export function useMasteryByCourse(): Record<string, CourseMastery> {
  const { courses, questionBank, objectives, evidence } = useOrca();
  const nowMs = useNow();
  return useMemo(
    () =>
      Object.fromEntries(
        courses.map((c) => [
          c.id,
          courseMastery({
            courseId: c.id,
            topicIds: trailTopics(c).map((t) => t.id),
            bank: questionBank[c.id] ?? {},
            catalogue: objectives[c.id] ?? {},
            evidence,
            now: new Date(nowMs),
          }),
        ]),
      ),
    [courses, questionBank, objectives, evidence, nowMs],
  );
}

/** Topics with reviews due today or tomorrow, across every course. */
export function useDueItems(): DueItem[] {
  const { courses } = useOrca();
  const mastery = useMasteryByCourse();
  const nowMs = useNow();
  return useMemo(
    () =>
      courses.flatMap((c) => {
        const m = mastery[c.id];
        if (!m) throw new Error(`No mastery computed for course ${c.id}`);
        return dueTopics(c.id, m, new Date(nowMs)).map((d) => {
          const topic = c.topics.find((t) => t.id === d.topicId);
          if (!topic) throw new Error(`Due topic ${d.topicId} is not in course ${c.id}`);
          return { id: `${c.id}:${d.topicId}:${d.when}`, courseId: c.id, topicId: d.topicId, title: topic.name, when: d.when, count: d.objectiveIds.length };
        });
      }),
    [courses, mastery, nowMs],
  );
}

/** Days in a row with at least one unaided graded answer. */
export function useStreak(): number {
  const { evidence } = useOrca();
  const nowMs = useNow();
  return useMemo(() => streakDays(evidence, new Date(nowMs)), [evidence, nowMs]);
}
