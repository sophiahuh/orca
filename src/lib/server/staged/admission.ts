import type { OrcaSupabase } from "@/lib/supabase/server";
import type { Admission, AdmissionItem } from "@/lib/jobs/staged/types";
import { pipelineRpc } from "./db";

export async function admit(db: OrcaSupabase, ownerId: string, courseId: string, batchId: string, items: AdmissionItem[], source = "browser"): Promise<Admission> {
  return pipelineRpc(db, "admit", { ownerId, courseId, batchId, items, source });
}
export async function singleton(db: OrcaSupabase, ownerId: string, courseId: string, itemId: string, name: string, source = "browser", metadata: Record<string, unknown> = {}) {
  return admit(db, ownerId, courseId, itemId, [{ id: itemId, name, metadata }], source);
}
