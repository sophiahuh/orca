import type { OrcaSupabase } from "@/lib/supabase/server";
import { processUpload } from "@/lib/server/materials";
import { serverModel } from "@/lib/server/model";
import { pipelineRpc } from "./db";

/** Only expired browser ingestions whose bytes actually arrived; never races an active uploader. */
export async function recoverIngestion(db: OrcaSupabase, ownerId: string) {
  const model = serverModel();
  if (!model) return;
  const items = await pipelineRpc<Array<{ id: string; materialId: string; again: boolean }>>(db, "recoverable", { ownerId });
  for (const item of items) {
    const result = await processUpload(db, ownerId, item.materialId, { again: item.again });
    if (result.status === 200) {
      const materialId = "duplicate" in result.body ? result.body.duplicate.id : "pages" in result.body ? result.body.material.id : null;
      if (materialId) await pipelineRpc(db, "attach", { ownerId, itemId: item.id, materialId, model });
    } else if (result.status !== 409) {
      await pipelineRpc(db, "ingestion", { ownerId, itemId: item.id, action: "fail", error: "The interrupted file could not be read. Try uploading it again." });
    }
  }
}
