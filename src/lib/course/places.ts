/** Where a topic is taught: page ranges per material, across uploads (`topics.source`). Pure. */
import type { TopicPlace } from "../data.ts";

export type PageRange = { from: number; to: number };

/** Contiguous ranges of a set of page numbers. */
export function toRanges(pages: Iterable<number>): PageRange[] {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const out: PageRange[] = [];
  for (const n of sorted) {
    const last = out.at(-1);
    if (last && n <= last.to + 1) last.to = Math.max(last.to, n);
    else out.push({ from: n, to: n });
  }
  return out;
}

/** The page numbers `places` cover in one material. */
export function pagesIn(places: readonly TopicPlace[], materialId: string): Set<number> {
  const out = new Set<number>();
  for (const p of places) if (p.materialId === materialId) for (let n = p.from; n <= p.to; n++) out.add(n);
  return out;
}

/** `places` with `ranges` in `materialId` added: overlapping or touching ranges merge; materials keep the order they first appear in. */
export function addRanges(places: readonly TopicPlace[], materialId: string, ranges: readonly PageRange[]): TopicPlace[] {
  const pages = pagesIn(places, materialId);
  for (const r of ranges) for (let n = Math.min(r.from, r.to); n <= Math.max(r.from, r.to); n++) pages.add(n);
  const merged = toRanges(pages).map((r) => ({ materialId, ...r }));
  const out: TopicPlace[] = [];
  let placed = false;
  for (const p of places) {
    if (p.materialId !== materialId) out.push(p);
    else if (!placed) {
      out.push(...merged);
      placed = true;
    }
  }
  if (!placed) out.push(...merged);
  return out;
}

/** Every place of both lists (a topic merge). */
export function unionPlaces(a: readonly TopicPlace[], b: readonly TopicPlace[]): TopicPlace[] {
  let out = [...a];
  for (const p of b) out = addRanges(out, p.materialId, [{ from: p.from, to: p.to }]);
  return out;
}

/** "L3.pdf p4–9, 14; HW2.pdf p1–2"; files the course no longer has are left out. */
export function describePlaces(places: readonly TopicPlace[], filenames: ReadonlyMap<string, string>): string {
  const byMaterial = new Map<string, string[]>();
  for (const p of places) {
    if (!filenames.has(p.materialId)) continue;
    byMaterial.set(p.materialId, [...(byMaterial.get(p.materialId) ?? []), p.from === p.to ? `${p.from}` : `${p.from}–${p.to}`]);
  }
  return [...byMaterial].map(([id, rs]) => `${filenames.get(id)} p${rs.join(", ")}`).join("; ");
}
