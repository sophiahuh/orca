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
import { type Extraction, promptKey, questionsByTopic, topicsFrom } from "./extraction";
import type { QuizQuestion } from "./data";
import type { EvidenceEvent } from "./mastery/types";
import type { CourseStructure } from "./course/ops";
import { type CourseMastery, courseMastery } from "./mastery/course-mastery";
import { dueTopics } from "./mastery/due";
import { streakDays } from "./mastery/streak";
import { useNow } from "@/hooks/useNow";

interface QuizResult {
  courseId: string;
  topicId: string;
  correct: number;
  total: number;
  seconds: number;
  finishedAt: string;
}

interface OrcaState {
  courses: Course[];
  events: CalendarEvent[];
  materials: Material[];
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

const STORAGE_KEY = "orca:v7"; // v7: course structure from uploads (review status, aliases, merges, relations)

const initialState: OrcaState = {
  // No built-in courses: every course is created by the student and filled from their uploads.
  courses: [],
  events: [],
  materials: [],
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
  addMaterial: (m: Omit<Material, "id">) => void;
  recordQuiz: (r: Omit<QuizResult, "finishedAt">) => void;
  /** Append one graded answer. The only way learner state changes. */
  recordEvidence: (e: Omit<EvidenceEvent, "id" | "at">) => void;
  setOnboarded: (v: boolean) => void;
  setLlm: (c: LlmConfig | null) => void;
  /** Merge an extraction into a course: new topics on the trail, questions in the bank, material recorded. */
  importExtraction: (courseId: string, material: Omit<Material, "id">, extraction: Extraction, figures?: Record<number, string>) => { topicsAdded: number; questionsAdded: number };
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

  const addMaterial = useCallback<OrcaActions["addMaterial"]>((m) => {
    const id = `m-${Date.now().toString(36)}`;
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
      return { ...s, materials: [...s.materials, { ...m, id }], events };
    });
  }, []);

  const recordQuiz = useCallback<OrcaActions["recordQuiz"]>((r) => {
    setState((s) => ({
      ...s,
      results: [...s.results, { ...r, finishedAt: new Date().toISOString() }],
    }));
  }, []);

  const recordEvidence = useCallback<OrcaActions["recordEvidence"]>((e) => {
    const event: EvidenceEvent = { ...e, id: crypto.randomUUID(), at: new Date().toISOString() };
    setState((s) => ({ ...s, evidence: [...s.evidence, event] }));
  }, []);

  const setOnboarded = useCallback((v: boolean) => setState((s) => ({ ...s, onboarded: v })), []);
  const importExtraction = useCallback<OrcaActions["importExtraction"]>((courseId, material, extraction, figures = {}) => {
    const id = crypto.randomUUID();
    const extracted = topicsFrom(extraction, material.filename, id);
    let topicsAdded = 0;
    let questionsAdded = 0;
    setState((s) => {
      // Extracted topic name → topic id: an existing topic with that name or alias, else a new one.
      const idByName = new Map<string, string>();
      const courses = s.courses.map((c) => {
        if (c.id !== courseId) return c;
        const topics = [...c.topics];
        for (const t of extracted) {
          const key = t.name.toLowerCase();
          const i = topics.findIndex((x) => x.review !== "archived" && [x.name, ...x.aliases].some((n) => n.toLowerCase() === key));
          if (i >= 0) {
            topics[i] = { ...topics[i], summary: t.summary ?? topics[i].summary, source: t.source ?? topics[i].source };
            idByName.set(key, topics[i].id);
          } else {
            topics.push({ ...t, pos: { x: 0, y: 0 } });
            idByName.set(key, t.id);
            topicsAdded++;
          }
        }
        const positions = defaultTopicPositions(topics.length);
        return { ...c, trail: undefined, topics: topics.map((t, i) => ({ ...t, pos: positions[i] })) };
      });
      const byTopic = questionsByTopic(extraction, (name) => idByName.get(name.toLowerCase()), id, material.filename, figures);
      const bank = { ...(s.questionBank[courseId] ?? {}) };
      // Skip questions the course already has anywhere (or that repeat within this upload): a
      // re-uploaded question would otherwise count as a "different" question toward mastery.
      const seen = new Set(Object.values(bank).flat().map((q) => promptKey(q.prompt)));
      for (const [topicId, qs] of Object.entries(byTopic)) {
        const fresh = qs.filter((q) => {
          const key = promptKey(q.prompt);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        questionsAdded += fresh.length;
        bank[topicId] = [...(bank[topicId] ?? []), ...fresh];
      }
      const events = [...s.events];
      if (material.due) {
        events.push({
          id: `ev-${id}`,
          date: material.due,
          kind: material.type === "Homework" ? "hw" : material.type === "Past exam" || material.type === "Practice exam" ? "exam" : "rev",
          title: material.filename.replace(/\.[a-z0-9]+$/i, ""),
          courseId,
        });
      }
      return { ...s, courses, events, materials: [...s.materials, { ...material, id }], questionBank: { ...s.questionBank, [courseId]: bank } };
    });
    return { topicsAdded, questionsAdded };
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
    () => ({ ...state, hydrated, addCourse, setConfig, setWeights, addMaterial, recordQuiz, recordEvidence, setOnboarded, setLlm, importExtraction, editStructure, reset }),
    [state, hydrated, addCourse, setConfig, setWeights, addMaterial, recordQuiz, recordEvidence, setOnboarded, setLlm, importExtraction, editStructure, reset],
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
