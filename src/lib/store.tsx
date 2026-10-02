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
  SEED_DUE,
  SEED_EVENTS,
  SEED_MATERIALS,
  defaultTopicPositions,
  shortName,
  slugify,
} from "./data";

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
  due: DueItem[];
  events: CalendarEvent[];
  materials: Material[];
  configs: Record<string, ReviewConfig>;
  weights: Record<string, Weights>;
  streak: number;
  results: QuizResult[];
  onboarded: boolean;
}

const STORAGE_KEY = "orca:v1";

const initialState: OrcaState = {
  courses: SEED_COURSES,
  due: SEED_DUE,
  events: SEED_EVENTS,
  materials: SEED_MATERIALS,
  configs: Object.fromEntries(SEED_COURSES.map((c) => [c.id, DEFAULT_CONFIG])),
  weights: Object.fromEntries(SEED_COURSES.map((c) => [c.id, DEFAULT_WEIGHTS])),
  streak: 5,
  results: [],
  onboarded: false,
};

interface OrcaActions {
  addCourse: (name: string) => Course;
  setConfig: (courseId: string, config: ReviewConfig) => void;
  setWeights: (courseId: string, weights: Weights) => void;
  addMaterial: (m: Omit<Material, "id">) => void;
  recordQuiz: (r: Omit<QuizResult, "finishedAt">) => void;
  setOnboarded: (v: boolean) => void;
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
      const positions = defaultTopicPositions(4);
      const course: Course = {
        id,
        slug: slugify(name),
        name,
        short: shortName(name),
        variant: VARIANT_CYCLE[state.courses.length % VARIANT_CYCLE.length],
        pos: OPEN_SLOTS[state.courses.length % OPEN_SLOTS.length] ?? { x: 300, y: 300 },
        topics: ["Intro", "Foundations", "Practice", "Review"].map((n, i) => ({
          id: slugify(n),
          name: n,
          status: i === 0 ? "current" : "locked",
          lessons: 4,
          lessonsDone: 0,
          pos: positions[i],
        })),
      };
      setState((s) => ({
        ...s,
        courses: [...s.courses, course],
        configs: { ...s.configs, [id]: DEFAULT_CONFIG },
        weights: { ...s.weights, [id]: DEFAULT_WEIGHTS },
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
    setState((s) => {
      const courses = s.courses.map((c) => {
        if (c.id !== r.courseId) return c;
        const topics = c.topics.map((t) => {
          if (t.id !== r.topicId) return t;
          const lessonsDone = Math.min(t.lessons, t.lessonsDone + 1);
          return { ...t, lessonsDone, status: lessonsDone >= t.lessons ? ("done" as const) : t.status };
        });
        // Unlock the next topic once the current one is done.
        const idx = topics.findIndex((t) => t.id === r.topicId);
        if (idx >= 0 && topics[idx].status === "done" && topics[idx + 1]?.status === "locked") {
          topics[idx + 1] = { ...topics[idx + 1], status: "current" };
        }
        return { ...c, topics };
      });
      return {
        ...s,
        courses,
        streak: s.streak + (s.results.length === 0 ? 1 : 0),
        results: [...s.results, { ...r, finishedAt: new Date().toISOString() }],
      };
    });
  }, []);

  const setOnboarded = useCallback((v: boolean) => setState((s) => ({ ...s, onboarded: v })), []);
  const reset = useCallback(() => setState(initialState), []);

  const value = useMemo<OrcaContextValue>(
    () => ({ ...state, hydrated, addCourse, setConfig, setWeights, addMaterial, recordQuiz, setOnboarded, reset }),
    [state, hydrated, addCourse, setConfig, setWeights, addMaterial, recordQuiz, setOnboarded, reset],
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
