"use client";

import type { Cadence, ClassMeeting, Weekday } from "@/lib/data";
import { PER_WEEK, WEEKDAY_NAMES, reviewWeekdays } from "@/lib/mastery/review-days";
import { cn } from "@/lib/cn";

const WEEK: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 0];
const SHORT = ["Su", "M", "Tu", "W", "Th", "F", "Sa"] as const;

/**
 * The weekdays a "Twice a week" or "Weekly" review falls on: the day before class by default, or the
 * student's own. Picking past the cadence's count drops the earliest pick; clearing them all goes
 * back to the default.
 */
export function ReviewDays({ label, cadence, picked, meetings, onChange }: { label: string; cadence: Cadence; picked: Weekday[] | null; meetings: readonly ClassMeeting[]; onChange: (days: Weekday[] | null) => void }) {
  if (cadence !== "Twice a week" && cadence !== "Weekly") return null;
  const per = PER_WEEK[cadence];
  const days = reviewWeekdays(cadence, picked, meetings);
  const mine = picked !== null && picked.length > 0;
  const toggle = (d: Weekday) => {
    const base = mine ? picked.slice(-per) : days ?? [];
    const next = base.includes(d) ? base.filter((x) => x !== d) : [...base, d].slice(-per);
    onChange(next.length > 0 ? next : null);
  };
  const note = mine
    ? "On the days you picked."
    : days
      ? per > 1 && new Set(meetings.map((m) => m.day)).size < per
        ? "The day before class, and 3 days later."
        : "The day before class."
      : `Every ${cadence === "Weekly" ? 7 : 3} days after your last one. Add class times, or pick ${per === 1 ? "a day" : "days"}.`;
  return (
    <div className="flex flex-col gap-[6px] pl-[46px]" data-part="review-days" data-review={label}>
      <div className="flex items-center gap-[14px]">
        <span className="w-[120px] shrink-0 text-[14px] font-semibold text-wisteria-deep">{per === 1 ? "On" : `On (${per} days)`}</span>
        <div role="group" aria-label={`${label} days`} className="flex gap-[6px]">
          {WEEK.map((d) => {
            const on = days?.includes(d) ?? false;
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                aria-label={WEEKDAY_NAMES[d]}
                onClick={() => toggle(d)}
                className={cn(
                  "pressable h-[34px] w-[38px] rounded-[10px] border-2 text-[13px] font-bold lip-3",
                  on ? "border-wisteria-deep bg-wisteria text-parchment lip-wisteria" : "border-alice-deep bg-alice text-prussian lip-alice",
                )}
              >
                {SHORT[d]}
              </button>
            );
          })}
        </div>
      </div>
      <p className="pl-[134px] text-[13px] font-medium text-wisteria-deep">
        {note}
        {mine && (
          <button type="button" onClick={() => onChange(null)} className="ml-[8px] font-bold underline">
            {meetings.length > 0 ? "Use the day before class" : "Clear"}
          </button>
        )}
      </p>
    </div>
  );
}
