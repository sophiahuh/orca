/**
 * The daily budgets (Phase 4 plan, decision 10), decided here from numbers the server reads:
 * what the student has already put through the model today (pages and tokens), what everyone
 * has spent today, and what this job would add. Over a limit, a job's run waits instead of
 * running (jobs.ts) and the screen says why. Pure; loads under plain Node.
 */

export interface UsageToday {
  /** Pages of material this student's uploads put through the model today. */
  pages: number;
  /** Tokens (input, output, cache) this student's calls used today. */
  tokens: number;
  /** Estimated spend of every student today, USD. */
  globalUsd: number;
}

export interface BudgetLimits {
  pagesPerDay: number;
  tokensPerDay: number;
  /** The whole service's ceiling for one day; null when none is set. */
  globalUsdPerDay: number | null;
}

export type BudgetReason = "daily-pages" | "daily-tokens" | "global-budget";

export type BudgetVerdict = { ok: true } | { ok: false; reason: BudgetReason; message: string };

export const BUDGET_MESSAGES: Record<BudgetReason, string> = {
  "daily-pages": "Daily limit reached: processing resumes tomorrow.",
  "daily-tokens": "Daily limit reached: processing resumes tomorrow.",
  "global-budget": "Orca's model budget for today is used up: processing resumes tomorrow.",
};

/**
 * Whether a job that would send `pages` more pages may start. The page limit is checked with what
 * the job adds (so one big deck can't slip past a nearly spent day); the token limit and the
 * global ceiling are checked on what was already spent, since a job's tokens aren't known before it
 * runs. A student already over either is held; a job starting under them may overshoot by one job,
 * which per-step max_tokens and the page cap bound.
 */
export function judgeBudget(used: UsageToday, pages: number, limits: BudgetLimits): BudgetVerdict {
  if (limits.globalUsdPerDay !== null && used.globalUsd >= limits.globalUsdPerDay) return { ok: false, reason: "global-budget", message: BUDGET_MESSAGES["global-budget"] };
  if (used.tokens >= limits.tokensPerDay) return { ok: false, reason: "daily-tokens", message: BUDGET_MESSAGES["daily-tokens"] };
  if (pages > 0 && used.pages + pages > limits.pagesPerDay) return { ok: false, reason: "daily-pages", message: BUDGET_MESSAGES["daily-pages"] };
  return { ok: true };
}

/**
 * The instant the current day began in `timeZone` (the student's profile zone, decision 11), so
 * "today" in the budget queries means the student's day. Throws RangeError for an unknown zone.
 */
export function dayStartIn(timeZone: string, now: Date): Date {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  // Seconds since local midnight, then back from now (DST shifts inside the day are covered by the
  // check below, which recomputes at the candidate and corrects by the difference).
  const sinceMidnight = (get("hour") * 3600 + get("minute") * 60 + get("second")) * 1000 + now.getMilliseconds();
  let start = new Date(now.getTime() - sinceMidnight);
  const again = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(start);
  const h = Number(again.find((p) => p.type === "hour")!.value);
  const m = Number(again.find((p) => p.type === "minute")!.value);
  if (h !== 0 || m !== 0) {
    // A DST change between midnight and now: shift by the hour(s) the clock moved.
    const drift = (h >= 12 ? h - 24 : h) * 3600_000 + m * 60_000;
    start = new Date(start.getTime() - drift);
  }
  return start;
}
