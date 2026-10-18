/**
 * How a course's topics relate: the "link" step, a focused pass over the topics' names and
 * summaries (no material), after each upload for its new topics and on demand for the whole course.
 * The model sees short refs, not ids; links to unknown or archived topics, to the topic itself or
 * repeating one the course has are dropped. Every link comes with one sentence saying why it's
 * there; a link without a usable reason, or a directional one that would close a loop, is dropped
 * with why. Links the course already has without a reason (made before reasons were kept) get the
 * reason the model gives when it returns them again. Model calls are injected; nothing here touches
 * the store.
 */
import type { Relation, Topic } from "../data.ts";
import { DIRECTIONAL, LOOP_REASON, closesLoop } from "../course/links.ts";
import { survivingTopic } from "../course/weights.ts";
import { validateText } from "../untrusted/validate.ts";
import type { CallStep } from "./run.ts";

export interface LinkTopicsInput {
  course: { name: string; short: string };
  /** The course's topics (archived and merged ones too, to follow merges). */
  topics: readonly Topic[];
  /** Topics to link (to each other and to the rest): an upload's new ones, or all of them. */
  newIds: ReadonlySet<string>;
  /** Links the course has (and any this upload already found). */
  existing: readonly Relation[];
  /** The upload the links come from; null when the whole course is linked on demand. */
  materialId: string | null;
}

export interface LinkTopicsResult {
  links: Relation[];
  /** Existing links that had no reason, with the one the model gave. */
  explained: Array<{ id: string; reason: string }>;
  /** Links the model proposed that weren't kept, with why. */
  dropped: Array<{ prompt: string; reason: string }>;
}

/** One key per link: "alternative-to" is the same either way round. */
export function linkKey(from: string, to: string, type: Relation["type"]): string {
  return type === "alternative-to" ? `${[from, to].sort().join("|")}|${type}` : `${from}|${to}|${type}`;
}

/** A link's reason after the generated-text checks, or why it can't be used. */
export function linkReason(reason: string): { ok: true; text: string } | { ok: false; reason: string } {
  const v = validateText(reason, { maxChars: 300 });
  if (!v.ok) return { ok: false, reason: `its reason ${v.reason}` };
  if (v.text.trim().length < 12) return { ok: false, reason: "it came without a reason" };
  return { ok: true, text: v.text.trim() };
}

/** The live directional links among `relations`, followed through merges (what a new link's loop check runs against). */
export function liveDirectional(relations: readonly Relation[], topics: readonly Topic[]): Array<{ from: string; to: string; type: Relation["type"] }> {
  const byId = new Map(topics.map((t) => [t.id, t]));
  const out: Array<{ from: string; to: string; type: Relation["type"] }> = [];
  for (const r of relations) {
    if (r.review === "archived" || !DIRECTIONAL.has(r.type)) continue;
    const from = survivingTopic(r.from, byId)?.id;
    const to = survivingTopic(r.to, byId)?.id;
    if (from && to && from !== to) out.push({ from, to, type: r.type });
  }
  return out;
}

export async function linkTopics(input: LinkTopicsInput, deps: { call: CallStep; newId: () => string }): Promise<LinkTopicsResult> {
  const live = input.topics.filter((t) => t.review !== "archived" && !t.mergedInto);
  const result: LinkTopicsResult = { links: [], explained: [], dropped: [] };
  if (live.length < 2 || !live.some((t) => input.newIds.has(t.id))) return result;
  const refOf = new Map(live.map((t, i) => [t.id, `t${i + 1}`]));
  const idOf = new Map(live.map((t, i) => [`t${i + 1}`, t.id]));
  const nameOf = new Map(live.map((t) => [t.id, t.name]));
  const shown = (r: Relation) => refOf.has(r.from) && refOf.has(r.to);
  const current = input.existing.filter((r) => r.review !== "archived" && shown(r));
  const out = await deps.call("link", {
    course: { name: input.course.name, short: input.course.short },
    topics: live.map((t) => ({ ref: refOf.get(t.id)!, name: t.name, summary: t.summary ?? "", isNew: input.newIds.has(t.id) })),
    existing: current.map((r) => ({ from: refOf.get(r.from)!, to: refOf.get(r.to)!, type: r.type, ...(r.reason ? {} : { needsReason: true }) })),
  });
  const existingByKey = new Map(input.existing.map((r) => [linkKey(r.from, r.to, r.type), r]));
  const seen = new Set(existingByKey.keys());
  const kept = liveDirectional(input.existing, input.topics);
  for (const l of out.links) {
    const from = idOf.get(l.from);
    const to = idOf.get(l.to);
    if (!from || !to || from === to) continue;
    const key = linkKey(from, to, l.type);
    const what = `A ${l.type} link from "${nameOf.get(from)}" to "${nameOf.get(to)}"`;
    const reason = linkReason(l.reason);
    const old = existingByKey.get(key);
    if (old) {
      if (!old.reason && reason.ok && !result.explained.some((e) => e.id === old.id)) result.explained.push({ id: old.id, reason: reason.text });
      continue;
    }
    if (seen.has(key)) continue;
    if (!reason.ok) {
      result.dropped.push({ prompt: what, reason: reason.reason });
      continue;
    }
    if (DIRECTIONAL.has(l.type) && closesLoop(kept, from, to)) {
      result.dropped.push({ prompt: what, reason: LOOP_REASON });
      continue;
    }
    seen.add(key);
    if (DIRECTIONAL.has(l.type)) kept.push({ from, to, type: l.type });
    result.links.push({ id: deps.newId(), from, to, type: l.type, anchor: null, review: "proposed", materialId: input.materialId, reason: reason.text });
  }
  return result;
}
