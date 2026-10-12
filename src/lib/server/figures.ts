/**
 * Figures for an upload's questions, rendered on the server from the stored file. The file is read
 * from Storage once per job and used only if its SHA-256 still matches the hash taken when it was
 * read (a student can overwrite their own stored file afterwards); otherwise no figure is rendered
 * and the questions that needed one are dropped with that reason.
 */
import { createHash } from "node:crypto";
import type { Material } from "@/lib/data";
import { renderSlide } from "@/lib/material/render-slide";
import type { OrcaSupabase } from "@/lib/supabase/server";
import { BUCKET } from "./materials";

export function figureRenderer(db: OrcaSupabase, ownerId: string): (material: Material, slide: number) => Promise<string | null> {
  const files = new Map<string, Promise<Uint8Array | null>>();
  const file = (materialId: string) => {
    let f = files.get(materialId);
    if (!f) {
      f = (async () => {
        const { data: m, error } = await db.from("materials").select("storage_path, content_hash").eq("owner_id", ownerId).eq("id", materialId).maybeSingle();
        if (error || !m?.storage_path || !m.content_hash) return null;
        const got = await db.storage.from(BUCKET).download(m.storage_path);
        if (got.error) return null;
        const bytes = new Uint8Array(await got.data.arrayBuffer());
        return createHash("sha256").update(bytes).digest("hex") === m.content_hash ? bytes : null;
      })();
      files.set(materialId, f);
    }
    return f;
  };
  return async (material, slide) => {
    const bytes = await file(material.id);
    return bytes ? renderSlide(bytes, slide) : null;
  };
}
