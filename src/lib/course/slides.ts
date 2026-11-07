/**
 * Which objectives a tapped page flags (weak points first, Plan C: "Which slides were hard?").
 * Owner, 2026-11-07: a tapped slide flags whole topics. The topics are the ones taught on that page
 * of the material (its `source` ranges) and the topics of objectives whose places name that page;
 * every live objective of those topics is flagged, wherever in the course it's taught, so a slide
 * that only gives an overview of a topic still flags all of it. Rejected and merged-away objectives
 * and topics are left out. Pure.
 */
import type { Objective, Topic } from "../data.ts";
import { pagesIn } from "./places.ts";
import { locatorPages } from "./study.ts";

const live = (o: { mergedInto?: string; review: string }) => !o.mergedInto && o.review !== "archived";

function anchoredPages(o: Objective, materialId: string): Set<number> {
  return new Set(o.signals.filter((s) => s.materialId === materialId).flatMap((s) => s.places.flatMap((p) => locatorPages(p.locator))));
}

export function objectivesOnPage(materialId: string, page: number, objectives: Readonly<Record<string, Objective>>, topics: readonly Topic[]): string[] {
  const liveTopics = new Set(topics.filter(live).map((t) => t.id));
  const all = Object.values(objectives).filter((o) => live(o) && liveTopics.has(o.topicId));
  const onPage = new Set(topics.filter((t) => live(t) && pagesIn(t.source ?? [], materialId).has(page)).map((t) => t.id));
  for (const o of all) if (anchoredPages(o, materialId).has(page)) onPage.add(o.topicId);
  return all.filter((o) => onPage.has(o.topicId)).map((o) => o.id);
}
