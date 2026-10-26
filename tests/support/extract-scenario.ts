/**
 * Answers the map and objectives steps from one extract-shaped scenario (whole-file topics with a
 * slide range, objectives with a topicRef), so unit tests and e2e/fake-anthropic.ts describe what a
 * file holds once and get it back part by part and topic by topic. Pure.
 */
import type { MapOutput, ObjectivesOutput } from "../../src/lib/pipeline/schemas.ts";

type ScenarioObjective = ObjectivesOutput["objectives"][number] & { topicRef: string };

/** What a whole file holds: topics with a slide range, objectives naming their topic. */
export interface ExtractOutput {
  topics: Array<{ localId: string; existingId: string | null; name: string; summary: string; slideStart: number; slideEnd: number }>;
  objectives: ScenarioObjective[];
  relations: MapOutput["relations"];
  instructionsFound: string[];
}

export type ExtractScenario = Partial<ExtractOutput>;

/** The topics whose range meets this part's pages, clipped to them; relations and instructions with the first part only. */
export function mapAnswer(s: ExtractScenario, input: { pages: ReadonlyArray<{ n: number }>; part: { index: number } }): MapOutput {
  const ns = input.pages.map((p) => p.n);
  const lo = Math.min(...ns);
  const hi = Math.max(...ns);
  const topics = (s.topics ?? [])
    .map((t) => ({ t, from: Math.max(t.slideStart, lo), to: Math.min(Math.max(t.slideStart, t.slideEnd), hi) }))
    .filter((x) => x.from <= x.to)
    .map(({ t, from, to }) => ({ localId: t.localId, existingId: t.existingId, name: t.name, summary: t.summary, pages: [{ from, to }] }));
  const first = input.part.index === 1;
  return { topics, relations: first ? (s.relations ?? []) : [], instructionsFound: first ? (s.instructionsFound ?? []) : [] };
}

/** The scenario's objectives for this topic: named by its existing id, or (a new topic) by its name. */
export function objectivesAnswer(s: ExtractScenario, input: { topic: { id: string; name: string } }): ObjectivesOutput {
  const refs = new Set([input.topic.id, ...(s.topics ?? []).filter((t) => t.name === input.topic.name).flatMap((t) => [t.localId, ...(t.existingId ? [t.existingId] : [])])]);
  return {
    objectives: (s.objectives ?? [])
      .filter((o) => refs.has(o.topicRef))
      .map((o) => ({ localId: o.localId, existingId: o.existingId, name: o.name, description: o.description, origin: o.origin, places: o.places, emphasis: o.emphasis })),
  };
}
