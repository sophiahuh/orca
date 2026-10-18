/**
 * Rules every topic link must meet before it's saved, whoever proposes it (extraction or the link
 * step). "used-in" and "has-a-kind" put one topic below another (a prerequisite, a parent kind), so
 * together they must never form a loop: a link that would close one is dropped, not relabelled
 * (owner, 2026-10-17). Two topics have at most one link: the kind that says the most wins (owner,
 * 2026-10-17). Pure.
 */
import type { RelationType } from "../data.ts";

/** Links with a direction that orders topics (foundations above what they're used in, kinds below their parent). */
export const DIRECTIONAL: ReadonlySet<RelationType> = new Set(["used-in", "has-a-kind"]);

/** Whether a directional link from → to would close a loop with the directional links already kept (ids already followed through merges). */
export function closesLoop(kept: ReadonlyArray<{ from: string; to: string; type: RelationType }>, from: string, to: string): boolean {
  const next = new Map<string, string[]>();
  for (const l of kept) if (DIRECTIONAL.has(l.type)) (next.get(l.from) ?? next.set(l.from, []).get(l.from)!).push(l.to);
  const seen = new Set<string>([to]);
  const stack = [to];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === from) return true;
    for (const n of next.get(id) ?? []) {
      if (!seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return false;
}

/** One key per pair of topics, either way round. */
export function pairKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

/** Which kind wins when two topics get more than one link: the most specific first. */
export const KIND_RANK: Record<RelationType, number> = { "has-a-kind": 0, "used-in": 1, "alternative-to": 2, related: 3 };

/** Why a looping link was dropped, for the run record. */
export const LOOP_REASON = "would make a loop of prerequisites (each topic would have to come before the other)";
