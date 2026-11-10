/**
 * material_for (docs/superpowers/specs/2026-11-10-cram-mode-contracts.md, section 4): each
 * objective's anchored pages (pagesFor in src/lib/pipeline/topup.ts, the same materials order), at
 * most 6 per objective, each page's text cut at 2,500 characters, never from a held-back or removed
 * material; heldBack counts the held-back materials skipped. No model calls. Only the pages of the
 * live materials the objectives need are read (`materialsToRead`), never a held-back one's.
 */
import type { MaterialFor } from "@/lib/connector/mcp";
import { heldBackAmong, materialsToRead, piecesFor } from "@/lib/connector/material-pieces";
import type { MaterialPages, Objective } from "@/lib/data";
import { LIMITS } from "@/lib/limits";
import { materialFromRow, objectiveFromRow, topicFromRow } from "@/lib/supabase/app-rows";
import type { OrcaSupabase } from "@/lib/supabase/server";

/** A merged objective's survivor (its pages are the survivor's); the objective itself when it isn't merged. */
function survivor(id: string, byId: ReadonlyMap<string, Objective>): Objective | undefined {
  let o = byId.get(id);
  for (let i = 0; o?.mergedInto && i < 50; i++) o = byId.get(o.mergedInto);
  return o;
}

export async function materialFor(db: OrcaSupabase, ownerId: string, courseId: string, objectiveIds: string[]): Promise<MaterialFor | null> {
  const { data: course, error } = await db.from("courses").select("id").eq("owner_id", ownerId).eq("id", courseId).is("deleted_at", null).maybeSingle();
  if (error) throw new Error(`Couldn't read the course: ${error.message}`);
  if (!course) return null;
  const [objectives, topics, materials] = await Promise.all([
    db.from("objectives").select().eq("owner_id", ownerId).eq("course_id", courseId),
    db.from("topics").select().eq("owner_id", ownerId).eq("course_id", courseId),
    // Ready materials only: a removed one has no pages and is never read.
    db.from("materials").select().eq("owner_id", ownerId).eq("course_id", courseId).eq("status", "ready").order("created_at"),
  ]);
  for (const r of [objectives, topics, materials]) if (r.error) throw new Error(`Couldn't read the course: ${r.error.message}`);

  const byId = new Map((objectives.data ?? []).map((o) => [o.id, objectiveFromRow(o)]));
  const topicById = new Map((topics.data ?? []).map((t) => [t.id, topicFromRow(t)]));
  const live = (materials.data ?? []).map(materialFromRow);
  // Each requested id resolved to a live objective (a merged one to its survivor); archived or unknown ones get no pieces.
  const resolved = objectiveIds.map((id) => {
    const o = survivor(id, byId);
    return { id, objective: o && o.review !== "archived" ? o : undefined };
  });
  const wanted = resolved.flatMap((r) => (r.objective ? [r.objective] : []));

  const pages: Record<string, MaterialPages> = {};
  await Promise.all(
    materialsToRead(wanted, live).map(async (materialId) => {
      const { data, error: pagesError } = await db.from("material_pages").select("n, text").eq("owner_id", ownerId).eq("material_id", materialId).order("n").limit(LIMITS.pagesPerFile);
      if (pagesError) throw new Error(`Couldn't read the material's pages: ${pagesError.message}`);
      if (data.length) pages[materialId] = data.map((p) => ({ n: p.n, text: p.text }));
    }),
  );
  const src = { materials: live, pages };
  return {
    objectives: resolved.map(({ id, objective }) => ({ objectiveId: id, pieces: objective ? piecesFor(objective, topicById.get(objective.topicId), src) : [] })),
    heldBack: heldBackAmong(wanted, live),
  };
}
