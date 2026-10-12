/**
 * Cheap duplicate detection for topics and objectives, run before any model call: exact name and
 * alias matches (including rejected and merged-away items), then a shortlist of the closest
 * existing items for the reconciliation call to judge.
 */
import type { Review } from "../data.ts";

export interface Named {
  id: string;
  name: string;
  aliases: string[];
  review: Review;
  mergedInto?: string;
  description?: string;
}

/** Lowercase, "&" as "and", punctuation and apostrophes dropped, plurals singular: "K-Maps" → "k map". */
export function normaliseName(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .join(" ");
}

export type ExactMatch = { kind: "live"; id: string } | { kind: "rejected"; id: string };

/**
 * An existing item with one of `names` as its name or alias. A merged-away item stands for its
 * survivor. A live match wins over a rejected one; a rejected match means "don't propose it again".
 */
export function exactMatch(names: readonly string[], items: readonly Named[]): ExactMatch | null {
  const wanted = new Set(names.map(normaliseName).filter(Boolean));
  const byId = new Map(items.map((i) => [i.id, i]));
  const survivorOf = (item: Named): Named => {
    let current = item;
    for (let n = 0; n < 50 && current.mergedInto; n++) {
      const next = byId.get(current.mergedInto);
      if (!next) throw new Error(`"${current.id}" was merged into "${current.mergedInto}", which doesn't exist`);
      current = next;
    }
    return current;
  };
  let rejected: ExactMatch | null = null;
  for (const item of items) {
    if (![item.name, ...item.aliases].some((n) => wanted.has(normaliseName(n)))) continue;
    const target = survivorOf(item);
    if (target.review !== "archived") return { kind: "live", id: target.id };
    rejected ??= { kind: "rejected", id: target.id };
  }
  return rejected;
}

function tokens(item: Pick<Named, "name" | "aliases" | "description">): Set<string> {
  const text = [item.name, ...item.aliases, item.description ?? ""].join(" ");
  return new Set(normaliseName(text).split(" ").filter((w) => w.length > 2));
}

/**
 * The `n` existing items most like `candidate` by shared words (names, aliases, description), for
 * the reconciliation call. Rejected items are included so "same as something rejected" can be
 * caught; merged-away ones are left out (their names live on as the survivor's aliases).
 */
export function shortlist(candidate: Pick<Named, "name" | "aliases" | "description">, items: readonly Named[], n = 8): Named[] {
  const mine = tokens(candidate);
  return items
    .filter((i) => !i.mergedInto)
    .map((item) => {
      const theirs = tokens(item);
      const shared = [...mine].filter((w) => theirs.has(w)).length;
      const union = new Set([...mine, ...theirs]).size;
      return { item, score: union ? shared / union : 0 };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((x) => x.item);
}
