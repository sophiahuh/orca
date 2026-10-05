"use client";

/**
 * The app's state, on Supabase (Phase 4, plan decisions 1, 4 and 5).
 *
 * `OrcaProvider` loads everything the signed-in student has once (`my_data()`, one consistent
 * read) into the same state screens read before, and every action is an optimistic local update
 * plus a save, run one at a time in order (a course is saved before its upload, an upload's
 * material before its run). A save that fails rolls its update back and shows "Couldn't save: …";
 * an answer that couldn't be saved isn't counted.
 *
 * Where each kind of data is saved:
 * - course structure (topics, objectives, questions, relations, runs): `save_structure`, only the
 *   rows that changed;
 * - evidence (answers and reflections' confusion): `POST /api/evidence`, which stamps the time and
 *   returns the objective's new snapshot;
 * - everything else (courses, settings, materials, calendar, finished sessions, the profile):
 *   direct inserts and updates under row-level security.
 *
 * Objective state comes from the server's snapshots (`objective_state`, rebuilt by
 * `GET /api/state` when stale); the streak, last seen, poor sessions and deep-review cadence are
 * computed from the loaded events, with day boundaries in the profile's timezone.
 *
 * The one thing still in the browser is each upload's page text (`materialPages`, for top-ups)
 * until Task 6 reads material on the server. The bring-your-own model setting is kept in memory
 * only (it holds a key; Task 7 hides it). Older localStorage state (`orca:v3`–`orca:v8`) is removed.
 */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  type CalendarEvent,
  type Course,
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
import type { TopUpPlan } from "./pipeline/topup";
import type { QuizQuestion } from "./data";
import type { AnswerEvent, ConfusionEvent, EvidenceEvent } from "./mastery/types";
import type { CourseStructure } from "./course/ops";
import { type CourseMastery, courseMastery } from "./mastery/course-mastery";
import { type TodoCard, todoCards } from "./mastery/todo";
import { type CourseAgenda, courseAgenda, withNeutralWeights } from "./mastery/agenda";
import { isUnsortedObjectiveId } from "./mastery/catalogue";
import { type ObjectiveAccumulator, dayKeyIn } from "./mastery/objective-state";
import { isUsable } from "./mastery/snapshots";
import { courseObjectiveWeights } from "./course/weights";
import { streakDays } from "./mastery/streak";
import { browserSupabase } from "./supabase/browser";
import { type MyData, type StructureState, calendarToRow, courseToRow, isEmpty, loadedState, materialToRow, sessionFromRow, sessionToRow, structureRows } from "./supabase/app-rows";
import { snapshotFromRow } from "./supabase/rows";
import type { Json } from "./supabase/database.types";
import { useNow } from "@/hooks/useNow";

interface OrcaState {
  courses: Course[];
  events: CalendarEvent[];
  materials: Material[];
  /** materialId → the upload's text, kept so questions can be topped up after sessions (this browser only, until Task 6). */
  materialPages: Record<string, MaterialPages>;
  configs: Record<string, ReviewConfig>;
  weights: Record<string, Weights>;
  results: QuizResult[];
  onboarded: boolean;
  /** The student's IANA timezone (profile); every day boundary uses it. */
  timezone: string;
  /** The student's own model connection (bring-your-own-LLM). In memory only: it holds a key. */
  llm: LlmConfig | null;
  /** Generated questions: courseId → topicId → questions. */
  questionBank: Record<string, Record<string, QuizQuestion[]>>;
  /** Course structure: courseId → objectiveId → objective. Created once, at upload; archived or merged, never deleted. */
  objectives: Record<string, Record<string, Objective>>;
  /** courseId → relations between objectives, from uploads. */
  relations: Record<string, Relation[]>;
  /** Every upload's pipeline run, oldest first. */
  runs: PipelineRun[];
  /** Append-only answer log. Every learner-facing state is computed from it (objective state through snapshots). */
  evidence: EvidenceEvent[];
  /** courseId → objectiveId → the server's snapshot of that objective's fold. No entry: unseen. */
  snapshots: Record<string, Record<string, ObjectiveAccumulator>>;
}

/** Where the provider is with the signed-in student's data. */
export type LoadStatus = "loading" | "signed-out" | "ready" | "failed";

const LEGACY_KEYS = ["orca:v3", "orca:v4", "orca:v5", "orca:v6", "orca:v7", "orca:v8"];
/** Each upload's page text, until Task 6 moves reading to the server (the only app data left in the browser). */
const PAGES_KEY = "orca:materialPages";

const initialState: OrcaState = {
  courses: [],
  events: [],
  materials: [],
  materialPages: {},
  configs: {},
  weights: {},
  results: [],
  onboarded: false,
  timezone: "UTC",
  llm: null,
  questionBank: {},
  objectives: {},
  relations: {},
  runs: [],
  evidence: [],
  snapshots: {},
};

interface OrcaActions {
  addCourse: (name: string) => Course;
  setConfig: (courseId: string, config: ReviewConfig) => void;
  setWeights: (courseId: string, weights: Weights) => void;
  /** Record an uploaded file (and its due date on the calendar), with its text when it was read. The caller picks its id. */
  addMaterial: (m: Material, pages?: MaterialPages) => void;
  recordQuiz: (r: Omit<QuizResult, "finishedAt">) => void;
  /** Append one graded answer. The only way learner state changes. Not counted if it can't be saved. */
  recordEvidence: (e: Omit<AnswerEvent, "id" | "at" | "kind">) => void;
  /** A homework reflection: one confusion event per objective the student confirmed, and the note kept on the material. */
  recordReflection: (materialId: string, note: string, events: Array<Omit<ConfusionEvent, "id" | "at" | "kind" | "materialId" | "note">>) => void;
  setOnboarded: (v: boolean) => void;
  setTimezone: (timezone: string) => void;
  setLlm: (c: LlmConfig | null) => void;
  /** Merge an upload's pipeline result into a course and keep the run's record. */
  applyUpload: (courseId: string, plan: UploadPlan) => void;
  /** Add questions topped up after a session, and keep the runs' records. */
  addQuestions: (courseId: string, plan: TopUpPlan) => void;
  /** Apply a review operation (`src/lib/course/ops.ts`) to one course's topics, objectives and questions. */
  editStructure: (courseId: string, op: (s: CourseStructure) => CourseStructure) => void;
  /** Hide the last save error. */
  dismissSaveError: () => void;
  /** Try loading again after a failure. */
  reload: () => void;
}

type OrcaContextValue = OrcaState &
  OrcaActions & {
    /** The load finished (or there is nobody signed in); screens show empty states only after this. */
    hydrated: boolean;
    status: LoadStatus;
    loadError: string | null;
    /** Saves still in flight. */
    saving: number;
    /** "Couldn't save: …" for the last save that failed (its change was rolled back). */
    saveError: string | null;
  };

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

/* ── Talking to Supabase ──────────────────────────────────────────────── */

/** A Supabase result's data, or a thrown Error with its message. */
function must<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const out = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error(out?.error ?? `the server answered ${res.status}`);
  if (out === null) throw new Error("the server sent nothing back");
  return out;
}

type Recorded = { event: EvidenceEvent; countsFor: string | null; snapshot: { objectiveId: string; accumulator: ObjectiveAccumulator } | null };

/** One course's snapshots through GET /api/state (stale ones are rebuilt there). */
async function fetchSnapshots(courseId: string): Promise<Record<string, ObjectiveAccumulator>> {
  const res = await fetch(`/api/state?course=${encodeURIComponent(courseId)}`, { cache: "no-store" });
  const out = (await res.json().catch(() => null)) as { objectives?: Array<{ objectiveId: string; accumulator: ObjectiveAccumulator }>; error?: string } | null;
  if (!res.ok || !out?.objectives) throw new Error(out?.error ?? `the server answered ${res.status}`);
  return Object.fromEntries(out.objectives.map((o) => [o.objectiveId, o.accumulator]));
}

function readPages(): Record<string, MaterialPages> {
  try {
    const raw = window.localStorage.getItem(PAGES_KEY);
    return raw ? (JSON.parse(raw) as Record<string, MaterialPages>) : {};
  } catch {
    return {};
  }
}

/** Everything the signed-in student has, with fresh snapshots for every course. */
async function loadAll(): Promise<Omit<OrcaState, "materialPages" | "llm">> {
  const data = must(await browserSupabase().rpc("my_data")) as unknown as MyData;
  const loaded = loadedState(data);
  const snapshots: OrcaState["snapshots"] = Object.fromEntries(loaded.courses.map((c) => [c.id, {}]));
  const staleCourses = new Set<string>();
  for (const row of loaded.snapshots) {
    const s = snapshotFromRow(row);
    if (isUsable(s)) snapshots[row.course_id][s.objectiveId] = s.accumulator;
    else staleCourses.add(row.course_id);
  }
  await Promise.all([...staleCourses].map(async (id) => (snapshots[id] = await fetchSnapshots(id))));
  const { snapshots: _rows, ...rest } = loaded;
  void _rows;
  return { ...rest, snapshots };
}

/** The next free slug for a new course ("logic", then "logic-2", …). */
function freeSlug(name: string, taken: readonly string[]): string {
  const base = slugify(name) || "course";
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) if (!taken.includes(`${base}-${n}`)) return `${base}-${n}`;
}

function structureOf(s: OrcaState, courseId: string): StructureState {
  const course = s.courses.find((c) => c.id === courseId);
  if (!course) throw new Error(`No course ${courseId}`);
  return { topics: course.topics, objectives: s.objectives[courseId] ?? {}, bank: s.questionBank[courseId] ?? {}, relations: s.relations[courseId] ?? [] };
}

/** Lay the visible topics out again; archived ones keep their old spot. */
function laidOut(topics: Course["topics"]): Course["topics"] {
  const visible = trailTopics({ topics });
  const positions = defaultTopicPositions(visible.length);
  const posOf = new Map(visible.map((t, i) => [t.id, positions[i]]));
  return topics.map((t) => ({ ...t, pos: posOf.get(t.id) ?? t.pos }));
}

function withStructure(s: OrcaState, courseId: string, next: StructureState): OrcaState {
  return {
    ...s,
    courses: s.courses.map((c) => (c.id === courseId ? { ...c, topics: next.topics } : c)),
    objectives: { ...s.objectives, [courseId]: next.objectives },
    questionBank: { ...s.questionBank, [courseId]: next.bank },
    relations: { ...s.relations, [courseId]: next.relations },
  };
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function OrcaProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<OrcaState>(initialState);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const stateRef = useRef(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  });
  /** Saves in flight, also on <html data-saving> right away (tests wait for it before navigating away). */
  const inFlight = useRef(0);
  /** The user the state belongs to (null: signed out), and the one a load is running for. */
  const loadedFor = useRef<string | null | undefined>(undefined);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pathname = usePathname();

  // Old local state is gone for good (accounts start fresh); page text stays until Task 6.
  useEffect(() => {
    try {
      for (const key of LEGACY_KEYS) window.localStorage.removeItem(key);
    } catch {
      /* storage may be unavailable */
    }
  }, []);

  const load = useCallback(async (force = false) => {
    const { data } = await browserSupabase().auth.getSession();
    const userId = data.session?.user.id ?? null;
    if (!force && loadedFor.current === userId) return;
    loadedFor.current = userId;
    if (userId === null) {
      setState(initialState);
      setLoadError(null);
      setStatus("signed-out");
      return;
    }
    setStatus("loading");
    setLoadError(null);
    try {
      const loaded = await loadAll();
      if (loadedFor.current !== userId) return; // someone else signed in meanwhile
      setState((s) => ({ ...initialState, ...loaded, llm: s.llm, materialPages: readPages() }));
      setStatus("ready");
    } catch (e) {
      if (loadedFor.current !== userId) return;
      setState(initialState);
      setLoadError(`Couldn't load your courses: ${message(e)}`);
      setStatus("failed");
    }
  }, []);

  // Load for whoever is signed in, and again when that changes (sign-in and sign-out navigate).
  useEffect(() => {
    // Loading from the database is what this effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, pathname]);
  useEffect(() => {
    const { data } = browserSupabase().auth.onAuthStateChange(() => void load());
    return () => data.subscription.unsubscribe();
  }, [load]);

  /**
   * Run a save after the ones before it. If it throws, `undo` reverses this action's local change
   * and the error is shown. Nothing is retried: the student sees that it failed.
   */
  const save = useCallback((run: () => Promise<void>, undo: (s: OrcaState) => OrcaState) => {
    const count = (delta: number) => {
      inFlight.current += delta;
      document.documentElement.dataset.saving = String(inFlight.current);
      setSaving(inFlight.current);
    };
    count(1);
    queue.current = queue.current.then(async () => {
      try {
        await run();
      } catch (e) {
        setState(undo);
        setSaveError(`Couldn't save: ${message(e)}`);
      } finally {
        count(-1);
      }
    });
  }, []);

  /** Re-read one course's snapshots after a change that can mark them stale (merges, re-tags, archives). */
  const refreshSnapshots = useCallback(async (courseId: string) => {
    const fresh = await fetchSnapshots(courseId);
    setState((s) => ({ ...s, snapshots: { ...s.snapshots, [courseId]: fresh } }));
  }, []);

  /** After a save landed: re-read snapshots. A failure here doesn't undo the save; it says progress may be out of date. */
  const refreshAfterSave = useCallback(async (courseIds: string[]) => {
    try {
      await Promise.all(courseIds.map((id) => refreshSnapshots(id)));
    } catch (e) {
      setSaveError(`Saved, but couldn't refresh your progress: ${message(e)}. Reload the page to see it.`);
    }
  }, [refreshSnapshots]);

  /** Save a course's structure change: the rows that changed plus any new runs, then fresh snapshots. */
  const saveStructure = useCallback(
    (courseId: string, before: StructureState, after: StructureState, runs: PipelineRun[]) => {
      const rows = structureRows(before, after, runs);
      if (isEmpty(rows)) return;
      save(
        async () => {
          must(await browserSupabase().rpc("save_structure", { course: courseId, rows: rows as unknown as Json }));
          await refreshAfterSave([courseId]);
        },
        (s) => {
          const runIds = new Set(runs.map((r) => r.id));
          return { ...withStructure(s, courseId, before), runs: s.runs.filter((r) => !runIds.has(r.id)) };
        },
      );
    },
    [save, refreshAfterSave],
  );

  const addCourse = useCallback<OrcaActions["addCourse"]>(
    (name) => {
      const s = stateRef.current;
      const n = s.courses.length;
      const course: Course = {
        id: crypto.randomUUID(),
        slug: freeSlug(name, s.courses.map((c) => c.slug)),
        name,
        short: shortName(name),
        variant: VARIANT_CYCLE[n % VARIANT_CYCLE.length],
        pos: OPEN_SLOTS[n % OPEN_SLOTS.length] ?? { x: 300, y: 300 },
        topics: [],
      };
      const id = course.id;
      setState((s) => ({
        ...s,
        courses: [...s.courses, course],
        configs: { ...s.configs, [id]: DEFAULT_CONFIG },
        weights: { ...s.weights, [id]: DEFAULT_WEIGHTS },
        objectives: { ...s.objectives, [id]: {} },
        relations: { ...s.relations, [id]: [] },
        snapshots: { ...s.snapshots, [id]: {} },
      }));
      save(
        async () => void must(await browserSupabase().from("courses").insert(courseToRow(course, DEFAULT_CONFIG, DEFAULT_WEIGHTS))),
        (s) => ({ ...s, courses: s.courses.filter((c) => c.id !== id) }),
      );
      return course;
    },
    [save],
  );

  const setConfig = useCallback<OrcaActions["setConfig"]>(
    (courseId, config) => {
      const before = stateRef.current.configs[courseId];
      setState((s) => ({ ...s, configs: { ...s.configs, [courseId]: config } }));
      const course = stateRef.current.courses.find((c) => c.id === courseId);
      if (!course) throw new Error(`No course ${courseId}`);
      save(
        async () => {
          const row = courseToRow(course, config, stateRef.current.weights[courseId] ?? DEFAULT_WEIGHTS);
          must(await browserSupabase().from("courses").update({ review_config: row.review_config }).eq("id", courseId));
        },
        (s) => ({ ...s, configs: { ...s.configs, [courseId]: before } }),
      );
    },
    [save],
  );

  const setWeights = useCallback<OrcaActions["setWeights"]>(
    (courseId, weights) => {
      const before = stateRef.current.weights[courseId];
      setState((s) => ({ ...s, weights: { ...s.weights, [courseId]: weights } }));
      const course = stateRef.current.courses.find((c) => c.id === courseId);
      if (!course) throw new Error(`No course ${courseId}`);
      save(
        async () => {
          const row = courseToRow(course, stateRef.current.configs[courseId] ?? DEFAULT_CONFIG, weights);
          must(await browserSupabase().from("courses").update({ weights: row.weights }).eq("id", courseId));
        },
        (s) => ({ ...s, weights: { ...s.weights, [courseId]: before } }),
      );
    },
    [save],
  );

  const addMaterial = useCallback<OrcaActions["addMaterial"]>(
    (m, pages) => {
      const event: CalendarEvent | null = m.due
        ? {
            id: crypto.randomUUID(),
            date: m.due,
            kind: m.type === "Homework" ? "hw" : m.type === "Past exam" || m.type === "Practice exam" ? "exam" : "rev",
            title: m.filename.replace(/\.[a-z0-9]+$/i, ""),
            courseId: m.courseId,
          }
        : null;
      setState((s) => {
        const materialPages = pages ? { ...s.materialPages, [m.id]: pages } : s.materialPages;
        if (pages) {
          try {
            window.localStorage.setItem(PAGES_KEY, JSON.stringify(materialPages));
          } catch {
            /* storage may be full or unavailable: top-ups for this file then say they have no text */
          }
        }
        return { ...s, materials: [...s.materials, m], materialPages, events: event ? [...s.events, event] : s.events };
      });
      save(
        async () => {
          const db = browserSupabase();
          must(await db.from("materials").insert(materialToRow(m)));
          if (event) must(await db.from("calendar_events").insert(calendarToRow(event, m.id)));
        },
        (s) => ({ ...s, materials: s.materials.filter((x) => x.id !== m.id), events: s.events.filter((e) => e !== event) }),
      );
    },
    [save],
  );

  const recordQuiz = useCallback<OrcaActions["recordQuiz"]>(
    (r) => {
      const local: QuizResult = { ...r, finishedAt: new Date().toISOString() };
      setState((s) => ({ ...s, results: [...s.results, local] }));
      save(
        async () => {
          const { data: row, error } = await browserSupabase().from("session_results").insert(sessionToRow(r)).select().single();
          if (error) throw new Error(error.message);
          // The database stamps when it finished, on the same clock as the answers.
          const stored = sessionFromRow(row);
          setState((s) => ({ ...s, results: s.results.map((x) => (x === local ? stored : x)) }));
        },
        (s) => ({ ...s, results: s.results.filter((x) => x !== local) }),
      );
    },
    [save],
  );

  /** Post one evidence event; on success the server's copy (its time, topic and objective) replaces the local one and its snapshot is kept. */
  const postEvidence = useCallback(async (local: EvidenceEvent, body: object) => {
    const out = await postJson<Recorded>("/api/evidence", body);
    setState((s) => ({
      ...s,
      evidence: s.evidence.map((e) => (e.id === local.id ? out.event : e)),
      snapshots: out.snapshot
        ? { ...s.snapshots, [out.event.courseId]: { ...s.snapshots[out.event.courseId], [out.snapshot.objectiveId]: out.snapshot.accumulator } }
        : s.snapshots,
    }));
  }, []);

  const recordEvidence = useCallback<OrcaActions["recordEvidence"]>(
    (e) => {
      const event: EvidenceEvent = { ...e, kind: "answer", id: crypto.randomUUID(), at: new Date().toISOString() };
      setState((s) => ({ ...s, evidence: [...s.evidence, event] }));
      save(
        () =>
          postEvidence(event, {
            kind: "answer",
            id: event.id,
            courseId: e.courseId,
            questionId: e.questionId,
            outcome: e.outcome,
            grader: e.grader,
            source: e.source,
            sessionId: e.sessionId,
          }),
        // Not saved, not counted.
        (s) => ({ ...s, evidence: s.evidence.filter((x) => x.id !== event.id) }),
      );
    },
    [save, postEvidence],
  );

  const recordReflection = useCallback<OrcaActions["recordReflection"]>(
    (materialId, note, events) => {
      const at = new Date().toISOString();
      const confusion: ConfusionEvent[] = events.map((e) => ({ ...e, kind: "confusion", id: crypto.randomUUID(), at, materialId, note }));
      const reflection = { at, note, objectiveIds: events.map((e) => e.objectiveId) };
      const before = stateRef.current.materials.find((m) => m.id === materialId)?.reflection;
      setState((s) => ({
        ...s,
        evidence: [...s.evidence, ...confusion],
        materials: s.materials.map((m) => (m.id === materialId ? { ...m, reflection } : m)),
      }));
      const saved = new Set<string>();
      save(
        async () => {
          for (const c of confusion) {
            await postEvidence(c, { kind: "confusion", id: c.id, courseId: c.courseId, objectiveId: c.objectiveId, materialId, note });
            saved.add(c.id);
          }
          must(await browserSupabase().from("materials").update({ reflection: reflection as unknown as Json }).eq("id", materialId));
        },
        // Events already in the log stay (the log is append-only); the rest and the note are undone.
        (s) => ({
          ...s,
          evidence: s.evidence.filter((x) => !confusion.some((c) => c.id === x.id && !saved.has(c.id))),
          materials: s.materials.map((m) => (m.id === materialId ? { ...m, reflection: before } : m)),
        }),
      );
    },
    [save, postEvidence],
  );

  const setOnboarded = useCallback(
    (v: boolean) => {
      const before = stateRef.current.onboarded;
      setState((s) => ({ ...s, onboarded: v }));
      save(
        async () => {
          const { data } = await browserSupabase().auth.getSession();
          if (!data.session) throw new Error("you're signed out");
          must(await browserSupabase().from("profiles").update({ onboarded: v }).eq("owner_id", data.session.user.id));
        },
        (s) => ({ ...s, onboarded: before }),
      );
    },
    [save],
  );

  const setTimezone = useCallback(
    (timezone: string) => {
      const before = stateRef.current.timezone;
      setState((s) => ({ ...s, timezone }));
      save(
        async () => {
          const { data } = await browserSupabase().auth.getSession();
          if (!data.session) throw new Error("you're signed out");
          must(await browserSupabase().from("profiles").update({ timezone }).eq("owner_id", data.session.user.id));
          // A new timezone can move answers to other days: every snapshot is rebuilt.
          await refreshAfterSave(stateRef.current.courses.map((c) => c.id));
        },
        (s) => ({ ...s, timezone: before }),
      );
    },
    [save, refreshAfterSave],
  );

  const applyUpload = useCallback<OrcaActions["applyUpload"]>(
    (courseId, plan) => {
      const before = structureOf(stateRef.current, courseId);
      const merged = applyUploadPlan({ topics: before.topics, objectives: before.objectives, bank: before.bank, relations: before.relations }, plan);
      const after: StructureState = { topics: laidOut(merged.topics), objectives: merged.objectives, bank: merged.bank, relations: merged.relations };
      setState((s) => ({ ...withStructure(s, courseId, after), runs: [...s.runs, plan.run] }));
      saveStructure(courseId, before, after, [plan.run]);
    },
    [saveStructure],
  );

  const addQuestions = useCallback<OrcaActions["addQuestions"]>(
    (courseId, plan) => {
      const before = structureOf(stateRef.current, courseId);
      const bank = { ...before.bank };
      for (const [topicId, qs] of Object.entries(plan.questions)) bank[topicId] = [...(bank[topicId] ?? []), ...qs];
      const after = { ...before, bank };
      setState((s) => ({ ...withStructure(s, courseId, after), runs: [...s.runs, ...plan.runs] }));
      saveStructure(courseId, before, after, plan.runs);
    },
    [saveStructure],
  );

  const editStructure = useCallback<OrcaActions["editStructure"]>(
    (courseId, op) => {
      const before = structureOf(stateRef.current, courseId);
      const next = op({ topics: before.topics, objectives: before.objectives, bank: before.bank });
      const after: StructureState = { topics: laidOut(next.topics), objectives: next.objectives, bank: next.bank, relations: before.relations };
      setState((s) => withStructure(s, courseId, after));
      saveStructure(courseId, before, after, []);
    },
    [saveStructure],
  );

  const setLlm = useCallback((llm: LlmConfig | null) => setState((s) => ({ ...s, llm })), []);
  const dismissSaveError = useCallback(() => setSaveError(null), []);
  const reload = useCallback(() => void load(true), [load]);

  const hydrated = status !== "loading";
  const value = useMemo<OrcaContextValue>(
    () => ({
      ...state,
      hydrated,
      status,
      loadError,
      saving,
      saveError,
      addCourse,
      setConfig,
      setWeights,
      addMaterial,
      recordQuiz,
      recordEvidence,
      recordReflection,
      setOnboarded,
      setTimezone,
      setLlm,
      applyUpload,
      addQuestions,
      editStructure,
      dismissSaveError,
      reload,
    }),
    [state, hydrated, status, loadError, saving, saveError, addCourse, setConfig, setWeights, addMaterial, recordQuiz, recordEvidence, recordReflection, setOnboarded, setTimezone, setLlm, applyUpload, addQuestions, editStructure, dismissSaveError, reload],
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

/** Day keys (YYYY-MM-DD) in the student's timezone; every day boundary uses it. */
export function useDayKey(): (iso: string) => string {
  const { timezone } = useOrca();
  return useMemo(() => dayKeyIn(timezone), [timezone]);
}

/** Derived learner state for every course: objective states (from snapshots), topic progress, island level. */
export function useMasteryByCourse(): Record<string, CourseMastery> {
  const { courses, questionBank, objectives, evidence, snapshots } = useOrca();
  const dayKey = useDayKey();
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
            snapshots: new Map(Object.entries(snapshots[c.id] ?? {})),
            now: new Date(nowMs),
            dayKey,
          }),
        ]),
      ),
    [courses, questionBank, objectives, evidence, snapshots, nowMs, dayKey],
  );
}

/** The sidebar's to-do cards for every course, today's first. */
export function useTodos(): TodoCard[] {
  const { courses, objectives, configs } = useOrca();
  const agenda = useAgenda();
  return useMemo(
    () =>
      courses.flatMap((c) => {
        const a = agenda[c.id];
        if (!a) throw new Error(`No agenda computed for course ${c.id}`);
        const catalogue = objectives[c.id] ?? {};
        return todoCards(a, configs[c.id] ?? DEFAULT_CONFIG, {
          objective: (id) => {
            if (isUnsortedObjectiveId(id)) return "Questions not yet sorted into objectives";
            const o = catalogue[id];
            if (!o) throw new Error(`Objective ${id} is not in course ${c.id}`);
            return o.name;
          },
          topic: (id) => {
            const t = c.topics.find((x) => x.id === id);
            if (!t) throw new Error(`Topic ${id} is not in course ${c.id}`);
            return t.name;
          },
        });
      }),
    [courses, objectives, configs, agenda],
  );
}

/** Days in a row with at least one unaided graded answer. */
export function useStreak(): number {
  const { evidence } = useOrca();
  const dayKey = useDayKey();
  const nowMs = useNow();
  return useMemo(() => streakDays(evidence, new Date(nowMs), dayKey), [evidence, nowMs, dayKey]);
}

/** What's due, per course: ranked objectives, quick and deep review, review to-dos and re-quizzes. */
export function useAgenda(): Record<string, CourseAgenda> {
  const { courses, objectives, relations, weights, configs, results, events } = useOrca();
  const mastery = useMasteryByCourse();
  const dayKey = useDayKey();
  const nowMs = useNow();
  return useMemo(
    () =>
      Object.fromEntries(
        courses.map((c) => {
          const m = mastery[c.id];
          if (!m) throw new Error(`No mastery computed for course ${c.id}`);
          const sliders = weights[c.id] ?? DEFAULT_WEIGHTS;
          const computed = courseObjectiveWeights(objectives[c.id] ?? {}, relations[c.id] ?? [], sliders);
          const agenda = courseAgenda({
            courseId: c.id,
            mastery: m,
            weights: withNeutralWeights(m.objectives.keys(), computed, isUnsortedObjectiveId),
            config: configs[c.id] ?? DEFAULT_CONFIG,
            results,
            examDays: events.filter((e) => e.kind === "exam" && e.courseId === c.id).map((e) => e.date),
            now: new Date(nowMs),
            dayKey,
          });
          return [c.id, agenda];
        }),
      ),
    [courses, objectives, relations, weights, configs, results, events, mastery, nowMs, dayKey],
  );
}
