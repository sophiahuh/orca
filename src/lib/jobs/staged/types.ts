/** Durable upload protocol. These contracts also run under plain Node in tests. */
export const PIPELINE_PROTOCOL = 2;
export const PIPELINE_LIMITS = { ingest: 2, prepare: 2, callsPerOwner: 4, ingestLeaseMs: 15 * 60_000, taskLeaseMs: 12 * 60_000, structureRetries: 2 } as const;
export type Phase = "prepare" | "structure" | "questions";
export interface StageJob { ownerId: string; taskId: string; token: string }
export interface StageTask extends StageJob { runId: string; materialId: string; courseId: string; phase: Phase; checkpoint: unknown; revision: number; attempt: number }
export interface AdmissionItem { id: string; name: string; metadata?: Record<string, unknown> }
export interface Admission { batchId: string; items: Array<{ id: string; sequence: number; materialId: string | null; runId: string | null; state: string; metadata: Record<string, unknown> }> }
export interface QuestionTarget { objectiveId: string; need: number; warmup?: boolean }
export class PipelineDeferred extends Error {
  readonly reason: string;
  constructor(reason: string, message: string) { super(message); this.reason = reason; this.name = "PipelineDeferred"; }
}
/** Shared bounded worker loop. Results follow admission order, never completion order. */
export async function concurrent<T, R>(items: readonly T[], limit: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("Concurrency must be a positive integer");
  const results = new Array<R>(items.length);
  let next = 0;
  const settled = await Promise.allSettled(Array.from({ length: Math.min(items.length, limit) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await work(items[i], i); }
  }));
  const failed = settled.find((r) => r.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
  return results;
}
