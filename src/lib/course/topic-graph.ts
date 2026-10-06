/**
 * The Concept Atlas as a topic graph (Figma: E1 · Concept graph v4, foundations on top). A course's
 * live topics are the nodes; its relations are the edges. A topic sits above the topics it's used
 * in and the kinds it has, so foundations are on top; a node is bigger the more topics it's used
 * in. Each node shows how well its topic is held, from its objectives' derived state. Pure: the
 * layout is a function of the structure, so the same course always draws the same way.
 */
import type { Relation, RelationType, Topic } from "../data.ts";
import type { ObjectiveState } from "../mastery/types.ts";
import { survivingTopic, topicUses } from "./weights.ts";

/** How well a topic is held: every objective mastered, some fading or mixed up, under way, or nothing answered yet. */
export type TopicStrength = "strong" | "developing" | "fragile" | "unverified";

export const STRENGTH_LABEL: Record<TopicStrength, string> = { strong: "Strong", developing: "Developing", fragile: "Fragile", unverified: "New" };

export const RELATION_LABEL: Record<RelationType, string> = { "used-in": "used in", "has-a-kind": "has a kind", "alternative-to": "alternative to", related: "related" };

export function topicStrength(objectiveIds: readonly string[], states: ReadonlyMap<string, ObjectiveState>): TopicStrength {
  const seen = objectiveIds.map((id) => states.get(id)).filter((s): s is ObjectiveState => !!s && s.status !== "unseen");
  if (seen.length === 0) return "unverified";
  if (seen.some((s) => s.status === "fading" || s.status === "mixed-up")) return "fragile";
  if (seen.length === objectiveIds.length && seen.every((s) => s.status === "mastered" || s.status === "retired")) return "strong";
  return "developing";
}

export const GRAPH = {
  /** Least canvas width; wider when a row holds more topics. */
  minWidth: 640,
  /** Room at the sides for the outermost names. */
  side: 60,
  /** Horizontal room per topic in a row. */
  slot: 130,
  /** Names wrap at about this many characters a line, at most `labelLines` lines. */
  labelChars: 20,
  labelLines: 3,
  /** Name: gap under the circle, line height. */
  labelGap: 8,
  lineHeight: 13,
  /** Space above the first row (the title sits there) and between rows. */
  top: 150,
  rowGap: 165,
  bottom: 80,
  /** Node radius: base, plus a step per topic it's used in, up to `maxUses`. */
  radius: 15,
  radiusStep: 5,
  maxUses: 4,
} as const;

export interface GraphNode {
  topic: Topic;
  x: number;
  y: number;
  r: number;
  row: number;
  /** Other topics it's used in. */
  usedIn: number;
  /** Kinds it has. */
  kinds: number;
  /** Topics it's an alternative to. */
  alternatives: number;
  strength: TopicStrength;
  /** The name, wrapped (drawn under the circle; edges leave from under it). */
  lines: string[];
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  type: RelationType;
  /** SVG path, from the edge of one node to the edge of the other. */
  d: string;
  /** Where its label sits: most of the way along, near the arrow, so a topic's edges' labels spread out. */
  mid: { x: number; y: number };
}

export interface TopicGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
}

export interface TopicGraphInput {
  /** Every topic of the course (archived and merged ones too, to follow merges). */
  topics: readonly Topic[];
  /** The live topics in trail order: the nodes. */
  live: readonly Topic[];
  relations: readonly Relation[];
  strengthOf: (topicId: string) => TopicStrength;
}

/** Edges that put `to` below `from`: what it's used in, and its kinds. */
const DOWNWARD: ReadonlySet<RelationType> = new Set(["used-in", "has-a-kind"]);

export function topicGraph({ topics, live, relations, strengthOf }: TopicGraphInput): TopicGraph {
  const byId = new Map(topics.map((t) => [t.id, t]));
  const liveIds = new Set(live.map((t) => t.id));

  /* Edges between live topics, through merges, once each ("alternative-to" in either direction is one). */
  const seen = new Set<string>();
  const links: Array<{ id: string; from: string; to: string; type: RelationType }> = [];
  for (const r of relations) {
    if (r.review === "archived") continue;
    const from = survivingTopic(r.from, byId)?.id;
    const to = survivingTopic(r.to, byId)?.id;
    if (!from || !to || from === to || !liveIds.has(from) || !liveIds.has(to)) continue;
    const key = r.type === "alternative-to" ? `${[from, to].sort().join("|")}|${r.type}` : `${from}|${to}|${r.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ id: r.id, from, to, type: r.type });
  }

  /* Rows: the longest chain of downward edges above each topic (bounded, so a cycle can't run away). */
  const row = new Map(live.map((t) => [t.id, 0]));
  const down = links.filter((l) => DOWNWARD.has(l.type));
  for (let pass = 0; pass < live.length; pass++) {
    let changed = false;
    for (const l of down) {
      const next = row.get(l.from)! + 1;
      if (next > row.get(l.to)! && next < live.length) {
        row.set(l.to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }

  /* Order inside each row: trail order, then each topic under the average place of what's above it. */
  const rows: string[][] = [];
  for (const t of live) (rows[row.get(t.id)!] ??= []).push(t.id);
  const placeIn = new Map<string, number>();
  rows.forEach((ids) => ids.forEach((id, i) => placeIn.set(id, (i + 0.5) / ids.length)));
  for (let r = 1; r < rows.length; r++) {
    const ids = rows[r];
    if (!ids) continue;
    const parentPlace = (id: string) => {
      const ps = down.filter((l) => l.to === id && row.get(l.from)! < r).map((l) => placeIn.get(l.from)!);
      return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : placeIn.get(id)!;
    };
    const keyed = ids.map((id, i) => ({ id, i, p: parentPlace(id) }));
    keyed.sort((a, b) => a.p - b.p || a.i - b.i);
    rows[r] = keyed.map((k) => k.id);
    rows[r].forEach((id, i) => placeIn.set(id, (i + 0.5) / rows[r].length));
  }

  const widest = Math.max(1, ...rows.map((ids) => ids?.length ?? 0));
  const width = Math.max(GRAPH.minWidth, widest * GRAPH.slot + 2 * GRAPH.side);
  const height = GRAPH.top + Math.max(0, rows.length - 1) * GRAPH.rowGap + GRAPH.bottom;
  const uses = topicUses(topics, relations);
  const nodes: GraphNode[] = live.map((topic) => {
    const usedIn = uses.get(topic.id)?.size ?? 0;
    return {
      topic,
      x: Math.round(GRAPH.side + placeIn.get(topic.id)! * (width - 2 * GRAPH.side)),
      y: GRAPH.top + row.get(topic.id)! * GRAPH.rowGap,
      r: GRAPH.radius + GRAPH.radiusStep * Math.min(usedIn, GRAPH.maxUses),
      row: row.get(topic.id)!,
      usedIn,
      kinds: links.filter((l) => l.type === "has-a-kind" && l.from === topic.id).length,
      alternatives: links.filter((l) => l.type === "alternative-to" && (l.from === topic.id || l.to === topic.id)).length,
      strength: strengthOf(topic.id),
      lines: wrapLabel(topic.name),
    };
  });

  const at = new Map(nodes.map((n) => [n.topic.id, n]));
  const edges: GraphEdge[] = links.map((l) => ({ ...l, ...edgePath(at.get(l.from)!, at.get(l.to)!) }));
  return { nodes, edges, width, height };
}

/** Room left at an arrow's end for its head, plus a gap before the topic it points at. */
const ARROW = 15;

/** A name in lines of about `labelChars` characters, breaking at spaces; the last line ends "…" when it doesn't fit. */
export function wrapLabel(name: string, chars: number = GRAPH.labelChars, max: number = GRAPH.labelLines): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of name.split(/\s+/).filter(Boolean)) {
    if (!line) line = word;
    else if (line.length + 1 + word.length <= chars) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  kept[max - 1] = `${kept[max - 1].replace(/[\s.,;:]+$/, "")}…`;
  return kept;
}

/** Where a node's name ends below it: edges leave from here, not from the circle. */
export function labelBottom(n: Pick<GraphNode, "y" | "r" | "lines">): number {
  return n.y + n.r + GRAPH.labelGap + n.lines.length * GRAPH.lineHeight;
}

/**
 * A path from one node to another: a vertical S-curve between rows, leaving from under the upper
 * node's name and arriving at the top of the lower node's circle; a straight line within a row.
 */
/** Connect two Atlas nodes; exported so an interactive view can redraw an edge after a node moves. */
export function edgePath(a: GraphNode, b: GraphNode, labelT = 0.75): { d: string; mid: { x: number; y: number } } {
  if (a.row === b.row) {
    const dir = b.x >= a.x ? 1 : -1;
    const x1 = a.x + dir * a.r;
    const x2 = b.x - dir * (b.r + ARROW);
    return { d: `M${x1} ${a.y} L${x2} ${b.y}`, mid: { x: Math.round(x1 + (x2 - x1) * labelT), y: Math.round(a.y + (b.y - a.y) * labelT) } };
  }
  const dir = b.y > a.y ? 1 : -1;
  const p0 = { x: a.x, y: dir === 1 ? labelBottom(a) + 3 : a.y - a.r };
  const p3 = { x: b.x, y: dir === 1 ? b.y - b.r - ARROW : labelBottom(b) + 3 + ARROW };
  const cy = (p0.y + p3.y) / 2;
  const p1 = { x: p0.x, y: cy };
  const p2 = { x: p3.x, y: cy };
  // The cubic at the label position: (1−t)³P0 + 3(1−t)²t P1 + 3(1−t)t² P2 + t³P3.
  const t = labelT;
  const [a0, a1, a2, a3] = [(1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t ** 2, t ** 3];
  const mid = { x: Math.round(a0 * p0.x + a1 * p1.x + a2 * p2.x + a3 * p3.x), y: Math.round(a0 * p0.y + a1 * p1.y + a2 * p2.y + a3 * p3.y) };
  return { d: `M${p0.x} ${p0.y} C${p1.x} ${p1.y} ${p2.x} ${p2.y} ${p3.x} ${p3.y}`, mid };
}

/** What a hovered topic's tooltip says: "Used in 1 · has 2 kinds". */
export function topicSummary(n: Pick<GraphNode, "usedIn" | "kinds" | "alternatives">): string {
  const parts = [`Used in ${n.usedIn}`];
  if (n.kinds) parts.push(`has ${n.kinds} kind${n.kinds === 1 ? "" : "s"}`);
  if (n.alternatives) parts.push(`${n.alternatives} alternative${n.alternatives === 1 ? "" : "s"}`);
  return parts.join(" · ");
}
