/**
 * Metering and the daily budgets (Phase 4 plan, decision 10). Every model call made with Orca's
 * key records its tokens and estimated cost in `model_usage` (through `completeJson`'s `onUsage`,
 * wired in `src/lib/server/model.ts`); the budgets sum that table for the student's current day (in
 * their timezone) and for everyone today (UTC). The decisions are pure (`src/lib/jobs/budget.ts`).
 * Service-role client only; every student query names the owner.
 */
import { type BudgetVerdict, type UsageToday, dayStartIn, judgeBudget } from "@/lib/jobs/budget";
import { LIMITS, globalDailyBudgetUsd } from "@/lib/limits";
import { type TokenUsage, costUsd, priceOf } from "@/lib/pricing";
import type { ModelCtx } from "@/lib/server/model";
import type { OrcaSupabase } from "@/lib/supabase/server";

/**
 * Record one call. Throws if the row can't be written: a call that can't be metered is a bug, not a
 * quiet loss. `pricedAs` names the model whose price to use when `model` (what the API answered
 * with) has none; the row then says so in its model column, never a silent guess.
 */
export async function recordUsage(db: OrcaSupabase, ctx: ModelCtx, model: string, usage: TokenUsage, opts: { at?: Date; pricedAs?: string } = {}): Promise<void> {
  const { error } = await db.from("model_usage").insert({
    owner_id: ctx.ownerId,
    kind: ctx.kind,
    run_id: ctx.runId ?? null,
    model: opts.pricedAs ? `${model} (priced as ${opts.pricedAs})` : model,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    cache_write_tokens: usage.cacheWriteTokens,
    cache_read_tokens: usage.cacheReadTokens,
    cost_usd: costUsd(opts.pricedAs ?? model, usage),
    at: (opts.at ?? new Date()).toISOString(),
  });
  if (error) throw new Error(`Couldn't record the model call's usage: ${error.message}`);
}

/**
 * Metering for one call made for `ctx` with `requested` as the model asked for. A server-side
 * fallback may answer with another model; one `src/lib/pricing.ts` doesn't price is recorded at the
 * requested model's price and labelled, rather than failing a step that was already paid for.
 */
export function meterUsage(db: OrcaSupabase, ctx: ModelCtx, requested: string): (usage: TokenUsage, model: string) => Promise<void> {
  return (usage, model) => recordUsage(db, ctx, model, usage, priceOf(model) || !priceOf(requested) ? {} : { pricedAs: requested });
}

async function timezoneOf(db: OrcaSupabase, ownerId: string): Promise<string> {
  const { data, error } = await db.from("profiles").select("timezone").eq("owner_id", ownerId).maybeSingle();
  if (error) throw new Error(`Couldn't read the student's timezone: ${error.message}`);
  return data?.timezone || "UTC";
}

/**
 * Pages this student's uploads put through the model since `since`: the pages of every upload run
 * finished (done or failed) in that time. A running run is left out: one job runs at a time per
 * student, so the only running run is the one asking, and its pages are the `pages` the check
 * adds (counting them here too held a third 100-page deck after two, with 300 allowed).
 */
async function pagesSince(db: OrcaSupabase, ownerId: string, since: Date): Promise<number> {
  const { data: runs, error } = await db
    .from("pipeline_runs")
    .select("material_id")
    .eq("owner_id", ownerId)
    .eq("kind", "upload")
    .in("status", ["done", "failed"])
    .gte("at", since.toISOString());
  if (error) throw new Error(`Couldn't read today's runs: ${error.message}`);
  const ids = [...new Set(runs.flatMap((r) => (r.material_id ? [r.material_id] : [])))];
  if (!ids.length) return 0;
  const { count, error: pagesError } = await db.from("material_pages").select("n", { count: "exact", head: true }).eq("owner_id", ownerId).in("material_id", ids);
  if (pagesError) throw new Error(`Couldn't count today's pages: ${pagesError.message}`);
  return count ?? 0;
}

async function tokensSince(db: OrcaSupabase, ownerId: string, since: Date): Promise<number> {
  const { data, error } = await db.from("model_usage").select("input_tokens, output_tokens, cache_write_tokens, cache_read_tokens").eq("owner_id", ownerId).gte("at", since.toISOString());
  if (error) throw new Error(`Couldn't read today's usage: ${error.message}`);
  return data.reduce((sum, r) => sum + r.input_tokens + r.output_tokens + r.cache_write_tokens + r.cache_read_tokens, 0);
}

/** Everyone's estimated spend since `since`, USD. */
export async function globalCostSince(db: OrcaSupabase, since: Date): Promise<number> {
  const { data, error } = await db.from("model_usage").select("cost_usd").gte("at", since.toISOString());
  if (error) throw new Error(`Couldn't read today's spend: ${error.message}`);
  return data.reduce((sum, r) => sum + Number(r.cost_usd), 0);
}

/** What the student and everyone have used today. */
export async function usageToday(db: OrcaSupabase, ownerId: string, now = new Date()): Promise<UsageToday> {
  const since = dayStartIn(await timezoneOf(db, ownerId), now);
  const utcDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const [pages, tokens, globalUsd] = await Promise.all([pagesSince(db, ownerId, since), tokensSince(db, ownerId, since), globalCostSince(db, utcDay)]);
  return { pages, tokens, globalUsd };
}

/** Whether a job that would send `pages` more pages (0 for a top-up, a reflection or a grade) may run now. */
export async function checkBudget(db: OrcaSupabase, ownerId: string, pages: number, now = new Date()): Promise<BudgetVerdict> {
  return judgeBudget(await usageToday(db, ownerId, now), pages, { pagesPerDay: LIMITS.pagesPerDay, tokensPerDay: LIMITS.tokensPerDay, globalUsdPerDay: globalDailyBudgetUsd() });
}
