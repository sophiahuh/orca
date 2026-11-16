import type { ModelCtx } from "@/lib/server/model";
import { adminClient } from "@/lib/supabase/server";
import { dayStartIn } from "@/lib/jobs/budget";
import { PipelineDeferred } from "@/lib/jobs/staged/types";
import { globalDailyBudgetUsd } from "@/lib/limits";
import { priceOf } from "@/lib/pricing";
import { timezoneOf } from "@/lib/server/usage";
import { pipelineRpc } from "./db";

export async function reserveAttempt(ctx: ModelCtx, model: string, inputBound: number, outputBound: number) {
  const db = adminClient();
  const now = new Date();
  const id = crypto.randomUUID();
  const providerSlots = Number(process.env.ORCA_MODEL_CONCURRENCY ?? 20);
  if (!Number.isInteger(providerSlots) || providerSlots < 1 || providerSlots > 1000) throw new Error("ORCA_MODEL_CONCURRENCY must be an integer from 1 to 1000");
  const p = priceOf(model);
  if (!p) throw new Error(`No reservation price for ${model}`);
  const long = p.longContext && inputBound > p.longContext.overInputTokens ? p.longContext : null;
  const usd = (inputBound * Math.max(p.input, p.cacheWrite5m) * (long?.inputX ?? 1) + outputBound * p.output * (long?.outputX ?? 1)) / 1_000_000;
  const response = await pipelineRpc<{ ok: boolean; reason?: string; message?: string }>(db, "reserve_call", { ownerId: ctx.ownerId, runId: ctx.runId, runToken: ctx.writingToken?.(), ...ctx.task, id, dayStart: dayStartIn(await timezoneOf(db, ctx.ownerId), now).toISOString(), utcStart: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString(), tokens: inputBound + outputBound, usd, globalCap: globalDailyBudgetUsd(), kind: ctx.kind, providerSlots });
  if (!response.ok) throw new PipelineDeferred(response.reason ?? "capacity", response.message ?? "Waiting for model allowance.");
  ctx.attemptId = id;
  return { settle: (known: boolean) => pipelineRpc(db, "settle_call", { ownerId: ctx.ownerId, id, known }) };
}
