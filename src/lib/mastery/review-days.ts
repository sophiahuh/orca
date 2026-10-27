/**
 * Which weekdays a course's "Twice a week" or "Weekly" quick review and dive fall on: the student's
 * pick in the course settings, else the day before the week's first classes. Pure.
 */
import type { Cadence, ClassMeeting, Weekday } from "../data.ts";

/** Reviews a week, for the cadences that can sit on weekdays. */
export const PER_WEEK = { "Twice a week": 2, Weekly: 1 } as const;

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** A week Monday first (how a student reads a class timetable). */
const MONDAY_FIRST: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 0];

/** Weekday of a YYYY-MM-DD day. */
export function weekdayOf(day: string): Weekday {
  return new Date(`${day}T00:00:00Z`).getUTCDay() as Weekday;
}

/** The weekdays the class meets, Monday first, each once. */
export function meetingDays(meetings: readonly ClassMeeting[]): Weekday[] {
  return MONDAY_FIRST.filter((d) => meetings.some((m) => m.day === d));
}

/** The day before each of the week's first classes, one per review; null when the class meets on fewer days than that. */
export function defaultReviewDays(cadence: keyof typeof PER_WEEK, meetings: readonly ClassMeeting[]): Weekday[] | null {
  const days = meetingDays(meetings).slice(0, PER_WEEK[cadence]);
  if (days.length < PER_WEEK[cadence]) return null;
  return days.map((d) => ((d + 6) % 7) as Weekday);
}

/**
 * The weekdays a review on this cadence falls on: the student's pick, else the day before class.
 * Null when the cadence doesn't sit on weekdays (Daily, the exam cadence), or there's neither a pick
 * nor enough meetings; then the review rolls on from the last one finished.
 */
export function reviewWeekdays(cadence: Cadence, picked: readonly Weekday[] | null, meetings: readonly ClassMeeting[]): Weekday[] | null {
  if (cadence !== "Twice a week" && cadence !== "Weekly") return null;
  // The latest picks (in the order picked), so days picked for "Twice a week" still fit "Weekly".
  if (picked && picked.length > 0) {
    const kept = picked.slice(-PER_WEEK[cadence]);
    return MONDAY_FIRST.filter((d) => kept.includes(d));
  }
  return defaultReviewDays(cadence, meetings);
}
