/**
 * Limits (Phase 4 plan, decision 10). Each is checked on the server before any work that costs
 * something; the browser may check them too, but only to say so sooner. The budgets and rate limits
 * live here so there is one place to read what Orca allows; the code that enforces them is in
 * `src/lib/jobs/budget.ts` (decisions), `src/lib/server/usage.ts` (metering and the daily sums),
 * `src/lib/server/rate-limit.ts` (the counters) and `src/lib/llm-server.ts` (bounded calls).
 */
export const LIMITS = {
  /** Largest file a student can upload (the `materials` bucket enforces the same). */
  uploadBytes: 25 * 1024 * 1024,
  /** Most pages (or slides) read from one file. */
  pagesPerFile: 150,
  /** Most characters kept from one page after sanitising (a dense slide has a few thousand). */
  pageChars: 20_000,
  /** Longest the server spends reading one file (the process route may run 60 s). */
  readMs: 40_000,
  /** A read that started longer ago than this died (its function was stopped): another request may take it over. */
  staleReadingMs: 5 * 60_000,
  /** Longest reflection note and prose answer sent to the model. */
  noteChars: 2000,
  answerChars: 2000,

  /** Pages of material one student may put through the model in one of their days (uploads). */
  pagesPerDay: 300,
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
