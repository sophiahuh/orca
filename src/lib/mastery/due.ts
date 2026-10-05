/** Which topics have reviews due today or tomorrow, from objective due times. */
import type { CourseMastery } from "./course-mastery.ts";
import { localDayKey } from "./objective-state.ts";

export interface DueTopic {
  courseId: string;
  topicId: string;
  when: "today" | "tomorrow";
  objectiveIds: string[];
}

const DAY_MS = 86_400_000;

export function dueTopics(
  courseId: string,
  mastery: Pick<CourseMastery, "objectives" | "topicObjectives">,
  now: Date,
  dayKey: (iso: string) => string = localDayKey,
): DueTopic[] {
  const today = dayKey(now.toISOString());
  // Add the day from local noon so a 23/25-hour daylight-saving day can't land on the same date (same as streak.ts).
  const noon = new Date(now);
  noon.setHours(12, 0, 0, 0);
  const tomorrow = dayKey(new Date(noon.getTime() + DAY_MS).toISOString());
  const out: DueTopic[] = [];
  for (const [topicId, ids] of mastery.topicObjectives) {
    const buckets = { today: [] as string[], tomorrow: [] as string[] };
    for (const id of ids) {
      const s = mastery.objectives.get(id);
      if (!s) throw new Error(`No state computed for objective ${id}`);
      if (s.dueAt === null || s.status === "retired") continue;
      const day = dayKey(s.dueAt);
      if (Date.parse(s.dueAt) <= now.getTime() || day === today) buckets.today.push(id);
      else if (day === tomorrow) buckets.tomorrow.push(id);
    }
    for (const when of ["today", "tomorrow"] as const) {
      if (buckets[when].length > 0) out.push({ courseId, topicId, when, objectiveIds: buckets[when] });
    }
  }
  return out;
}
