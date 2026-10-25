import { type Course, type Objective, type QuestionRating, type QuizQuestion, trailTopics } from "@/lib/data";
import { liveObjectiveOf } from "@/lib/mastery/catalogue";

/**
 * The questions a quick review may ask in a course, by objective: not deep-review questions (asked
 * in dives only), not ones the student gave a thumbs down. The session and the sidebar's count both
 * plan from this, so the count matches what the session asks.
 */
export function askableQuestions(course: Course, bank: Record<string, QuizQuestion[]> | undefined, catalogue: Record<string, Objective>, feedback: Record<string, QuestionRating>) {
  const byId = new Map<string, QuizQuestion>();
  const byObjective = new Map<string, QuizQuestion[]>();
  const placeOf = new Map<string, { objectiveId: string; topicId: string }>();
  for (const t of trailTopics(course)) {
    for (const q of bank?.[t.id] ?? []) {
      const o = liveObjectiveOf(q, t.id, catalogue);
      if (!o || q.deep || feedback[q.id]?.rating === "down") continue;
      byId.set(q.id, q);
      byObjective.set(o.id, [...(byObjective.get(o.id) ?? []), q]);
      placeOf.set(q.id, { objectiveId: o.id, topicId: t.id });
    }
  }
  return { byId, byObjective, placeOf };
}
