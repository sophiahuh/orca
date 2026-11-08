/**
 * Limits (Phase 4 plan, decision 10). Each is checked on the server before any work that costs
 * something; the browser may check them too, but only to say so sooner. The budgets and rate limits
 * live here so there is one place to read what Orca allows; the code that enforces them is in
 * `src/lib/jobs/budget.ts` (decisions), `src/lib/server/usage.ts` (metering and the daily sums),
 * `src/lib/server/rate-limit.ts` (the counters) and `src/lib/llm-server.ts` (bounded calls).
 */
export const LIMITS = {
  /** Largest file a student can upload (the `materials` bucket enforces the same). */
  uploadBytes: 50 * 1024 * 1024,
  /** Most pages (or slides) read from one file. */
  pagesPerFile: 150,
  /** Longest the server spends reading one file (the process route may run 60 s). */
  readMs: 40_000,
  /** A read that started longer ago than this died (its function was stopped): another request may take it over. */
  staleReadingMs: 5 * 60_000,
  /** Longest reflection note and prose answer sent to the model. */
  noteChars: 2000,
  answerChars: 2000,
  /** Longest Notes for Orca, per account and per course (the columns' check says the same). */
  notesChars: 1000,
  /** Longest description of how the student marks confusion in their notes (profiles.marker_notes; the column's check says the same). */
  markerChars: 300,
  /** Weekly class meetings a course's schedule may list. */
  classMeetings: 14,

  /**
   * Pages of material one student may put through the model in one of their days (uploads). 1,000
   * since 2026-11-07 (owner): a Canvas import brings a whole course's decks in one day, and 300 left
   * most of ALD waiting; the token cap below is the backstop.
   */
  pagesPerDay: 1000,
  /** Tokens (input, output and cache) one student's calls may use in one of their days; a cap on pages can't be dodged with dense pages. */
  tokensPerDay: 2_000_000,

  /** Requests per student: a fixed window counted in Postgres (`hit_rate_limit`). */
  rate: {
    /** Starting an upload (POST /api/materials). */
    upload: { max: 20, windowSeconds: 24 * 3600 },
    /** Matching a reflection note (POST /api/reflect). */
    reflect: { max: 10, windowSeconds: 3600 },
    /** Grading a prose answer (POST /api/grade). */
    grade: { max: 60, windowSeconds: 60 },
    /** Asking for a top-up after a session (POST /api/top-up); each one is a run row and a job. */
    topUp: { max: 30, windowSeconds: 3600 },
    /** "Find connections" on the Atlas (POST /api/relink): one model call over the course's topics. */
    relink: { max: 10, windowSeconds: 3600 },
    /** Importing a Canvas course (POST /api/canvas/import): each run can pull many files. */
    /**
     * Importing a Canvas course (POST /api/canvas/import). The import page calls it up to 10 times in
     * a row for a big course (200 s of pulling each), so the hour must hold a few whole loops; each
     * call only works on the student's own courses, so this bounds cost, not access (2026-11-08).
     */
    canvasImport: { max: 30, windowSeconds: 3600 },
    /** Pasting text or a chat link (POST /api/materials/text): each call stores pages and starts a job (2026-11-08). */
    text: { max: 30, windowSeconds: 3600 },
    /** Adding a website (POST /api/materials/web): an outbound fetch of up to 10 MB and a job per call. */
    web: { max: 20, windowSeconds: 3600 },
    /** Connecting Canvas (POST /api/canvas): a DNS lookup and an outbound request to the site named. */
    canvasConnect: { max: 10, windowSeconds: 3600 },
    /** A Claude connector call (POST /api/mcp/<token>): the link is the only credential, so a leaked one is bounded (2026-11-08). */
    connector: { max: 120, windowSeconds: 60 },
  },

  /** One model call: the longest it may take, and how often a transient failure is retried. */
  modelTimeoutMs: 10 * 60_000,
  modelRetries: 2,
} as const;

export type RateAction = keyof typeof LIMITS.rate;

/**
 * The service-wide ceiling for one UTC day, USD (`ORCA_DAILY_BUDGET_USD`). Past it every new model
 * call waits until tomorrow, for everyone: the backstop against many new accounts (decision 10).
 * Unset means no ceiling, which is only right for local development; production sets it.
 */
export function globalDailyBudgetUsd(): number | null {
  const raw = process.env.ORCA_DAILY_BUDGET_USD;
  if (raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`ORCA_DAILY_BUDGET_USD must be a non-negative number of dollars (it is "${raw}")`);
  return n;
}
