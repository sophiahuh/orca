/** Where an objective is taught, as text the student can follow ("L03.pdf, slides 18–20, 24"). */
import type { Material, Objective, Topic } from "../data.ts";

/** "slide 18", "slides 19-20", "Slide 24" → "slides 18–20, 24". Locators that aren't slides are kept as written. */
export function slideRanges(locators: readonly string[]): string {
  const numbers = new Set<number>();
  const other: string[] = [];
  for (const l of locators) {
    const m = /^\s*slides?\s+(\d+)(?:\s*[–-]\s*(\d+))?\s*$/i.exec(l);
    if (!m) {
      if (!other.includes(l.trim())) other.push(l.trim());
      continue;
    }
    const from = Number(m[1]);
    const to = m[2] ? Number(m[2]) : from;
    for (let n = Math.min(from, to); n <= Math.max(from, to); n++) numbers.add(n);
  }
  const sorted = [...numbers].sort((a, b) => a - b);
  const runs: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    runs.push(i === j ? `${sorted[i]}` : `${sorted[i]}–${sorted[j]}`);
    i = j + 1;
  }
  const slides = runs.length ? `${sorted.length === 1 ? "slide" : "slides"} ${runs.join(", ")}` : "";
  return [slides, ...other].filter(Boolean).join("; ");
}

export interface TaughtIn {
  filename: string;
  where: string;
}

/**
 * The places an objective's uploads pointed at, per file. Falls back to its topic's slide range when
 * no upload recorded places (an inferred objective, or one only named by a syllabus). Empty when
 * neither exists: the caller says so instead of guessing.
 */
export function whereTaught(objective: Objective, topic: Topic | undefined, materials: readonly Material[]): TaughtIn[] {
  const byMaterial = new Map<string, string[]>();
  for (const s of objective.signals) {
    if (!s.places.length) continue;
    byMaterial.set(s.materialId, [...(byMaterial.get(s.materialId) ?? []), ...s.places.map((p) => p.locator)]);
  }
  const out: TaughtIn[] = [];
  for (const [materialId, locators] of byMaterial) {
    const filename = materials.find((m) => m.id === materialId)?.filename;
    if (!filename) throw new Error(`Objective ${objective.id} points at material ${materialId}, which isn't in the course`);
    out.push({ filename, where: slideRanges(locators) });
  }
  if (out.length === 0 && topic?.source) {
    const { filename, slideStart, slideEnd } = topic.source;
    out.push({ filename, where: slideStart === slideEnd ? `slide ${slideStart}` : `slides ${slideStart}–${slideEnd}` });
  }
  return out;
}
