/**
 * Which objectives a tapped page is about (weak points first, Plan C: "Which slides were hard?").
 * The objectives whose places name that page of the material; when none do, the objectives of the
 * topics taught on that page that aren't anchored anywhere else in the material. Not `pagesFor`
 * (src/lib/pipeline/topup.ts): its neighbouring pages and whole-file fallback would flag far too
 * much. Rejected and merged-away objectives and topics are left out. Pure.
 */
import type { Objective, Topic } from "../data.ts";
import { pagesIn } from "./places.ts";
import { locatorPages } from "./study.ts";

const live = (o: { mergedInto?: string; review: string }) => !o.mergedInto && o.review !== "archived";

function anchoredPages(o: Objective, materialId: string): Set<number> {
  return new Set(o.signals.filter((s) => s.materialId === materialId).flatMap((s) => s.places.flatMap((p) => locatorPages(p.locator))));
}

export function objectivesOnPage(materialId: string, page: number, objectives: Readonly<Record<string, Objective>>, topics: readonly Topic[]): string[] {
  const all = Object.values(objectives).filter(live);
  const anchored = all.filter((o) => anchoredPages(o, materialId).has(page)).map((o) => o.id);
  if (anchored.length) return anchored;
  const taughtHere = new Set(topics.filter((t) => live(t) && pagesIn(t.source ?? [], materialId).has(page)).map((t) => t.id));
  return all.filter((o) => taughtHere.has(o.topicId) && anchoredPages(o, materialId).size === 0).map((o) => o.id);
}
