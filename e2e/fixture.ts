import { createServerClient } from "@supabase/ssr";
import { fakeModel } from "./fake-model";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { test as base, expect } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import {
  type CalendarEvent,
  type Course,
  type Material,
  type MaterialPages,
  type Objective,
  type PipelineRun,
  type QuizQuestion,
  type QuizResult,
  type Relation,
  type CourseSchedule,
  type ReviewConfig,
  type Topic,
  DEFAULT_CONFIG,
  defaultTopicPositions,
} from "../src/lib/data";
import type { EvidenceEvent } from "../src/lib/mastery/types";
import { type LoadedState, type MyData, calendarToRow, courseToRow, loadedState, materialToRow, sessionToRow, structureRows } from "../src/lib/supabase/app-rows";
import { eventToRow } from "../src/lib/supabase/rows";

/**
 * Every test runs as a signed-in student: the app sends signed-out visitors to sign-in. Before
 * each test a throwaway, already-confirmed account is created with the secret key (its timezone is
 * this machine's, as the browser's is), signed in over the real API, and its session cookies are
 * put in the browser; the account and everything it owns are deleted after.
 *
 * The app's data lives in Supabase: `seedState` writes a test's starting data with the secret key
 * (the way an upload would have left it), and `stored` reads back what the app saved, through the
 * student's own session. `page.goto` first waits for the app's saves to land (navigating away
 * would cancel one), as a student would see "Saving…" go away.
 * Specs import `test` and `expect` from here. The auth spec uses Playwright's own `test` instead.
 */
export interface Student {
  id: string;
  email: string;
  password: string;
  /** A client signed in as this student (row-level security applies). */
  db: SupabaseClient;
}

const env = () => ({ url: process.env.NEXT_PUBLIC_SUPABASE_URL!, publishable: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, secret: process.env.SUPABASE_SECRET_KEY! });
const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
export const admin = () => createClient(env().url, env().secret, noSession);
const TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Sign a browser context in as the student: their session cookies, as the app's sign-in would set them. */
export async function signIn(context: BrowserContext, email: string, password: string, baseURL: string) {
  const jar: { name: string; value: string }[] = [];
  const client = createServerClient(env().url, env().publishable, { cookies: { getAll: () => jar, setAll: (list) => list.forEach(({ name, value }) => jar.push({ name, value })) } });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw new Error(`Couldn't sign the test student in: ${signedIn.error.message}`);
  await context.addCookies(jar.map(({ name, value }) => ({ name, value, url: baseURL })));
}

/** Wait until the app has no save in flight, and fail with its message if one failed. */
export async function settled(page: Page) {
  await page.waitForFunction(() => (document.documentElement.dataset.saving ?? "0") === "0");
  const failed = page.locator('[data-part="save-error"]');
  if (await failed.count()) throw new Error(`The app couldn't save: ${await failed.first().textContent()}`);
}

export const test = base.extend<{ student: Student }>({
  student: [
    async ({ context, baseURL }, use) => {
      await fakeModel(); // the fake API's default answers; a test sets its own scenario after this
      const email = `e2e-${crypto.randomUUID()}@example.test`;
      const password = "e2e-password-1";
      const { data, error } = await admin().auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { timezone: TIMEZONE } });
      if (error || !data.user) throw new Error(`Couldn't create the test student: ${error?.message}`);
      await signIn(context, email, password, baseURL!);
      const db = createClient(env().url, env().publishable, noSession);
      const own = await db.auth.signInWithPassword({ email, password });
      if (own.error) throw new Error(`Couldn't sign the test student in: ${own.error.message}`);
      await use({ id: data.user.id, email, password, db });
      // Uploaded files aren't removed with the account; remove them first.
      const files = await admin().from("materials").select("storage_path").eq("owner_id", data.user.id).not("storage_path", "is", null);
      const paths = (files.data ?? []).map((f) => f.storage_path as string);
      if (paths.length) await admin().storage.from("materials").remove(paths);
      await admin().auth.admin.deleteUser(data.user.id);
    },
    { auto: true },
  ],
  page: async ({ page }, provide) => {
    const goto = page.goto.bind(page);
    page.goto = async (url, options) => {
      if (page.url() !== "about:blank") await settled(page);
      return goto(url, options);
    };
    await provide(page);
  },
});
export { expect };

/** Everything the student has, as the app loads it (after the app's saves have landed). */
export async function stored(page: Page, student: Student): Promise<LoadedState> {
  await settled(page);
  const { data, error } = await student.db.rpc("my_data");
  if (error) throw new Error(`Couldn't read the student's data: ${error.message}`);
  return loadedState(data as MyData);
}

/* ── Seeding ── */

/** A test's starting data, in the store's shapes. Ids must be UUIDs (fresh ones per test file, from `ids`). */
export interface SeedState {
  courses: Course[];
  configs?: Record<string, ReviewConfig>;
  schedules?: Record<string, CourseSchedule>;
  objectives?: Record<string, Record<string, Objective>>;
  questionBank?: Record<string, Record<string, QuizQuestion[]>>;
  relations?: Record<string, Relation[]>;
  runs?: PipelineRun[];
  materials?: Material[];
  events?: Array<CalendarEvent & { materialId?: string }>;
  results?: QuizResult[];
  evidence?: EvidenceEvent[];
}

const check = (what: string, r: { error: { message: string } | null }) => {
  if (r.error) throw new Error(`Couldn't seed ${what}: ${r.error.message}`);
};

/**
 * Write a test's starting data for the student with the secret key: courses, materials and
 * structure (through save_structure, as uploads save), then calendar entries, finished sessions
 * and evidence. Seeded evidence gets a stale snapshot placeholder per objective, so the app's
 * first read rebuilds it from the log (GET /api/state), the path a structure change takes too.
 */
export async function seedState(student: Student, s: SeedState) {
  const db = admin();
  const owner = { owner_id: student.id };
  for (const c of s.courses) check("a course", await db.from("courses").insert({ ...courseToRow(c, s.configs?.[c.id] ?? DEFAULT_CONFIG, s.schedules?.[c.id] ?? null), ...owner }));
  for (const m of s.materials ?? []) check("a material", await db.from("materials").insert({ ...materialToRow(m), ...owner }));
  for (const c of s.courses) {
    const after = { topics: c.topics, objectives: s.objectives?.[c.id] ?? {}, bank: s.questionBank?.[c.id] ?? {}, relations: s.relations?.[c.id] ?? [] };
    const rows = structureRows({ topics: [], objectives: {}, bank: {}, relations: [] }, after, (s.runs ?? []).filter((r) => r.courseId === c.id));
    check("a course's structure", await db.rpc("save_structure", { course: c.id, rows }));
  }
  for (const e of s.events ?? []) check("a calendar entry", await db.from("calendar_events").insert({ ...calendarToRow(e, e.materialId ?? null), ...owner }));
  for (const r of s.results ?? []) check("a finished session", await db.from("session_results").insert({ ...sessionToRow(r), finished_at: r.finishedAt, ...owner }));
  const evidence = s.evidence ?? [];
  if (evidence.length) {
    check("evidence", await db.from("evidence_events").insert(evidence.map((e) => ({ ...eventToRow(e), ...owner }))));
    const objectives = new Map(evidence.map((e) => [e.objectiveId, e.courseId]));
    const placeholders = [...objectives].map(([objective_id, course_id]) => ({ objective_id, course_id, stale: true, ...owner }));
    check("snapshot placeholders", await db.from("objective_state").upsert(placeholders, { onConflict: "objective_id", ignoreDuplicates: true }));
  }
}

/** Uploaded materials' pages, as the server leaves them after reading a file (`material_pages`). Seed the materials first. */
export async function seedPages(student: Student, pages: Record<string, MaterialPages>) {
  const rows = Object.entries(pages).flatMap(([material_id, list]) => list.map((p) => ({ owner_id: student.id, material_id, n: p.n, text: p.text })));
  check("material pages", await admin().from("material_pages").insert(rows));
}

/* ── The fixture course ── */

/** Fresh UUIDs for a test file's named rows, so specs can say `id.A` where they used to say "A". */
export function ids<K extends string>(...names: K[]): Record<K, string> {
  return Object.fromEntries(names.map((n) => [n, crypto.randomUUID()])) as Record<K, string>;
}

/** Lay seeded topics out the way the store does after an upload. */
export function laidOut<T extends { pos: Topic["pos"] }>(topics: T[]): T[] {
  const positions = defaultTopicPositions(topics.length);
  return topics.map((t, i) => ({ ...t, pos: positions[i] }));
}

/**
 * A tiny course as if a student had created it and uploaded one deck: two topics, three
 * objectives, exact-answer questions. Only the e2e suite uses it; the app ships no courses.
 */
export const COURSE_SLUG = "logic-e2e";
const DECK = "L01_Fixture.pdf";
export const F = ids("course", "material", "booleanAlgebra", "twosComplement", "simplify", "convert", "signExtend", "ba1", "ba2", "tc1", "tc2", "tc3", "tc4");

export const short = (id: string, topic: string, objectiveId: string, prompt: string, exact: string[]): QuizQuestion => ({
  id,
  kind: "Short answer",
  tier: "retrieval",
  topic,
  prompt,
  options: [],
  answer: -1,
  exact,
  explanation: "Fixture question.",
  anchor: { locator: "slide 1", excerpt: "fixture" },
  objectiveId,
});

/** An objective from the deck. Its `materialId` must be a material the seed includes (`fixtureMaterial`). */
export const objective = (id: string, topicId: string, name: string, extra: Partial<Objective> = {}): Objective => ({
  id,
  topicId,
  name,
  description: "",
 
  origin: "material",
  review: "confirmed",
  materialId: F.material,
  runId: null,
  signals: [],
  ...extra,
});

/** The deck the fixture's objectives came from, in `courseId`. */
export const fixtureMaterial = (courseId: string): Material => ({ id: F.material, courseId, filename: DECK, type: "Lecture", assigned: null, due: null, reflect: false });

export const FIXTURE_STATE = {
  courses: [
    {
      id: F.course,
      slug: COURSE_SLUG,
      name: "Logic Fixture",
      short: "LOG",
      variant: "circuit",
      pos: { x: 70, y: 110 },
      topics: laidOut([
        { id: F.booleanAlgebra, name: "Boolean Algebra", review: "confirmed", pos: { x: 0, y: 0 }, source: [{ materialId: F.material, from: 1, to: 5 }] },
        { id: F.twosComplement, name: "Two's Complement", review: "confirmed", pos: { x: 0, y: 0 }, source: [{ materialId: F.material, from: 6, to: 9 }] },
      ] satisfies Topic[]),
    },
  ] satisfies Course[],
  configs: { [F.course]: { quick: { duration: "10 min", cadence: "Daily" }, deep: { duration: "3 hours", cadence: "Weekly" }, exam: { duration: "10 hours", cadence: "1 wk before exam" } } } satisfies Record<string, ReviewConfig>,
  materials: [fixtureMaterial(F.course)],
  objectives: {
    [F.course]: {
      [F.simplify]: objective(F.simplify, F.booleanAlgebra, "Simplify an expression"),
      [F.convert]: objective(F.convert, F.twosComplement, "Convert to 2's complement"),
      [F.signExtend]: objective(F.signExtend, F.twosComplement, "Sign-extend a number"),
    },
  },
  questionBank: {
    [F.course]: {
      [F.booleanAlgebra]: [
        short(F.ba1, "Boolean Algebra", F.simplify, "Simplify x + xy.", ["x"]),
        short(F.ba2, "Boolean Algebra", F.simplify, "Simplify a + a'c.", ["a + c"]),
      ],
      [F.twosComplement]: [
        short(F.tc1, "Two's Complement", F.convert, "Write −6 as a 4-bit 2's complement number.", ["1010"]),
        short(F.tc2, "Two's Complement", F.convert, "What value is the 4-bit pattern 1011?", ["-5"]),
        short(F.tc3, "Two's Complement", F.convert, "Write −1 as a 4-bit 2's complement number.", ["1111"]),
        short(F.tc4, "Two's Complement", F.signExtend, "Sign-extend 1010 to 8 bits.", ["11111010"]),
      ],
    },
  },
} satisfies SeedState;

export async function seedFixtureCourse(student: Student) {
  await seedState(student, FIXTURE_STATE);
}

/** A time `days` days before now (the server stamps answers with its clock, so seeded history is relative to it). */
export const daysAgo = (days: number, from = Date.now()) => new Date(from - days * 86_400_000).toISOString();
