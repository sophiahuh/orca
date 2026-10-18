/**
 * Page images rendered on the server from the stored file: a figure for a question (sentences painted
 * over), or a whole page for reading handwritten or scanned notes. The file is read from Storage
 * once per job and used only if its SHA-256 still matches the hash taken when it was read (a student
 * can overwrite their own stored file afterwards); otherwise nothing is rendered: the questions that
 * needed a figure are dropped with that reason, and pages keep their own text.
 */
import { createHash } from "node:crypto";
import type { Material } from "@/lib/data";
import { renderSlide } from "@/lib/material/render-slide";
import type { OrcaSupabase } from "@/lib/supabase/server";
import { BUCKET } from "./materials";

/** The stored files of one student's materials, each downloaded once and checked against its hash. */
function storedFiles(db: OrcaSupabase, ownerId: string): (materialId: string) => Promise<Uint8Array | null> {
  const files = new Map<string, Promise<Uint8Array | null>>();
  return (materialId) => {
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
}

export function figureRenderer(db: OrcaSupabase, ownerId: string): (material: Material, slide: number) => Promise<string | null> {
  const file = storedFiles(db, ownerId);
  return async (material, slide) => {
    const bytes = await file(material.id);
    return bytes ? renderSlide(bytes, slide) : null;
  };
}

/** A whole page, nothing painted over, wide enough for handwriting (the model reads up to about 1,600 px). */
export function pageRenderer(db: OrcaSupabase, ownerId: string): (material: Material, page: number) => Promise<string | null> {
  const file = storedFiles(db, ownerId);
  return async (material, page) => {
    const bytes = await file(material.id);
    return bytes ? renderSlide(bytes, page, { keepText: true, maxWidth: 1600, quality: 85 }) : null;
  };
}
