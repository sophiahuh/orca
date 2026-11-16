import { recoverIngestion } from "./recover";
import { after } from "next/server";
import { configure, idempotencyKeys, tasks } from "@trigger.dev/sdk";
import type { stagedUploadTask } from "@/trigger/jobs";
import type { OrcaSupabase } from "@/lib/supabase/server";
import type { StageJob } from "@/lib/jobs/staged/types";
import { pipelineRpc } from "./db";

/** Claims are durable outbox entries. A failed handoff is reclaimed after its lease, not lost. */
export async function scheduleStages(db: OrcaSupabase, ownerId: string, mode: "after-response" | "now" = "after-response") {
  await recoverIngestion(db, ownerId);
  if (process.env.ORCA_JOBS === "trigger") {
    configure({ previewBranch: "" });
    for (let i = 0; i < 8; i++) {
      const job = await pipelineRpc<StageJob | null>(db, "claim", { ownerId });
      if (!job) break;
      const key = await idempotencyKeys.create(`upload-stage:${job.taskId}:${job.token}`, { scope: "global" });
      await tasks.trigger<typeof stagedUploadTask>("staged-upload", job, { idempotencyKey: key });
    }
    return;
  }
  const work = async () => {
    const { runPipelineStage } = await import("./run");
    const until = Date.now() + 230_000;
    const active = new Set<Promise<void>>();
    while (Date.now() < until) {
      while (active.size < 4) {
        const job = await pipelineRpc<StageJob | null>(db, "claim", { ownerId });
        if (!job) break;
        const running = runPipelineStage(job).finally(() => { active.delete(running); });
        active.add(running);
      }
      if (!active.size) break;
      await Promise.race(active);
    }
    await Promise.all(active);
  };
  if (mode === "after-response") after(work); else await work();
}
