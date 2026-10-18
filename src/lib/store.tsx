"use client";

/**
 * The app's state, on Supabase (Phase 4, plan decisions 1, 4 and 5).
 *
 * `OrcaProvider` loads everything the signed-in student has once (`my_data()`, one consistent
 * read) into the same state screens read before, and every action is an optimistic local update
 * plus a save, run one at a time in order (a course is saved before its upload, an upload's
 * material before its run). A save that fails shows "Couldn't save: …", cancels the saves queued
 * behind it (they may build on it), and reads everything again from the database, so the screen
 * matches what was saved; an answer that couldn't be saved isn't counted.
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
 * Uploaded files go to Storage and are read on the server (`src/lib/uploads.ts`); the server's jobs
 * build their topics, objectives and questions and top up the stock after sessions, and the
 * screens that follow a job call `refresh()` when it finishes. Run records are the server's: the
 * store reads them, never writes them. The bring-your-own model setting is kept in memory only (it
 * holds a key; Settings no longer shows it). Older localStorage state (`orca:v3`–`orca:v8`
 * and the page text uploads used to keep, `orca:materialPages`) is removed.
 */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  type CalendarEvent,
  type Exam,
  type FeedbackReason,
  type QuestionRating,
  type Course,
  type IslandVariant,
  type Material,
  type QuizResult,
  type Objective,
  type PipelineRun,
  type Relation,
  type ReviewConfig,
  type Weights,
  DEFAULT_CONFIG,
  DEFAULT_WEIGHTS,
  shortName,
  trailTopics,
  slugify,
} from "./data";
import type { LlmConfig } from "./llm";
import { type AvatarId, DEFAULT_AVATAR } from "./avatars";
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
import { laidOut } from "./course/layout";
import { placeIslands } from "./course/islands";
import { streakDays } from "./mastery/streak";
import { browserSupabase } from "./supabase/browser";
import { type MyData, type StructureState, calendarToRow, courseToRow, defaultsToRow, examToRow, isEmpty, loadedState, materialInsertRow, sessionFromRow, sessionToRow, structureRows } from "./supabase/app-rows";
import { snapshotFromRow } from "./supabase/rows";
import { confusionEventId } from "./mastery/ids";
import type { Json } from "./supabase/database.types";
import { useNow } from "@/hooks/useNow";

interface OrcaState {
  courses: Course[];
  events: CalendarEvent[];
  /** Each course's exams (their dates and the topics they cover). */
  exams: Exam[];
  /** questionId → the student's thumbs up or down; a thumbs-down question isn't asked again. */
  feedback: Record<string, QuestionRating>;
  materials: Material[];
  configs: Record<string, ReviewConfig>;
  weights: Record<string, Weights>;
  /** Explicit course settings, if any. Null inherits the account default. */
  configOverrides: Record<string, ReviewConfig | null>;
  weightOverrides: Record<string, Weights | null>;
  /** Account defaults, used by every course without an explicit override. */
  defaultConfig: ReviewConfig;
  defaultWeights: Weights;
  results: QuizResult[];
  onboarded: boolean;
  /** The student's IANA timezone (profile); every day boundary uses it. */
  timezone: string;
  /** The student's sea-buddy avatar (profile), shown in the top bar. */
  avatar: AvatarId;
  /** The name given at sign-up (profile); null when none. */
  name: string | null;
  /** The student's own model connection (bring-your-own-LLM). In memory only: it holds a key. */
  llm: LlmConfig | null;
  /** Generated questions: courseId → topicId → questions. */
  questionBank: Record<string, Record<string, QuizQuestion[]>>;
  /** Course structure: courseId → objectiveId → objective. Created once, at upload; archived or merged, never deleted. */
  objectives: Record<string, Record<string, Objective>>;
  /** courseId → relations between topics (used-in, has-a-kind, alternative-to, related), from uploads. */
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

const LEGACY_KEYS = ["orca:v3", "orca:v4", "orca:v5", "orca:v6", "orca:v7", "orca:v8", "orca:materialPages"];

const initialState: OrcaState = {
  courses: [],
  events: [],
  exams: [],
  feedback: {},
  materials: [],
  configs: {},
  weights: {},
  configOverrides: {},
  weightOverrides: {},
  defaultConfig: DEFAULT_CONFIG,
  defaultWeights: DEFAULT_WEIGHTS,
  results: [],
  onboarded: false,
  timezone: "UTC",
  avatar: DEFAULT_AVATAR,
  name: null,
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
  /** Rename a course without changing its stable URL slug or compact labels elsewhere. */
  renameCourse: (courseId: string, name: string) => void;
  setConfig: (courseId: string, config: ReviewConfig) => void;
  setWeights: (courseId: string, weights: Weights) => void;
  clearConfigOverride: (courseId: string) => void;
  /** A course's exams (the exams table): add one, rename it, move it, change its topics, or remove it. */
  addExam: (courseId: string, title: string, date: string, topicIds: string[]) => void;
  updateExam: (id: string, change: { title?: string; date?: string; topicIds?: string[] }) => void;
  removeExam: (id: string) => void;
  /** Thumbs up or down on a question (a later one replaces it); null clears it. */
  rateQuestion: (courseId: string, questionId: string, rating: QuestionRating["rating"] | null, reason?: FeedbackReason | null) => void;
  clearWeightOverride: (courseId: string) => void;
  /** Account defaults, inherited by courses without an override. */
  setDefaults: (config: ReviewConfig, weights: Weights) => void;
  /**
   * Add a material to its course (and its due date to the calendar). `saved`: the server already
   * recorded it (an uploaded file, `src/lib/uploads.ts`); otherwise it's saved here as a record
   * without a file. The caller picks its id.
   */
  addMaterial: (m: Material, opts?: { saved?: boolean }) => void;
  recordQuiz: (r: Omit<QuizResult, "finishedAt">) => void;
  /** Append one graded answer. The only way learner state changes. Not counted if it can't be saved. */
  recordEvidence: (e: Omit<AnswerEvent, "id" | "at" | "kind">) => void;
  /** A homework reflection: one confusion event per objective the student confirmed, and the note kept on the material. */
  recordReflection: (materialId: string, note: string, events: Array<Omit<ConfusionEvent, "id" | "at" | "kind" | "materialId" | "note">>) => void;
  setOnboarded: (v: boolean) => void;
  /** The student's display name (profile), independent of the sign-in email. */
  setName: (name: string) => void;
  setTimezone: (timezone: string) => void;
  setAvatar: (avatar: AvatarId) => void;
  setLlm: (c: LlmConfig | null) => void;
  /**
   * Read everything again from the database, after the saves already queued (a job finished on the
   * server: its topics, objectives, questions and run are there now). Resolves when it landed.
   */
  refresh: () => Promise<void>;
  /** Resolves when every save queued so far has finished (or failed). */
  afterSaves: () => Promise<void>;
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
    /** "Couldn't save: …" for the last save that failed (the state was then read again from the database). */
    saveError: string | null;
  };

const OrcaContext = createContext<OrcaContextValue | null>(null);

const VARIANT_CYCLE: IslandVariant[] = ["ald", "circuit", "signals", "linear", "stats"];

/* ── Talking to Supabase ──────────────────────────────────────────────── */

/** An update's result (with `.select("id")`): it must have changed a row, or the save didn't happen. */
function mustChange(result: { data: unknown[] | null; error: { message: string } | null }): void {
  if (result.error) throw new Error(result.error.message);
  if (!result.data?.length) throw new Error("nothing was changed (it may be gone, or not yours)");
}

/** A Supabase result's data, or a thrown Error with its message. */
function must<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

/** The server already holds this event (409 with `duplicate`): the save it belongs to is done. */
class DuplicateEventError extends Error {}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const out = (await res.json().catch(() => null)) as (T & { error?: string; duplicate?: boolean }) | null;
  if (res.status === 409 && out?.duplicate) throw new DuplicateEventError(out.error);
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

/** Everything the signed-in student has, with fresh snapshots for every course. */
async function loadAll(): Promise<Omit<OrcaState, "llm">> {
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
  return { ...rest, defaultConfig: loaded.defaultConfig ?? DEFAULT_CONFIG, defaultWeights: loaded.defaultWeights ?? DEFAULT_WEIGHTS, snapshots };
}

async function sessionUser(): Promise<string | null> {
  const { data, error } = await browserSupabase().auth.getSession();
  if (error) throw new Error(error.message);
  return data.session?.user.id ?? null;
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
  /** Moves on when a save fails (and again when the resync after it lands); saves from an older epoch are cancelled. */
  const epoch = useRef(0);
  /** True while the state is being read again after a failed save; actions meanwhile are refused (below). */
  const resyncing = useRef(false);
  /** Quiz sessions with an answer that couldn't be saved: their score is never saved as a finished session. */
  const failedSessions = useRef(new Set<string>());
  const pathname = usePathname();

  // Old local state is gone for good (accounts start fresh).
  useEffect(() => {
    try {
      for (const key of LEGACY_KEYS) window.localStorage.removeItem(key);
    } catch {
      /* storage may be unavailable */
    }
  }, []);

  const load = useCallback(async (force = false) => {
    let userId: string | null;
    try {
      userId = await sessionUser();
    } catch (e) {
      loadedFor.current = undefined;
      setState(initialState);
      setLoadError(`Couldn't load your courses: ${message(e)}`);
      setStatus("failed");
      return;
    }
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
      setState((s) => ({ ...initialState, ...loaded, llm: s.llm }));
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

  const count = useCallback((delta: number) => {
    inFlight.current += delta;
    document.documentElement.dataset.saving = String(inFlight.current);
    setSaving(inFlight.current);
  }, []);

  /**
   * Put the screen back in step with the database after a failed save: read everything again and
   * replace the local state (an answer that wasn't saved disappears, so it isn't counted). Runs in
   * the queue, after the saves it cancelled. Everything done on screen before it finishes is
   * replaced by what it read, so those actions' saves are cancelled too (the epoch moves on again).
   */
  const resync = useCallback(async () => {
    resyncing.current = true;
    try {
      const loaded = await loadAll();
      setState((s) => ({ ...initialState, ...loaded, llm: s.llm }));
    } catch (e) {
      loadedFor.current = undefined;
      setState(initialState);
      setLoadError(`Couldn't load your courses after a failed save: ${message(e)}`);
      setStatus("failed");
    } finally {
      epoch.current += 1;
      resyncing.current = false;
    }
  }, []);

  /**
   * Run a save after the ones before it. Nothing is retried and nothing is undone by hand: if it
   * throws, the error is shown, every save queued behind it is cancelled (they may build on it),
   * and the state is read again from the database, so the screen matches what was saved.
   */
  const save = useCallback(
    (run: () => Promise<void>, opts: { onFail?: () => void } = {}) => {
      if (resyncing.current) {
        // The screen is about to be replaced by what the database holds; a change made now would be
        // lost with no trace, so it's refused with its own message instead (its optimistic update goes
        // with the reload).
        opts.onFail?.();
        setSaveError("Orca is reloading your data after a save that failed; that change wasn't saved. Try it again in a moment.");
        return;
      }
      const mine = epoch.current;
      count(1);
      queue.current = queue.current.then(async () => {
        try {
          if (mine !== epoch.current) return; // cancelled by an earlier failure
          try {
            await run();
          } catch (e) {
            opts.onFail?.();
            epoch.current += 1;
            setSaveError(`Couldn't save: ${message(e)}${inFlight.current > 1 ? " (changes made after it weren't saved either)" : ""}`);
            count(1);
            queue.current = queue.current.then(resync).finally(() => count(-1));
          }
        } finally {
          count(-1);
        }
      });
    },
    [count, resync],
  );

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

  /** Save a course's structure change (the rows that changed), then fresh snapshots. */
  const saveStructure = useCallback(
    (courseId: string, before: StructureState, after: StructureState) => {
      const rows = structureRows(before, after);
      if (isEmpty(rows)) return;
      save(
        async () => {
          must(await browserSupabase().rpc("save_structure", { course: courseId, rows: rows as unknown as Json }));
          await refreshAfterSave([courseId]);
        },
      );
    },
    [save, refreshAfterSave],
  );

  const addCourse = useCallback<OrcaActions["addCourse"]>(
    (name) => {
      const s = stateRef.current;
      const n = s.courses.length;
      const newId = crypto.randomUUID();
      const course: Course = {
        id: newId,
        slug: freeSlug(name, s.courses.map((c) => c.slug)),
        name,
        short: shortName(name),
        variant: VARIANT_CYCLE[n % VARIANT_CYCLE.length],
        // Its spot on the courses map (the map places islands from the course ids; this records the same spot).
        pos: placeIslands([...s.courses.map((c) => c.id), newId])[n],
        topics: [],
      };
      const id = course.id;
      setState((s) => ({
        ...s,
        courses: [...s.courses, course],
        configs: { ...s.configs, [id]: s.defaultConfig },
        weights: { ...s.weights, [id]: s.defaultWeights },
        configOverrides: { ...s.configOverrides, [id]: null },
        weightOverrides: { ...s.weightOverrides, [id]: null },
        objectives: { ...s.objectives, [id]: {} },
        relations: { ...s.relations, [id]: [] },
        snapshots: { ...s.snapshots, [id]: {} },
      }));
      save(
        async () => void must(await browserSupabase().from("courses").insert(courseToRow(course, null, null))),
      );
      return course;
    },
    [save],
  );

  const renameCourse = useCallback<OrcaActions["renameCourse"]>(
    (courseId, name) => {
      const clean = name.trim();
      if (!clean) throw new Error("A course needs a name");
      const course = stateRef.current.courses.find((c) => c.id === courseId);
      if (!course) throw new Error(`No course ${courseId}`);
      if (course.name === clean) return;
      setState((s) => ({ ...s, courses: s.courses.map((c) => (c.id === courseId ? { ...c, name: clean } : c)) }));
      save(
        async () => {
          mustChange(await browserSupabase().from("courses").update({ name: clean }).eq("id", courseId).select("id"));
        },
      );
    },
    [save],
  );

  const setConfig = useCallback<OrcaActions["setConfig"]>(
    (courseId, config) => {
      setState((s) => ({ ...s, configs: { ...s.configs, [courseId]: config }, configOverrides: { ...s.configOverrides, [courseId]: config } }));
      const course = stateRef.current.courses.find((c) => c.id === courseId);
      if (!course) throw new Error(`No course ${courseId}`);
      save(
        async () => {
          mustChange(await browserSupabase().from("courses").update({ review_config: config as unknown as Json }).eq("id", courseId).select("id"));
        },
      );
    },
    [save],
  );

  const setWeights = useCallback<OrcaActions["setWeights"]>(
    (courseId, weights) => {
      setState((s) => ({ ...s, weights: { ...s.weights, [courseId]: weights }, weightOverrides: { ...s.weightOverrides, [courseId]: weights } }));
      const course = stateRef.current.courses.find((c) => c.id === courseId);
      if (!course) throw new Error(`No course ${courseId}`);
      save(
        async () => {
          mustChange(await browserSupabase().from("courses").update({ weights }).eq("id", courseId).select("id"));
        },
      );
    },
    [save],
  );

  const clearConfigOverride = useCallback<OrcaActions["clearConfigOverride"]>(
    (courseId) => {
      const fallback = stateRef.current.defaultConfig;
      setState((s) => ({ ...s, configs: { ...s.configs, [courseId]: fallback }, configOverrides: { ...s.configOverrides, [courseId]: null } }));
      save(async () => mustChange(await browserSupabase().from("courses").update({ review_config: null }).eq("id", courseId).select("id")));
    },
    [save],
  );

  const clearWeightOverride = useCallback<OrcaActions["clearWeightOverride"]>(
    (courseId) => {
      const fallback = stateRef.current.defaultWeights;
      setState((s) => ({ ...s, weights: { ...s.weights, [courseId]: fallback }, weightOverrides: { ...s.weightOverrides, [courseId]: null } }));
      save(async () => mustChange(await browserSupabase().from("courses").update({ weights: null }).eq("id", courseId).select("id")));
    },
    [save],
  );

  const addExam = useCallback<OrcaActions["addExam"]>(
    (courseId, title, date, topicIds) => {
      const exam: Exam = { id: crypto.randomUUID(), courseId, title, date, topicIds };
      setState((s) => ({ ...s, exams: [...s.exams, exam] }));
      save(async () => void must(await browserSupabase().from("exams").insert(examToRow(exam))));
    },
    [save],
  );

  const updateExam = useCallback<OrcaActions["updateExam"]>(
    (id, change) => {
      setState((s) => ({ ...s, exams: s.exams.map((e) => (e.id === id ? { ...e, ...change } : e)) }));
      const row = { ...(change.title !== undefined ? { title: change.title } : {}), ...(change.date !== undefined ? { date: change.date } : {}), ...(change.topicIds !== undefined ? { topic_ids: change.topicIds } : {}) };
      save(async () => mustChange(await browserSupabase().from("exams").update(row).eq("id", id).select("id")));
    },
    [save],
  );

  const rateQuestion = useCallback<OrcaActions["rateQuestion"]>(
    (courseId, questionId, rating, reason = null) => {
      setState((s) => {
        const feedback = { ...s.feedback };
        if (rating) feedback[questionId] = { courseId, rating, reason: rating === "down" ? reason : null };
        else delete feedback[questionId];
        return { ...s, feedback };
      });
      save(async () => {
        const db = browserSupabase();
        if (!rating) return void must(await db.from("question_feedback").delete().eq("question_id", questionId));
        must(
          await db
            .from("question_feedback")
            .upsert({ question_id: questionId, course_id: courseId, rating, reason: rating === "down" ? reason : null, updated_at: new Date().toISOString() }, { onConflict: "owner_id,question_id" }),
        );
      });
    },
    [save],
  );

  const removeExam = useCallback<OrcaActions["removeExam"]>(
    (id) => {
      setState((s) => ({ ...s, exams: s.exams.filter((e) => e.id !== id) }));
      save(async () => mustChange(await browserSupabase().from("exams").delete().eq("id", id).select("id")));
    },
    [save],
  );

  const addMaterial = useCallback<OrcaActions["addMaterial"]>(
    (m, opts) => {
      const event: CalendarEvent | null = m.due
        ? {
            id: crypto.randomUUID(),
            date: m.due,
            kind: m.type === "Homework" ? "hw" : m.type === "Past exam" || m.type === "Practice exam" ? "exam" : "rev",
            title: m.filename.replace(/\.[a-z0-9]+$/i, ""),
            courseId: m.courseId,
          }
        : null;
      setState((s) => ({ ...s, materials: [...s.materials, m], events: event ? [...s.events, event] : s.events }));
      save(
        async () => {
          const db = browserSupabase();
          if (!opts?.saved) must(await db.from("materials").insert(materialInsertRow(m)));
          if (event) must(await db.from("calendar_events").insert(calendarToRow(event, m.id)));
        },
      );
    },
    [save],
  );

  const recordQuiz = useCallback<OrcaActions["recordQuiz"]>(
    (r) => {
      const local: QuizResult = { ...r, finishedAt: new Date().toISOString() };
      const drop = () => setState((s) => ({ ...s, results: s.results.filter((x) => x !== local) }));
      setState((s) => ({ ...s, results: [...s.results, local] }));
      save(
        async () => {
          // Runs after the session's answer saves (the queue is in order). If one of them failed,
          // the score would count answers that aren't in the record: it isn't saved, and says so.
          if (failedSessions.current.has(r.sessionId)) {
            failedSessions.current.delete(r.sessionId);
            throw new Error("some answers in this quiz couldn't be saved, so its score wasn't recorded");
          }
          const { data: row, error } = await browserSupabase().from("session_results").insert(sessionToRow(r)).select().single();
          if (error) throw new Error(error.message);
          // The database stamps when it finished, on the same clock as the answers.
          const stored = sessionFromRow(row);
          setState((s) => ({ ...s, results: s.results.map((x) => (x === local ? stored : x)) }));
        },
        { onFail: drop },
      );
    },
    [save],
  );

  /** Post one evidence event; on success the server's copy (its time, topic and objective) replaces the local one and its snapshot is kept. */
  const postEvidence = useCallback(async (local: EvidenceEvent, body: object) => {
    let out: Recorded;
    try {
      out = await postJson<Recorded>("/api/evidence", body);
    } catch (e) {
      // The same event again (a retried reflection sends the same ids): it's recorded; nothing to do.
      if (e instanceof DuplicateEventError) return;
      throw e;
    }
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
        { onFail: () => failedSessions.current.add(e.sessionId) },
      );
    },
    [save, postEvidence],
  );

  const recordReflection = useCallback<OrcaActions["recordReflection"]>(
    (materialId, note, events) => {
      const at = new Date().toISOString();
      // One id per (material, objective): a retry after a half-failed save sends the same ids, and the
      // server refuses the ones already recorded instead of recording the confusion twice.
      const confusion: ConfusionEvent[] = events.map((e) => ({ ...e, kind: "confusion", id: confusionEventId(materialId, e.objectiveId), at, materialId, note }));
      const reflection = { at, note, objectiveIds: events.map((e) => e.objectiveId) };
      setState((s) => ({
        ...s,
        evidence: [...s.evidence, ...confusion],
        materials: s.materials.map((m) => (m.id === materialId ? { ...m, reflection } : m)),
      }));
      save(
        async () => {
          for (const c of confusion) {
            await postEvidence(c, { kind: "confusion", id: c.id, courseId: c.courseId, objectiveId: c.objectiveId, materialId, note });
          }
          mustChange(await browserSupabase().from("materials").update({ reflection: reflection as unknown as Json }).eq("id", materialId).select("id"));
        },
      );
    },
    [save, postEvidence],
  );

  const setOnboarded = useCallback(
    (v: boolean) => {
      setState((s) => ({ ...s, onboarded: v }));
      save(
        async () => {
          const { data } = await browserSupabase().auth.getSession();
          if (!data.session) throw new Error("you're signed out");
          mustChange(await browserSupabase().from("profiles").update({ onboarded: v }).eq("owner_id", data.session.user.id).select("owner_id"));
        },
      );
    },
    [save],
  );

  const setName = useCallback<OrcaActions["setName"]>(
    (name) => {
      const clean = name.trim();
      if (!clean) throw new Error("A username is required.");
      setState((s) => ({ ...s, name: clean }));
      save(async () => {
        const { data } = await browserSupabase().auth.getSession();
        if (!data.session) throw new Error("you're signed out");
        mustChange(await browserSupabase().from("profiles").update({ name: clean }).eq("owner_id", data.session.user.id).select("owner_id"));
      });
    },
    [save],
  );

  const setTimezone = useCallback(
    (timezone: string) => {
      setState((s) => ({ ...s, timezone }));
      save(
        async () => {
          const { data } = await browserSupabase().auth.getSession();
          if (!data.session) throw new Error("you're signed out");
          mustChange(await browserSupabase().from("profiles").update({ timezone }).eq("owner_id", data.session.user.id).select("owner_id"));
          // A new timezone can move answers to other days: every snapshot is rebuilt.
          await refreshAfterSave(stateRef.current.courses.map((c) => c.id));
        },
      );
    },
    [save, refreshAfterSave],
  );

  const setDefaults = useCallback<OrcaActions["setDefaults"]>(
    (config, weights) => {
      setState((s) => {
        const configs = { ...s.configs };
        const courseWeights = { ...s.weights };
        for (const c of s.courses) {
          if (s.configOverrides[c.id] === null) configs[c.id] = config;
          if (s.weightOverrides[c.id] === null) courseWeights[c.id] = weights;
        }
        return { ...s, defaultConfig: config, defaultWeights: weights, configs, weights: courseWeights };
      });
      save(async () => {
        const { data } = await browserSupabase().auth.getSession();
        if (!data.session) throw new Error("you're signed out");
        mustChange(await browserSupabase().from("profiles").update(defaultsToRow(config, weights)).eq("owner_id", data.session.user.id).select("owner_id"));
      });
    },
    [save],
  );

  const setAvatar = useCallback(
    (avatar: AvatarId) => {
      setState((s) => ({ ...s, avatar }));
      save(async () => {
        const { data } = await browserSupabase().auth.getSession();
        if (!data.session) throw new Error("you're signed out");
        mustChange(await browserSupabase().from("profiles").update({ avatar }).eq("owner_id", data.session.user.id).select("owner_id"));
      });
    },
    [save],
  );

  const refresh = useCallback<OrcaActions["refresh"]>(() => {
    const next = queue.current.then(async () => {
      try {
        const loaded = await loadAll();
        setState((s) => ({ ...initialState, ...loaded, llm: s.llm }));
      } catch (e) {
        setSaveError(`Couldn't load the latest changes: ${message(e)}. Reload the page to see them.`);
      }
    });
    queue.current = next;
    return next;
  }, []);

  const afterSaves = useCallback<OrcaActions["afterSaves"]>(() => queue.current, []);

  const editStructure = useCallback<OrcaActions["editStructure"]>(
    (courseId, op) => {
      const before = structureOf(stateRef.current, courseId);
      const next = op({ topics: before.topics, objectives: before.objectives, bank: before.bank });
      const after: StructureState = { topics: laidOut(next.topics), objectives: next.objectives, bank: next.bank, relations: before.relations };
      setState((s) => withStructure(s, courseId, after));
      saveStructure(courseId, before, after);
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
      renameCourse,
      setConfig,
      setWeights,
      clearConfigOverride,
      clearWeightOverride,
      addExam,
      updateExam,
      removeExam,
      rateQuestion,
      setDefaults,
      addMaterial,
      recordQuiz,
      recordEvidence,
      recordReflection,
      setOnboarded,
      setName,
      setTimezone,
      setAvatar,
      setLlm,
      refresh,
      afterSaves,
      editStructure,
      dismissSaveError,
      reload,
    }),
    [state, hydrated, status, loadError, saving, saveError, addCourse, renameCourse, setConfig, setWeights, clearConfigOverride, clearWeightOverride, addExam, updateExam, removeExam, rateQuestion, setDefaults, addMaterial, recordQuiz, recordEvidence, recordReflection, setOnboarded, setName, setTimezone, setAvatar, setLlm, refresh, afterSaves, editStructure, dismissSaveError, reload],
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
  const { courses, objectives, relations, weights, configs, results, events, exams } = useOrca();
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
          const computed = courseObjectiveWeights(objectives[c.id] ?? {}, c.topics, relations[c.id] ?? [], sliders);
          const agenda = courseAgenda({
            courseId: c.id,
            mastery: m,
            weights: withNeutralWeights(m.objectives.keys(), computed, isUnsortedObjectiveId),
            config: configs[c.id] ?? DEFAULT_CONFIG,
            results,
            // Exams, and any uploaded exam's due date on the calendar.
            examDays: [...exams.filter((e) => e.courseId === c.id).map((e) => e.date), ...events.filter((e) => e.kind === "exam" && e.courseId === c.id).map((e) => e.date)],
            now: new Date(nowMs),
            dayKey,
          });
          return [c.id, agenda];
        }),
      ),
    [courses, objectives, relations, weights, configs, results, events, exams, mastery, nowMs, dayKey],
  );
}
