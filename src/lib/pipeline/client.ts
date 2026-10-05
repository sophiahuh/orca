/** Calling pipeline steps from the browser: Orca's route, or the student's browser-only model directly. */
import type { z } from "zod";
import { type LlmConfig, PROVIDERS, compatChat, llmReady } from "../llm";
import { parseLooseJson } from "./parse";
import { buildPrompt } from "./prompts";
import type { CallStep } from "./run";
import { STEPS, type StepName } from "./schemas";

export function pipelineCaller(llm: LlmConfig | null): CallStep {
  const own = llmReady(llm) ? llm : null;
  return (async (step: StepName, input: unknown) => {
    const schema: z.ZodType<unknown> = STEPS[step].output;
    if (own && PROVIDERS[own.provider].browserOnly) {
      const built = buildPrompt(step, input as never);
      const content = built.context ? `${built.context}\n\n${built.prompt}` : built.prompt;
      const text = await compatChat(own, built.system, [{ role: "user", content }], { maxTokens: 16000, json: true });
      return schema.parse(parseLooseJson(text));
    }
    const res = await fetch(`/api/pipeline/${step}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ llm: own, input }),
    });
    const data = (await res.json().catch(() => ({}))) as { output?: unknown; error?: string };
    if (!res.ok || data.output === undefined) throw new Error(data.error ?? `The ${step} step failed (${res.status}).`);
    return schema.parse(data.output);
  }) as CallStep;
}
