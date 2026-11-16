/** Existing top-up/dive orchestration, with the same question stock leases as upload phases. */
import type { JobStore } from "@/lib/jobs/jobs";
import type { RunDeps } from "@/lib/pipeline/run";
import type { OrcaSupabase } from "@/lib/supabase/server";
import { pipelineRpc } from "./db";
import { coordinateWriting } from "./writing";
import { promptKey } from "@/lib/pipeline/questions";

export function coordinatedStore(db: OrcaSupabase, base: JobStore, ownerId: string, runId: string, policy: "top-up" | "deep-review") {
  let token = "";
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const dispose = () => { if (heartbeat) clearInterval(heartbeat); };
  const store: JobStore = {
    ...base,
    async claim(id, progress) {
      const lease = await pipelineRpc<{ token: string } | null>(db, "claim_run", { ownerId, runId: id, progress });
      token = lease?.token ?? "";
      if (token) heartbeat = setInterval(() => { void pipelineRpc(db, "end_run", { ownerId, runId, token }).catch(dispose); }, 30_000);
      return !!token;
    },
    async progress(_id, progress) { await pipelineRpc(db, "end_run", { ownerId, runId, token, progress }); },
    async fail(_id, error) { await pipelineRpc(db, "end_run", { ownerId, runId, token, state: "failed", error }); },
    async wait(_id, verdict) { await pipelineRpc(db, "end_run", { ownerId, runId, token, state: "waiting", error: verdict.message }); },
    async save(_courseId, rows) {
      await pipelineRpc(db, "commit_questions", { ownerId, runId, token, policy, questions: (rows.questions ?? []).map((q) => ({ ...q, prompt_key: promptKey(q.prompt ?? "") })), dropped: rows.runs?.[0]?.dropped ?? [] });
      await pipelineRpc(db, "end_run", { ownerId, runId, token, state: "done", questionIds: rows.runs?.[0]?.question_ids ?? [] });
    },
  };
  const claimWriting: NonNullable<RunDeps["claimWriting"]> = (input) => coordinateWriting(db, { ownerId, runId, token, policy })(input);
  return { store, claimWriting, dispose, getToken: () => token };
}
