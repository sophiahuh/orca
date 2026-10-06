import type { StepName } from "./schemas.ts";

/** Per step: how hard the model thinks and how much it may write. Shared by the route and the evaluation script. */
export const STEP_BUDGET: Record<StepName, { effort: "low" | "medium" | "high"; maxTokens: number }> = {
  extract: { effort: "medium", maxTokens: 16000 },
  reconcile: { effort: "low", maxTokens: 2048 },
  generate: { effort: "medium", maxTokens: 24000 },
  deep: { effort: "medium", maxTokens: 24000 },
  reflect: { effort: "medium", maxTokens: 4000 },
};
