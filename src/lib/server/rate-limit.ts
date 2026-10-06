/**
 * Per-student rate limits (Phase 4 plan, decision 10), counted in Postgres by `hit_rate_limit`:
 * one statement checks and bumps a fixed window per student and action, so a burst can't slip
 * through between a read and a write and no other service is needed. The limits themselves are in
 * `LIMITS.rate`. A route that's over answers 429 with `retry-after`.
 */
import { LIMITS, type RateAction } from "@/lib/limits";
import type { OrcaSupabase } from "@/lib/supabase/server";
import { NO_STORE } from "./student";

export type RateVerdict = { ok: true; count: number } | { ok: false; count: number; retryAfterSeconds: number; message: string };

const WHAT: Record<RateAction, string> = {
  upload: "uploads",
  reflect: "reflection matches",
  grade: "answers graded",
  topUp: "top-ups",
  deepReview: "deep reviews started",
  relink: "connection searches",
};

function spell(seconds: number): string {
  if (seconds >= 3600) return `${Math.ceil(seconds / 3600)} hour${seconds >= 7200 ? "s" : ""}`;
  if (seconds >= 60) return `${Math.ceil(seconds / 60)} minute${seconds >= 120 ? "s" : ""}`;
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

/** Count one `action` for the student and say whether it's within the limit. */
export async function rateLimit(db: OrcaSupabase, ownerId: string, action: RateAction): Promise<RateVerdict> {
  const { max, windowSeconds } = LIMITS.rate[action];
  const { data, error } = await db.rpc("hit_rate_limit", { owner: ownerId, action, window_seconds: windowSeconds, max_hits: max });
  if (error) throw new Error(`Couldn't check the rate limit: ${error.message}`);
  const out = data as { allowed: boolean; count: number; retry_after_seconds: number };
  if (out.allowed) return { ok: true, count: out.count };
  return {
    ok: false,
    count: out.count,
    retryAfterSeconds: out.retry_after_seconds,
    message: `That's ${max} ${WHAT[action]} in ${spell(windowSeconds)}, the most Orca allows. Try again in ${spell(out.retry_after_seconds)}.`,
  };
}

/** The 429 a route sends when `rateLimit` said no. */
export function tooManyRequests(verdict: Extract<RateVerdict, { ok: false }>): Response {
  return Response.json({ error: verdict.message, retryAfterSeconds: verdict.retryAfterSeconds }, { status: 429, headers: { ...NO_STORE, "retry-after": String(verdict.retryAfterSeconds) } });
}
