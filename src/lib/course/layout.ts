/** Where a course's topics sit on its trail. Pure: the store and the server's jobs both use it. */
import { type Topic, defaultTopicPositions, trailTopics } from "../data.ts";

/** Lay the visible topics out again; archived ones keep their old spot. */
export function laidOut(topics: Topic[]): Topic[] {
  const visible = trailTopics({ topics });
  const positions = defaultTopicPositions(visible.length);
  const posOf = new Map(visible.map((t, i) => [t.id, positions[i]]));
  return topics.map((t) => ({ ...t, pos: posOf.get(t.id) ?? t.pos }));
}
