/**
 * How a course's topics relate: the "link" step, a focused pass over the topics' names and
 * summaries (no material), after each upload for its new topics and on demand for the whole course.
 * The model sees short refs, not ids; links to unknown or archived topics, to the topic itself or
 * repeating one the course has are dropped. Model calls are injected; nothing here touches the store.
 */
import type { Relation, Topic } from "../data.ts";
import type { CallStep } from "./run.ts";

export interface LinkTopicsInput {
  course: { name: string; short: string };
  /** The course's live topics. */
  topics: readonly Topic[];
  /** Topics to link (to each other and to the rest): an upload's new ones, or all of them. */
  newIds: ReadonlySet<string>;
  /** Links the course has (and any this upload already found). */
  existing: readonly Relation[];
  /** The upload the links come from; null when the whole course is linked on demand. */
  materialId: string | null;
}

/** One key per link: "alternative-to" is the same either way round. */
export function linkKey(from: string, to: string, type: Relation["type"]): string {
  return type === "alternative-to" ? `${[from, to].sort().join("|")}|${type}` : `${from}|${to}|${type}`;
}

export async function linkTopics(input: LinkTopicsInput, deps: { call: CallStep; newId: () => string }): Promise<Relation[]> {
  const live = input.topics.filter((t) => t.review !== "archived" && !t.mergedInto);
  if (live.length < 2 || !live.some((t) => input.newIds.has(t.id))) return [];
  const refOf = new Map(live.map((t, i) => [t.id, `t${i + 1}`]));
  const idOf = new Map(live.map((t, i) => [`t${i + 1}`, t.id]));
  const shown = (r: Relation) => refOf.has(r.from) && refOf.has(r.to);
  const out = await deps.call("link", {
    course: { name: input.course.name, short: input.course.short },
    topics: live.map((t) => ({ ref: refOf.get(t.id)!, name: t.name, summary: t.summary ?? "", isNew: input.newIds.has(t.id) })),
    existing: input.existing.filter((r) => r.review !== "archived" && shown(r)).map((r) => ({ from: refOf.get(r.from)!, to: refOf.get(r.to)!, type: r.type })),
  });
  const seen = new Set(input.existing.map((r) => linkKey(r.from, r.to, r.type)));
  const links: Relation[] = [];
  for (const l of out.links) {
    const from = idOf.get(l.from);
    const to = idOf.get(l.to);
    if (!from || !to || from === to) continue;
    const key = linkKey(from, to, l.type);
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ id: deps.newId(), from, to, type: l.type, anchor: null, review: "proposed", materialId: input.materialId });
  }
  return links;
}
