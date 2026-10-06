/**
 * Orca's model, on the server only (Phase 4 plan, decision 9, widened 2026-10-06 to OpenAI): every
 * pipeline step (extract, reconcile, generate, the checks, reflection matching) and every grade
 * runs here with Orca's own key. Which provider and model come from the environment
 * (`ORCA_MODEL_PROVIDER`, `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`, `ORCA_MODEL`; resolved in
 * `src/lib/model-config.ts`). There is no student key and no browser path. Without a key nothing is
 * generated: callers get null and say so.
 *
 * `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL` point the provider elsewhere; tests point Anthropic at
 * the fake Messages API (`e2e/fake-anthropic.ts`), and `/api/llm/status` says whether calls go to
 * this machine so the browser tests can refuse to run against a real API.
 */
import type { z } from "zod";
import type { LlmConfig } from "@/lib/llm";
import { LlmError, completeJson } from "@/lib/llm-server";
import { SERVER_PROVIDERS, callsAreLocal, resolveServerModel } from "@/lib/model-config";
import { STEP_BUDGET } from "@/lib/pipeline/budget";
import { parseLooseJson } from "@/lib/pipeline/parse";
import { buildPrompt } from "@/lib/pipeline/prompts";
import type { CallStep } from "@/lib/pipeline/run";
import { STEPS, type StepName } from "@/lib/pipeline/schemas";
import type { TokenUsage } from "@/lib/pricing";
import { checkBudget, meterUsage } from "@/lib/server/usage";
import { type OrcaSupabase, adminClient } from "@/lib/supabase/server";

/** The Anthropic default (what the server runs on when it uses Anthropic and `ORCA_MODEL` is unset). */
export const ORCA_MODEL = SERVER_PROVIDERS.anthropic.defaultModel;

/** The model the server uses, or null when it has no key (nothing is generated then). Throws on a bad setting. */
export function serverModel(): string | null {
  return resolveServerModel(process.env)?.model ?? null;
}

/** Orca's provider, model and key as `completeJson` takes them, or null without a key. Server only; never sent anywhere. */
export function orcaConfig(): LlmConfig | null {
  const m = resolveServerModel(process.env);
  return m ? { provider: m.provider, model: m.model, apiKey: m.apiKey, ...(m.baseUrl ? { baseUrl: m.baseUrl } : {}) } : null;
}

/** Whether model calls go to this machine (the tests' fake API) rather than the provider. */
export function modelIsLocal(): boolean {
  return callsAreLocal(resolveServerModel(process.env));
}

/**
 * Who a model call is for and why: the verified student (every call is made for one), the kind of
 * work, and the pipeline run it belongs to, if any. Required on every call so usage can be metered
 * and budgeted per student (decision 10); it changes nothing about the call yet.
 */
export interface ModelCtx {
  ownerId: string;
  kind: "upload" | "top-up" | "reflect" | "grade" | "deep-review" | "relink";
  runId?: string;
}

/** A step failed: the model or its reply, said for the student. */
export class StepError extends Error {
  readonly step: StepName;
  readonly status: number;
  constructor(step: StepName, message: string, status: number) {
    super(message);
    this.name = "StepError";
    this.step = step;
    this.status = status;
  }
}

/**
 * Metering for one call made for `ctx` (decision 10): every reply's token counts and cost go to
 * `model_usage`. Used by `stepCaller` and by the grader; pass it as `completeJson`'s `onUsage`.
 * `requested` is the model the call asked for (a fallback may answer with another; see `meterUsage`).
 */
export function meter(ctx: ModelCtx, db: OrcaSupabase = adminClient(), requested: string = orcaConfig()?.model ?? ""): (usage: TokenUsage, model: string) => Promise<void> {
  return meterUsage(db, ctx, requested);
}

export interface StepCallerOptions {
  /**
   * Check the student's daily budgets and the global ceiling before every call ("each-call": the
   * reflection route) or not at all ("none": the jobs check once when they start, and go waiting).
   */
  guard?: "each-call" | "none";
}

/** The message a guarded call fails with when a budget is spent (the student's day, or everyone's). */
export class BudgetError extends Error {
  readonly reason: string;
  constructor(reason: string, message: string) {
    super(message);
    this.name = "BudgetError";
    this.reason = reason;
  }
}

/**
 * The step caller the jobs and the reflection route inject into the pure pipeline. Each step's input
 * is checked against its schema before a prompt is built from it, and its reply against the output
 * schema. Every call is made for `ctx`, metered in `model_usage`, and (with `guard: "each-call"`)
 * refused with a 429 StepError when the student's or Orca's daily budget is spent. Null without a key.
 */
export function stepCaller(ctx: ModelCtx, options: StepCallerOptions = {}): CallStep | null {
  const config = orcaConfig();
  if (!config) return null;
  const guard = options.guard ?? "each-call";
  return (async (step: StepName, input: unknown) => {
    const spec = STEPS[step];
    if (!spec) throw new Error(`Unknown pipeline step "${String(step)}"`);
    const parsed = spec.input.safeParse(input);
    if (!parsed.success) throw new StepError(step, `The ${step} step got input it can't take: ${parsed.error.issues[0]?.message ?? "invalid"}`, 400);
    const built = buildPrompt(step, parsed.data as never);
    const schema: z.ZodType<unknown> = spec.output;
    const db = adminClient();
    if (guard === "each-call") {
      const verdict = await checkBudget(db, ctx.ownerId, 0);
      if (!verdict.ok) throw new StepError(step, verdict.message, 429);
    }
    try {
      return await completeJson(config, built.system, built.prompt, schema, (text) => schema.parse(parseLooseJson(text)), { ...STEP_BUDGET[step], context: built.context, ctx, onUsage: meter(ctx, db) });
    } catch (error) {
      if (error instanceof LlmError) throw new StepError(step, error.message, error.status);
      throw new StepError(step, `The ${step} step failed: ${error instanceof Error ? error.message : String(error)}`, 502);
    }
  }) as CallStep;
}
