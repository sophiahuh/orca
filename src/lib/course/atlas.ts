/**
 * The Concept Atlas (Figma: 12 · Concept Atlas, 105:47; Concept Atlas · Design spec). A course's
 * units (its topics, in trail order) are concentric rings, unit 1 innermost; its concepts (live
 * objectives) sit on their unit's ring. Relations now link topics (2026-10-06), so links between
 * concepts only appear once the Atlas draws topics as its nodes (the next UI step). What
 * each concept shows comes from its derived state: mastered, building (learning), review (fading,
 * mixed up or retired) or not started. Pure: the layout is a function of the structure, so the
 * screen is the same for the same course, and nothing here is stored.
 */
import type { Objective, Relation, RelationType, Topic } from "../data.ts";
import type { ObjectiveState } from "../mastery/types.ts";

export const ATLAS_W = 854;
export const ATLAS_H = 834;
/** The rings' centre in the canvas (the Figma frame's rings, 88 px below the top bar). */
export const ATLAS_CENTRE = { x: 430, y: 445 } as const;
/** Ring radii: unit 1 innermost (120) to the outermost (345), as drawn for four units. */
export const RING_MIN = 120;
export const RING_MAX = 345;

export type ConceptMastery = "mastered" | "building" | "review" | "not-started";

export const MASTERY_LABEL: Record<ConceptMastery, string> = {
  mastered: "Mastered",
  building: "Building",
  review: "Review",
  "not-started": "Not started",
};

/** What a concept pill and the legend show for an objective's state. */
export function conceptMastery(state: ObjectiveState | undefined): ConceptMastery {
  if (!state || state.status === "unseen") return "not-started";
  if (state.status === "mastered") return "mastered";
  if (state.status === "learning") return "building";
  return "review";
}

export type LinkKind = "prerequisite" | "related";

export const LINK_LABEL: Record<LinkKind, string> = { prerequisite: "Prerequisite", related: "Related" };

/** used-in is drawn as a prerequisite; the other kinds as related. */
export function linkKind(type: RelationType): LinkKind {
  return type === "used-in" ? "prerequisite" : "related";
}

export interface AtlasUnit {
  topic: Topic;
  /** 1-based, in trail order. */
  index: number;
  radius: number;
}

export interface AtlasConcept {
  objective: Objective;
  unit: number;
  x: number;
  y: number;
  mastery: ConceptMastery;
}

export interface AtlasLink {
  id: string;
  from: string;
  to: string;
  kind: LinkKind;
  type: RelationType;
}

export interface AtlasLayout {
  units: AtlasUnit[];
  concepts: AtlasConcept[];
  links: AtlasLink[];
}

export interface AtlasInput {
  /** The course's topics in trail order (archived ones already left out). */
  topics: readonly Topic[];
  objectives: Readonly<Record<string, Objective>>;
  relations: readonly Relation[];
  states: ReadonlyMap<string, ObjectiveState>;
}

/** Ring radii for `n` units, innermost first. */
export function ringRadii(n: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [Math.round((RING_MIN + RING_MAX) / 2)];
  return Array.from({ length: n }, (_, i) => Math.round(RING_MIN + (i * (RING_MAX - RING_MIN)) / (n - 1)));
}

/** A live objective: not archived and not merged into another. */
export function liveObjectives(objectives: Readonly<Record<string, Objective>>): Objective[] {
  return Object.values(objectives).filter((o) => o.review !== "archived" && !o.mergedInto);
}

export function atlasLayout({ topics, objectives, relations, states }: AtlasInput): AtlasLayout {
  const radii = ringRadii(topics.length);
  const units: AtlasUnit[] = topics.map((topic, i) => ({ topic, index: i + 1, radius: radii[i] }));
  const unitOf = new Map(units.map((u) => [u.topic.id, u]));
  const live = liveObjectives(objectives).filter((o) => unitOf.has(o.topicId));
  const concepts: AtlasConcept[] = [];
  for (const unit of units) {
    const mine = live.filter((o) => o.topicId === unit.topic.id).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    // Spread around the ring; each ring starts at a different angle so pills on neighbouring rings
    // don't line up, and the start keeps clear of the title in the top-left corner.
    const start = -Math.PI / 2 + unit.index * 0.65;
    mine.forEach((objective, i) => {
      const angle = start + (i * 2 * Math.PI) / mine.length;
      concepts.push({
        objective,
        unit: unit.index,
        x: Math.round(ATLAS_CENTRE.x + unit.radius * Math.cos(angle)),
        y: Math.round(ATLAS_CENTRE.y + unit.radius * Math.sin(angle)),
        mastery: conceptMastery(states.get(objective.id)),
      });
    });
  }
  const shown = new Set(concepts.map((c) => c.objective.id));
  const links: AtlasLink[] = relations
    .filter((r) => r.review !== "archived" && shown.has(r.from) && shown.has(r.to) && r.from !== r.to)
    .map((r) => ({ id: r.id, from: r.from, to: r.to, kind: linkKind(r.type), type: r.type }));
  return { units, concepts, links };
}

/** The concepts connected to one, with how (for the panel's "Connected concepts"). */
export function connectedConcepts(conceptId: string, layout: AtlasLayout): Array<{ concept: AtlasConcept; kind: LinkKind; direction: "from" | "to" }> {
  const byId = new Map(layout.concepts.map((c) => [c.objective.id, c]));
  const out: Array<{ concept: AtlasConcept; kind: LinkKind; direction: "from" | "to" }> = [];
  for (const l of layout.links) {
    if (l.from === conceptId) out.push({ concept: byId.get(l.to)!, kind: l.kind, direction: "to" });
    else if (l.to === conceptId) out.push({ concept: byId.get(l.from)!, kind: l.kind, direction: "from" });
  }
  // Prerequisites first, then by name.
  return out.sort((a, b) => (a.kind === b.kind ? a.concept.objective.name.localeCompare(b.concept.objective.name) : a.kind === "prerequisite" ? -1 : 1));
}
