/**
 * The admin view's pure helpers (2026-11-10): ordering the users table and filling a run of days so
 * a spend table shows every day, zero included. Node-loadable (relative imports, no Next).
 */

export interface UserRow {
  id: string;
  name: string | null;
  email: string | null;
  joined: string;
  lastActive: string | null;
  isAdmin: boolean;
  courses: number;
  uploads: number;
  pages: number;
  answers: number;
  thumbsDown: number;
  spend: number;
  connector: boolean;
  canvas: boolean;
}

export type UserSort = "joined" | "spend" | "active";

export function isUserSort(s: string | undefined): s is UserSort {
  return s === "joined" || s === "spend" || s === "active";
}

/** Newest joined first, most spent first, or most recently active first (never active last). Stable. */
export function sortUsers(rows: readonly UserRow[], sort: UserSort): UserRow[] {
  const out = [...rows];
  const time = (s: string | null) => (s ? Date.parse(s) : Number.NEGATIVE_INFINITY);
  if (sort === "spend") out.sort((a, b) => b.spend - a.spend || time(b.joined) - time(a.joined));
  else if (sort === "active") out.sort((a, b) => time(b.lastActive) - time(a.lastActive) || time(b.joined) - time(a.joined));
  else out.sort((a, b) => time(b.joined) - time(a.joined));
  return out;
}

export interface DayRow {
  /** YYYY-MM-DD, UTC. */
  day: string;
  calls: number;
  usd: number;
  tokens: number;
}

/** The UTC day of an instant, as the database's `date_trunc('day', at)` keys it. */
export function dayKey(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** The last `days` UTC days ending today, newest first, each with its row or zeros. */
export function fillDays(rows: readonly DayRow[], days: number, today: Date): DayRow[] {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const out: DayRow[] = [];
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  for (let i = 0; i < Math.max(days, 0); i++) {
    const day = dayKey(new Date(start - i * 86_400_000));
    out.push(byDay.get(day) ?? { day, calls: 0, usd: 0, tokens: 0 });
  }
  return out;
}

/** The widest bar is the biggest day; everything else in proportion (0 to 1). */
export function barWidths(rows: readonly DayRow[]): number[] {
  const max = Math.max(0, ...rows.map((r) => r.usd));
  return rows.map((r) => (max > 0 ? r.usd / max : 0));
}
