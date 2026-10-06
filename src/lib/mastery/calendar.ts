/** Scheduled reviews as calendar entries, derived from each course's agenda (never stored). Pure. */
import type { CalendarEvent } from "../data.ts";
import { addDays, type CourseAgenda } from "./agenda.ts";
import type { ObjectiveState } from "./types.ts";

export interface ReviewCourse {
  id: string;
  short: string;
  agenda: CourseAgenda;
  objectives: ReadonlyMap<string, ObjectiveState>;
}

/**
 * Per course: today's quick review (what's due now), a quick review on each later day a mastered
 * objective's spaced check comes due, the deep review on its day (today when it's overdue), and
 * re-quizzes from poor sessions.
 */
export function reviewDates(courses: readonly ReviewCourse[], today: string, dayKey: (iso: string) => string): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  const plural = (n: number) => `${n} ${n === 1 ? "objective" : "objectives"}`;
  for (const c of courses) {
    const { agenda } = c;
    const add = (date: string, what: string, title: string) => out.push({ id: `review:${c.id}:${what}:${date}`, date, kind: "rev", title, courseId: c.id });

    if (agenda.dueToday.length) add(today, "quick", `${c.short} quick review · ${plural(agenda.dueToday.length)}`);
    const later = new Map<string, number>();
    for (const r of agenda.ranked) {
      const dueAt = c.objectives.get(r.objectiveId)?.dueAt;
      if (r.status !== "mastered" || !dueAt) continue;
      const day = dayKey(dueAt);
      if (day > today) later.set(day, (later.get(day) ?? 0) + 1);
    }
    for (const [day, n] of later) add(day, "quick", `${c.short} quick review · ${plural(n)}`);

    const deep = agenda.deepReview.dueDay;
    if (deep) add(deep < today ? today : deep, "deep", `${c.short} Dive in`);

    for (const when of ["today", "tomorrow"] as const) {
      if (agenda.study.some((s) => s.requiz === when)) add(when === "today" ? today : addDays(today, 1), "requiz", `${c.short} re-quiz`);
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}
