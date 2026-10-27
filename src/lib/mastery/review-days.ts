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

/**
 * The day before each of the week's first classes, one per review. A class that meets on one day a
 * week reviewed twice a week: the day before class and 3 days later (owner, 2026-10-27). Null
 * without meetings.
 */
export function defaultReviewDays(cadence: keyof typeof PER_WEEK, meetings: readonly ClassMeeting[]): Weekday[] | null {
  const before = meetingDays(meetings).map((d) => ((d + 6) % 7) as Weekday);
  if (before.length === 0) return null;
  const days = before.length >= PER_WEEK[cadence] ? before.slice(0, PER_WEEK[cadence]) : [before[0], ((before[0] + 3) % 7) as Weekday];
  return MONDAY_FIRST.filter((d) => days.includes(d));
}

/**
 * The weekdays a review on this cadence falls on: the student's pick, else the day before class.
 * Null when the cadence doesn't sit on weekdays (Daily, the exam cadence), or there's neither a pick
 * nor a meeting; then the review rolls on from the last one finished.
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

/** The quick-review cadence that follows a class (owner, 2026-10-27): twice a week whenever it meets; null without meetings. */
export function classCadence(meetings: readonly ClassMeeting[]): keyof typeof PER_WEEK | null {
  return meetings.length > 0 ? "Twice a week" : null;
}
