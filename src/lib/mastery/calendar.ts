/** Scheduled reviews as calendar entries, derived from each course's agenda (never stored). Pure. */
import type { CalendarEvent } from "../data.ts";
import type { CourseAgenda } from "./agenda.ts";
import type { ObjectiveState } from "./types.ts";

export interface ReviewCourse {
  id: string;
  short: string;
  agenda: CourseAgenda;
  objectives: ReadonlyMap<string, ObjectiveState>;
}

/**
 * Per course: today's quick review when the cadence has one due, the next quick review with what's
 * waiting for it (objectives practiced or missed today, and today's if today has no review), a quick
 * review on each later day a mastered objective's spaced check comes due, and the deep review on its
 * day (today when it's overdue).
 */
export function reviewDates(courses: readonly ReviewCourse[], today: string, dayKey: (iso: string) => string): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  const plural = (n: number) => `${n} ${n === 1 ? "objective" : "objectives"}`;
  for (const c of courses) {
    const { agenda } = c;
    const add = (date: string, what: string, title: string) => out.push({ id: `review:${c.id}:${what}:${date}`, date, kind: "rev", title, courseId: c.id });

    if (agenda.quickReviewDue) add(today, "quick", `${c.short} quick review · ${plural(agenda.dueToday.length)}`);
    const later = new Map<string, number>();
    const waiting = agenda.heldForNext.length + (agenda.quickReviewDue ? 0 : agenda.dueToday.length);
    if (waiting && agenda.nextQuickDay) later.set(agenda.nextQuickDay, waiting);
    for (const r of agenda.ranked) {
      const dueAt = c.objectives.get(r.objectiveId)?.dueAt;
      if (r.status !== "mastered" || !dueAt) continue;
      const day = dayKey(dueAt);
      if (day > today) later.set(day, (later.get(day) ?? 0) + 1);
    }
    for (const [day, n] of later) add(day, "quick", `${c.short} quick review · ${plural(n)}`);

    const deep = agenda.deepReview.dueDay;
    if (deep) add(deep < today ? today : deep, "deep", `${c.short} Dive in`);
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}
