/**
 * Orca's model, on the server only (Phase 4 plan, decision 9): every pipeline step (extract,
 * reconcile, generate, the checks, reflection matching) runs here with Orca's own key,
 * `ANTHROPIC_API_KEY`, on `claude-opus-5-5`. There is no student key and no browser path. Without
 * the key nothing is generated: callers get null and say so.
 *
 * The SDK reads `ANTHROPIC_BASE_URL` too; tests point it at the fake Messages API
 * (`e2e/fake-anthropic.ts`), and `/api/llm/status` says whether it points at this machine so the
 * browser tests can refuse to run against the real API.
 */
import type { z } from "zod";
import type { LlmConfig } from "@/lib/llm";
import { LlmError, completeJson } from "@/lib/llm-server";
import { STEP_BUDGET } from "@/lib/pipeline/budget";
import { parseLooseJson } from "@/lib/pipeline/parse";
import { buildPrompt } from "@/lib/pipeline/prompts";
import type { CallStep } from "@/lib/pipeline/run";
import { STEPS, type StepName } from "@/lib/pipeline/schemas";

export const ORCA_MODEL = "claude-opus-5-5";

/** The model the server uses, or null when it has no key (nothing is generated then). */
export function serverModel(): string | null {
  return process.env.ANTHROPIC_API_KEY ? ORCA_MODEL : null;
}

/** Whether model calls go to this machine (the tests' fake API) rather than Anthropic. */
export function modelIsLocal(): boolean {
  const base = process.env.ANTHROPIC_BASE_URL;
  if (!base) return false;
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname);
  } catch {
    return false;
  }
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
 * The step caller the jobs and the reflection route inject into the pure pipeline. Each step's input
 * is checked against its schema before a prompt is built from it, and its reply against the output
 * schema. Null without a key.
 */
export function stepCaller(): CallStep | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const config: LlmConfig = { provider: "anthropic", model: ORCA_MODEL, apiKey };
  return (async (step: StepName, input: unknown) => {
    const spec = STEPS[step];
    if (!spec) throw new Error(`Unknown pipeline step "${String(step)}"`);
    const parsed = spec.input.safeParse(input);
    if (!parsed.success) throw new StepError(step, `The ${step} step got input it can't take: ${parsed.error.issues[0]?.message ?? "invalid"}`, 400);
    const built = buildPrompt(step, parsed.data as never);
    const schema: z.ZodType<unknown> = spec.output;
    try {
      return await completeJson(config, built.system, built.prompt, schema, (text) => schema.parse(parseLooseJson(text)), { ...STEP_BUDGET[step], context: built.context });
    } catch (error) {
      if (error instanceof LlmError) throw new StepError(step, error.message, error.status);
      throw new StepError(step, `The ${step} step failed: ${error instanceof Error ? error.message : String(error)}`, 502);
    }
  }) as CallStep;
}
