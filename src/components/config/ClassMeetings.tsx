"use client";

import type { ClassMeeting, Weekday } from "@/lib/data";
import { LIMITS } from "@/lib/limits";
import { WEEKDAY_NAMES } from "@/lib/mastery/review-days";
import { IconClose, IconPlus } from "@/components/icons";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";

const DAY_OPTIONS = ["1", "2", "3", "4", "5", "6", "0"] as const;
const DAY_LABELS = Object.fromEntries(DAY_OPTIONS.map((d) => [d, WEEKDAY_NAMES[Number(d)]])) as Record<(typeof DAY_OPTIONS)[number], string>;

/** A meeting the student is still filling in is fine to show; one that ends before it starts can't be saved. */
export function meetingProblem(meetings: readonly ClassMeeting[]): string | null {
  return meetings.some((m) => !m.start || !m.end || m.start >= m.end) ? "Each class time needs a start before its end." : null;
}

function TimeInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="time"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-[40px] rounded-[12px] border-2 border-periwinkle-deep bg-parchment px-[10px] text-[15px] font-bold text-prussian lip-3 lip-periwinkle focus:outline-none"
    />
  );
}

/** When a class meets each week: a weekday and a start and end time per meeting. */
export function ClassMeetings({ meetings, onChange }: { meetings: ClassMeeting[]; onChange: (m: ClassMeeting[]) => void }) {
  const set = (i: number, m: ClassMeeting) => onChange(meetings.map((x, j) => (j === i ? m : x)));
  const last = meetings.at(-1);
  return (
    <div className="flex flex-col gap-[10px]" data-part="class-meetings">
      {meetings.map((m, i) => (
        <div key={i} className="flex items-center gap-[10px]">
          <Select label={`Class ${i + 1} day`} value={String(m.day) as (typeof DAY_OPTIONS)[number]} options={DAY_OPTIONS} labels={DAY_LABELS} onChange={(d) => set(i, { ...m, day: Number(d) as Weekday })} className="w-[150px]" />
          <TimeInput label={`Class ${i + 1} starts`} value={m.start} onChange={(start) => set(i, { ...m, start })} />
          <span className="text-[14px] font-semibold text-wisteria-deep">to</span>
          <TimeInput label={`Class ${i + 1} ends`} value={m.end} onChange={(end) => set(i, { ...m, end })} />
          <button type="button" aria-label={`Remove class ${i + 1}`} onClick={() => onChange(meetings.filter((_, j) => j !== i))} className="pressable flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-[10px] bg-alice text-wisteria-deep">
            <IconClose size={16} />
          </button>
        </div>
      ))}
      {meetings.length < LIMITS.classMeetings && (
        <Button
          size="sm"
          variant="ghost"
          className="self-start"
          icon={<IconPlus size={16} />}
          // A new row copies the last one's times (classes usually share them) on the next weekday.
          onClick={() => onChange([...meetings, last ? { ...last, day: ((last.day + 2) % 7) as Weekday } : { day: 1, start: "10:00", end: "11:15" }])}
        >
          Add a class time
        </Button>
      )}
    </div>
  );
}
