/**
 * The pure part of material_for (docs/superpowers/specs/2026-11-10-cram-mode-contracts.md, section
 * 4): which pages of which materials an objective's pieces come from. The materials are tried in
 * the order a top-up writes from them (`materialsFor`: most anchored places first, then the upload
 * that created the objective) and the pages are the ones a top-up would send (`pagesFor`), so Claude
 * reads what Orca's own writer reads. A held-back material is skipped and counted; a material that
 * isn't live (removed, or its text not stored) is skipped silently. No model calls.
 */
import type { Material, MaterialPages, Objective, Topic } from "../data.ts";
import { materialsFor, pagesFor } from "../pipeline/topup.ts";

export const MATERIAL_FOR_RULES = {
  /** At most this many pieces per objective. */
  piecesPerObjective: 6,
  /** Each page's text cut at this many characters. */
  pieceChars: 2500,
} as const;

export interface MaterialPiece {
  materialId: string;
  filename: string;
  page: number;
  text: string;
}

export interface PieceSource {
  /** The course's ready materials, held back or not. */
  materials: readonly Material[];
  /** The stored pages of the materials that were read (only the live ones the objectives need). */
  pages: Readonly<Record<string, MaterialPages>>;
}

/** The live materials (ready, not held back) the objectives would be written from, in need order: the ones whose pages material_for reads. */
export function materialsToRead(objectives: readonly Objective[], materials: PieceSource["materials"]): string[] {
  const live = new Set(materials.filter((m) => !m.heldBack).map((m) => m.id));
  return [...new Set(objectives.flatMap(materialsFor))].filter((id) => live.has(id));
}

/** The held-back materials among the ones the objectives are anchored to (what material_for counts as skipped). */
export function heldBackAmong(objectives: readonly Objective[], materials: PieceSource["materials"]): number {
  const held = new Set(materials.filter((m) => m.heldBack).map((m) => m.id));
  return new Set(objectives.flatMap(materialsFor).filter((id) => held.has(id))).size;
}

/** One objective's pieces: its pages in each live material, most anchored material first, capped and cut. */
export function piecesFor(o: Objective, topic: Topic | undefined, src: PieceSource): MaterialPiece[] {
  const out: MaterialPiece[] = [];
  for (const id of materialsFor(o)) {
    const material = src.materials.find((m) => m.id === id);
    const pages = src.pages[id];
    if (!material || material.heldBack || !pages?.length) continue;
    const picked = pagesFor(o, topic, material, pages);
    for (const p of picked ?? []) {
      if (out.length >= MATERIAL_FOR_RULES.piecesPerObjective) return out;
      out.push({ materialId: material.id, filename: material.filename, page: p.n, text: p.text.slice(0, MATERIAL_FOR_RULES.pieceChars) });
    }
  }
  return out;
}
