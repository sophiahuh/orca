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
  type ReviewConfig,
  type Weights,
  DEFAULT_CONFIG,
  DEFAULT_WEIGHTS,
  SEED_COURSES,
  defaultTopicPositions,
  shortName,
  slugify,
} from "./data";
import type { LlmConfig } from "./llm";
import { type Extraction, questionsByTopic, topicsFrom } from "./extraction";
import type { QuizQuestion } from "./data";
import { ALD_QUESTION_BANK } from "./content/ald";
import type { EvidenceEvent, ObjectiveInfo } from "./mastery/types";
import { type CourseMastery, courseMastery } from "./mastery/course-mastery";
import { dueTopics } from "./mastery/due";
import { streakDays } from "./mastery/streak";
import { ALD_OBJECTIVES } from "./content/ald-objectives";
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
  /** Course structure: courseId → objectiveId → objective. Created once (built-in content now, uploads from Phase 2), never regenerated. */
  objectives: Record<string, Record<string, ObjectiveInfo>>;
  /** Append-only answer log. Every learner-facing state is computed from it. */
  evidence: EvidenceEvent[];
}

const STORAGE_KEY = "orca:v5"; // v5: due list and streak are derived; no fabricated seed data

const initialState: OrcaState = {
  courses: SEED_COURSES,
  events: [],
  materials: [],
  configs: Object.fromEntries(SEED_COURSES.map((c) => [c.id, DEFAULT_CONFIG])),
  weights: Object.fromEntries(SEED_COURSES.map((c) => [c.id, DEFAULT_WEIGHTS])),
  results: [],
  onboarded: false,
  llm: null,
  questionBank: { ald: ALD_QUESTION_BANK },
  objectives: { ald: ALD_OBJECTIVES },
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
  reset: () => void;
}

type OrcaContextValue = OrcaState & OrcaActions & { hydrated: boolean };

const OrcaContext = createContext<OrcaContextValue | null>(null);

const VARIANT_CYCLE: IslandVariant[] = ["ald", "circuit", "signals", "linear", "stats"];

/** Free slots on the map for newly created islands (854×834 canvas). */
const OPEN_SLOTS = [
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
        // Built-in content always wins for its own topic ids, so authored fixes reach existing browsers.
        const savedBank = saved.questionBank ?? {};
        saved.questionBank = { ...savedBank, ald: { ...(savedBank.ald ?? {}), ...ALD_QUESTION_BANK } };
        saved.objectives = { ...(saved.objectives ?? {}), ald: ALD_OBJECTIVES };
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
    const newTopics = topicsFrom(extraction, material.filename);
    const byTopic = questionsByTopic(extraction, material.filename, figures);
    let topicsAdded = 0;
    let questionsAdded = 0;
    setState((s) => {
      const courses = s.courses.map((c) => {
        if (c.id !== courseId) return c;
        const topics = [...c.topics];
        for (const t of newTopics) {
          const i = topics.findIndex((x) => x.id === t.id);
          if (i >= 0) {
            topics[i] = { ...topics[i], summary: t.summary ?? topics[i].summary, source: t.source ?? topics[i].source };
          } else {
            topics.push({ ...t, pos: { x: 0, y: 0 } });
            topicsAdded++;
          }
        }
        const positions = defaultTopicPositions(topics.length);
        return { ...c, trail: undefined, topics: topics.map((t, i) => ({ ...t, pos: positions[i] })) };
      });
      const bank = { ...(s.questionBank[courseId] ?? {}) };
      for (const [topicId, qs] of Object.entries(byTopic)) {
        const existing = bank[topicId] ?? [];
        const seen = new Set(existing.map((q) => q.prompt));
        const fresh = qs.filter((q) => !seen.has(q.prompt));
        questionsAdded += fresh.length;
        bank[topicId] = [...existing, ...fresh];
      }
      const id = `m-${Date.now().toString(36)}`;
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

  const setLlm = useCallback((llm: LlmConfig | null) => setState((s) => ({ ...s, llm })), []);
  const reset = useCallback(() => setState(initialState), []);

  const value = useMemo<OrcaContextValue>(
    () => ({ ...state, hydrated, addCourse, setConfig, setWeights, addMaterial, recordQuiz, recordEvidence, setOnboarded, setLlm, importExtraction, reset }),
    [state, hydrated, addCourse, setConfig, setWeights, addMaterial, recordQuiz, recordEvidence, setOnboarded, setLlm, importExtraction, reset],
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
            topicIds: c.topics.map((t) => t.id),
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
