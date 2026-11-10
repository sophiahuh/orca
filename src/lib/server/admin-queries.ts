/**
 * What the admin view reads (2026-11-10), one function per page, every one with the service-role
 * client after the gate (`src/lib/server/admin.ts`). The figures are summed in the database by the
 * `admin_*` functions of migration 20261110120000 (service role only); the per-user lists that are
 * small enough come straight from their tables. Evidence and feedback are read a page at a time.
 * Days are UTC, as the cost log counts them (docs/COST-LOG.md).
 */
import { type DayRow, type UserRow, type UserSort, fillDays, sortUsers } from "@/lib/admin/stats";
import { LIMITS, type RateAction } from "@/lib/limits";
import type { OrcaSupabase } from "@/lib/supabase/server";

/* ── Shapes ── */

export interface Overview {
  users: number;
  courses: number;
  uploads: number;
  spendToday: number;
  spend7d: number;
  spendAll: number;
  answersToday: number;
  openRuns: number;
  pausedRuns: number;
}

export interface UserCourse {
  id: string;
  name: string;
  slug: string;
  created: string;
  deleted: string | null;
  topics: number;
  objectives: number;
  questions: number;
}

export interface UserUpload {
  id: string;
  course: string;
  filename: string;
  type: string;
  status: string;
  created: string;
  pages: number;
  /** The latest upload run, or null when the file never had one. */
  run: { id: string; status: string; at: string; error: string | null; cost: number } | null;
}

export interface SpendGroup {
  calls: number;
  usd: number;
  tokens: number;
}

export interface Spend {
  /** The last `days` UTC days, newest first, every day present. */
  byDay: DayRow[];
  byKind: Array<SpendGroup & { kind: string }>;
  byModel: Array<SpendGroup & { model: string }>;
  days: number;
}

export interface EvidenceRow {
  id: string;
  at: string;
  kind: string;
  course: string | null;
  objective: string | null;
  outcome: string | null;
  grader: string | null;
  source: string | null;
  tier: string | null;
  /** An answer through the connector: the student's words; a flag: its note. */
  note: string | null;
  flag_source: string | null;
  page: number | null;
  question_id: string | null;
}

export interface FeedbackRow {
  created_at: string;
  rating: string;
  reason: string | null;
  note: string | null;
  question_id: string;
  owner_id: string;
  prompt: string;
  kind: string;
  tier: string | null;
  deep: boolean;
  objective: string | null;
  course: string | null;
  student: string | null;
}

export interface FeedbackCount {
  course_id: string;
  course: string;
  student: string | null;
  ups: number;
  downs: number;
}

export interface SessionRow {
  id: string;
  course: string | null;
  mode: string;
  correct: number;
  total: number;
  seconds: number;
  finishedAt: string;
}

export interface SecurityRow {
  id: string;
  at: string;
  kind: string;
  check: string;
  severity: string;
  quote: string;
  run_id: string | null;
  material_id: string | null;
  question_id: string | null;
}

export interface RateRow {
  action: string;
  windowStart: string;
  count: number;
  /** The action's limit, or null when `LIMITS.rate` has no such action any more. */
  max: number | null;
  over: boolean;
}

export interface Page<T> {
  rows: T[];
  offset: number;
  limit: number;
  /** Whether a full page came back, so there may be more. */
  more: boolean;
}

export interface UserDetail {
  profile: { id: string; name: string | null; email: string | null; joined: string; lastActive: string | null; timezone: string; isAdmin: boolean };
  courses: UserCourse[];
  uploads: UserUpload[];
  spend: Spend;
  sessions: SessionRow[];
  evidence: Page<EvidenceRow>;
  feedback: FeedbackRow[];
  security: SecurityRow[];
  rateLimits: RateRow[];
}

export const EVIDENCE_PAGE = 200;
export const FEEDBACK_PAGE = 100;
export const SPEND_DAYS = 30;
export const FEEDBACK_REASONS = ["wrong-answer", "unclear", "too-easy", "too-hard", "not-my-course", "not-relevant"] as const;

/* ── Reading ── */

async function call<T>(db: OrcaSupabase, fn: "admin_overview" | "admin_users" | "admin_user_courses" | "admin_user_uploads" | "admin_spend" | "admin_user_evidence" | "admin_feedback" | "admin_feedback_counts", args: Record<string, unknown>, what: string): Promise<T> {
  // The functions' argument shapes are in database.types.ts; each caller below passes what its function takes.
  const { data, error } = await db.rpc(fn, args as never);
  if (error) throw new Error(`Couldn't read ${what}: ${error.message}`);
  if (data === null || data === undefined) throw new Error(`Couldn't read ${what}: the database answered nothing`);
  return data as unknown as T;
}

function list<T>(data: unknown, what: string): T[] {
  if (!Array.isArray(data)) throw new Error(`Couldn't read ${what}: expected a list`);
  return data as T[];
}

const num = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" ? Number(v) : 0);

export async function overview(db: OrcaSupabase): Promise<Overview> {
  const o = await call<Record<string, unknown>>(db, "admin_overview", {}, "the overview");
  return {
    users: num(o.users),
    courses: num(o.courses),
    uploads: num(o.uploads),
    spendToday: num(o.spend_today),
    spend7d: num(o.spend_7d),
    spendAll: num(o.spend_all),
    answersToday: num(o.answers_today),
    openRuns: num(o.open_runs),
    pausedRuns: num(o.paused_runs),
  };
}

export async function users(db: OrcaSupabase, sort: UserSort = "joined"): Promise<UserRow[]> {
  const raw = list<Record<string, unknown>>(await call(db, "admin_users", {}, "the users"), "the users");
  return sortUsers(
    raw.map((u) => ({
      id: String(u.id),
      name: (u.name as string | null) ?? null,
      email: (u.email as string | null) ?? null,
      joined: String(u.joined),
      lastActive: (u.last_active as string | null) ?? null,
      isAdmin: u.is_admin === true,
      courses: num(u.courses),
      uploads: num(u.uploads),
      pages: num(u.pages),
      answers: num(u.answers),
      thumbsDown: num(u.thumbs_down),
      spend: num(u.spend),
      connector: u.connector === true,
      canvas: u.canvas === true,
    })),
    sort,
  );
}

export async function spend(db: OrcaSupabase, opts: { owner?: string; days?: number; today?: Date } = {}): Promise<Spend> {
  const days = Math.min(Math.max(opts.days ?? SPEND_DAYS, 1), 366);
  const s = await call<{ by_day: unknown; by_kind: unknown; by_model: unknown }>(db, "admin_spend", { owner: opts.owner ?? null, days }, "the spend");
  const group = (g: Record<string, unknown>) => ({ calls: num(g.calls), usd: num(g.usd), tokens: num(g.tokens) });
  return {
    days,
    byDay: fillDays(
      list<Record<string, unknown>>(s.by_day, "spend by day").map((d) => ({ day: String(d.day), ...group(d) })),
      days,
      opts.today ?? new Date(),
    ),
    byKind: list<Record<string, unknown>>(s.by_kind, "spend by kind").map((k) => ({ kind: String(k.kind), ...group(k) })),
    byModel: list<Record<string, unknown>>(s.by_model, "spend by model").map((m) => ({ model: String(m.model), ...group(m) })),
  };
}

export async function feedback(db: OrcaSupabase, opts: { owner?: string; reason?: string; downOnly?: boolean; offset?: number; limit?: number } = {}): Promise<Page<FeedbackRow>> {
  const limit = Math.min(Math.max(opts.limit ?? FEEDBACK_PAGE, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);
  const rows = list<FeedbackRow>(
    await call(db, "admin_feedback", { owner: opts.owner ?? null, reason: opts.reason ?? null, down_only: opts.downOnly ?? true, lim: limit, off: offset }, "the question feedback"),
    "the question feedback",
  );
  return { rows, offset, limit, more: rows.length === limit };
}

export async function feedbackCounts(db: OrcaSupabase): Promise<FeedbackCount[]> {
  return list<Record<string, unknown>>(await call(db, "admin_feedback_counts", {}, "the feedback counts"), "the feedback counts").map((c) => ({
    course_id: String(c.course_id),
    course: String(c.course),
    student: (c.student as string | null) ?? null,
    ups: num(c.ups),
    downs: num(c.downs),
  }));
}

/** One student's evidence, newest first, `EVIDENCE_PAGE` at a time. */
export async function evidence(db: OrcaSupabase, owner: string, offset = 0, limit = EVIDENCE_PAGE): Promise<Page<EvidenceRow>> {
  const lim = Math.min(Math.max(limit, 1), 500);
  const off = Math.max(offset, 0);
  const rows = list<EvidenceRow>(await call(db, "admin_user_evidence", { uid: owner, lim, off }, "the evidence"), "the evidence");
  return { rows, offset: off, limit: lim, more: rows.length === lim };
}

/** Everything the user page shows, or null when no such profile exists. */
export async function userDetail(db: OrcaSupabase, id: string, opts: { evidenceOffset?: number; today?: Date } = {}): Promise<UserDetail | null> {
  const { data: profile, error } = await db.from("profiles").select("owner_id, name, created_at, last_active_at, timezone, is_admin").eq("owner_id", id).maybeSingle();
  if (error) throw new Error(`Couldn't read the profile: ${error.message}`);
  if (!profile) return null;
  const [account, courses, uploads, spent, sessions, ev, fb, security, rate] = await Promise.all([
    db.auth.admin.getUserById(id),
    call(db, "admin_user_courses", { uid: id }, "the user's courses").then((d) => list<Record<string, unknown>>(d, "the user's courses")),
    call(db, "admin_user_uploads", { uid: id }, "the user's uploads").then((d) => list<Record<string, unknown>>(d, "the user's uploads")),
    spend(db, { owner: id, today: opts.today }),
    db.from("session_results").select("id, course_id, mode, correct, total, seconds, finished_at").eq("owner_id", id).order("finished_at", { ascending: false }).limit(200),
    evidence(db, id, opts.evidenceOffset ?? 0),
    feedback(db, { owner: id, downOnly: false, limit: 200 }),
    db.from("security_events").select("id, at, kind, check, severity, quote, run_id, material_id, question_id").eq("owner_id", id).order("at", { ascending: false }).limit(200),
    db.from("rate_limits").select("action, window_start, count").eq("owner_id", id).order("window_start", { ascending: false }),
  ]);
  if (account.error) throw new Error(`Couldn't read the account: ${account.error.message}`);
  if (sessions.error) throw new Error(`Couldn't read the sessions: ${sessions.error.message}`);
  if (security.error) throw new Error(`Couldn't read the security events: ${security.error.message}`);
  if (rate.error) throw new Error(`Couldn't read the rate limits: ${rate.error.message}`);

  const courseList: UserCourse[] = courses.map((c) => ({
    id: String(c.id),
    name: String(c.name),
    slug: String(c.slug),
    created: String(c.created),
    deleted: (c.deleted as string | null) ?? null,
    topics: num(c.topics),
    objectives: num(c.objectives),
    questions: num(c.questions),
  }));
  const courseName = new Map(courseList.map((c) => [c.id, c.name]));
  const limits = LIMITS.rate as Record<string, { max: number; windowSeconds: number }>;

  return {
    profile: {
      id,
      name: profile.name,
      email: account.data.user?.email ?? null,
      joined: profile.created_at,
      lastActive: profile.last_active_at,
      timezone: profile.timezone,
      isAdmin: profile.is_admin,
    },
    courses: courseList,
    uploads: uploads.map((u) => {
      const run = u.run as Record<string, unknown> | null;
      return {
        id: String(u.id),
        course: String(u.course),
        filename: String(u.filename),
        type: String(u.type),
        status: String(u.status),
        created: String(u.created),
        pages: num(u.pages),
        run: run ? { id: String(run.id), status: String(run.status), at: String(run.at), error: (run.error as string | null) ?? null, cost: num(run.cost) } : null,
      };
    }),
    spend: spent,
    sessions: sessions.data.map((s) => ({ id: s.id, course: courseName.get(s.course_id) ?? null, mode: s.mode, correct: s.correct, total: s.total, seconds: s.seconds, finishedAt: s.finished_at })),
    evidence: ev,
    feedback: fb.rows,
    security: security.data,
    rateLimits: rate.data.map((r) => {
      const limit = limits[r.action as RateAction];
      return { action: r.action, windowStart: r.window_start, count: r.count, max: limit?.max ?? null, over: limit ? r.count > limit.max : false };
    }),
  };
}
