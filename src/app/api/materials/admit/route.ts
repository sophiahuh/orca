import { z } from "zod";
import { forStudent, reply } from "@/lib/server/student";
import { stagedPipeline, pipelineRpc } from "@/lib/server/staged/db";
import { admit } from "@/lib/server/staged/admission";

const Body = z.object({ courseId: z.uuid(), batchId: z.uuid(), items: z.array(z.object({ id: z.uuid(), name: z.string().min(1).max(255), metadata: z.record(z.string(), z.unknown()).optional() })).min(1).max(1000) });
export async function POST(request: Request) {
  return forStudent(request, async (student, db) => {
    if (!stagedPipeline()) return reply(200, { staged: false });
    const input = Body.safeParse(await request.json().catch(() => null));
    if (!input.success) return reply(400, { error: "Send the ordered list of files." });
    const batch = await admit(db, student.id, input.data.courseId, input.data.batchId, input.data.items);
    // Rate is charged by an atomic per-item receipt, never twice for an HTTP retry.
    for (const item of batch.items) {
      await pipelineRpc(db, "charge_item", { ownerId: student.id, itemId: item.id });
    }
    return reply(200, { ...batch, staged: true });
  });
}
export async function PATCH(request: Request) {
  return forStudent(request, async (student, db) => {
    const input = z.object({ itemId: z.uuid(), action: z.enum(["renew", "fail", "retry"]), error: z.string().max(500).optional() }).safeParse(await request.json().catch(() => null));
    if (!input.success || !stagedPipeline()) return reply(400, { error: "Say which upload to update." });
    await pipelineRpc(db, "ingestion", { ownerId: student.id, ...input.data });
    return reply(200, { ok: true });
  });
}
