/**
 * add_material (docs/superpowers/specs/2026-11-10-cram-mode-contracts.md, section 4): with text,
 * the text route's result ({ material } or { duplicate }) through the same code as POST
 * /api/materials/text (`addTextMaterial`), held back as asked; with file true and no text, an
 * absolute link (SITE_URL) to /add-material?course=<slug>&type=<type>&holdBack=1, which the page
 * reads to preset the type and the hold-back.
 */
import type { AddMaterialInput, AddMaterialResult } from "@/lib/connector/mcp";
import { SiteUrlError, linkOrigin, siteUrl } from "@/lib/auth/site";
import { addTextMaterial } from "@/lib/server/text-material";
import type { OrcaSupabase } from "@/lib/supabase/server";

/** The upload page's address for a course, type and hold-back, under the site's origin. */
export function uploadLink(origin: string, slug: string, type: AddMaterialInput["type"], holdBack: boolean): string {
  const params = new URLSearchParams({ course: slug, type });
  if (holdBack) params.set("holdBack", "1");
  return `${origin}/add-material?${params.toString()}`;
}

export async function addMaterial(db: OrcaSupabase, ownerId: string, courseId: string, input: AddMaterialInput): Promise<AddMaterialResult | { error: string }> {
  if (input.text === undefined) {
    const { data: course, error } = await db.from("courses").select("slug").eq("owner_id", ownerId).eq("id", courseId).is("deleted_at", null).maybeSingle();
    if (error) throw new Error(`Couldn't read the course: ${error.message}`);
    if (!course) return { error: "No such course." };
    let origin: string;
    try {
      origin = linkOrigin({ siteUrl: siteUrl(), production: process.env.NODE_ENV === "production" });
    } catch (e) {
      if (e instanceof SiteUrlError) return { error: `Orca can't build an upload link: ${e.message} The student can open Add material in Orca instead.` };
      throw e;
    }
    return { uploadLink: uploadLink(origin, course.slug, input.type, input.holdBack) };
  }
  const out = await addTextMaterial(db, ownerId, { courseId, type: input.type, assigned: null, due: null, text: input.text.trim(), heldBack: input.holdBack, ...(input.filename ? { filename: input.filename } : {}) });
  if (out.status === 201) {
    const m = out.body.material;
    return { material: { id: m.id, filename: m.filename, type: m.type, heldBack: m.heldBack } };
  }
  if (out.status === 200) return { duplicate: { id: out.body.duplicate.id, filename: out.body.duplicate.filename } };
  return { error: out.body.error };
}
