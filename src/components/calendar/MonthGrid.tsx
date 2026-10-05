"use client";

import { motion } from "motion/react";
import type { CalendarEvent } from "@/lib/data";
import { toISODate } from "@/lib/data";
import { Tag } from "@/components/ui/Tag";
import { cn } from "@/lib/cn";
import { popIn, stagger } from "@/lib/motion";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** 6×7 grid of day cells for the month containing `cursor`. */
export function MonthGrid({ cursor, events, today }: { cursor: Date; events: CalendarEvent[]; today: string }) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());

  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });

  const byDate = new Map<string, CalendarEvent[]>();
  for (const e of events) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);

  return (
    <div className="flex flex-col gap-[10px]">
      <div className="grid grid-cols-7 gap-[12px] px-[4px]">
        {WEEKDAYS.map((w) => (
          <span key={w} className="text-center text-[14px] font-semibold text-wisteria-deep">
            {w}
          </span>
        ))}
      </div>
      <motion.div key={toISODate(first)} variants={stagger(0.02, 0.012)} initial="hidden" animate="show" className="grid grid-cols-7 gap-[12px]">
        {days.map((d) => {
          const iso = toISODate(d);
          const inMonth = d.getMonth() === cursor.getMonth();
          const isToday = iso === today;
          const evs = byDate.get(iso) ?? [];
          return (
            <motion.div
              key={iso}
              variants={popIn}
              data-today={isToday || undefined}
              className={cn(
                "flex h-[104px] flex-col gap-[4px] rounded-[18px] border-2 p-[8px]",
                inMonth ? "border-alice-deep bg-parchment lip-3 lip-alice" : "border-transparent bg-alice-deep/35",
              )}
            >
              <span
                className={cn(
                  "flex h-[26px] w-[26px] items-center justify-center rounded-pill text-[14px] font-bold",
                  isToday ? "bg-wisteria text-parchment" : inMonth ? "text-prussian" : "text-periwinkle-deep",
                )}
              >
                {d.getDate()}
              </span>
              <div className="flex min-h-0 flex-col gap-[4px] overflow-hidden">
                {evs.slice(0, 2).map((e) => (
                  <Tag key={e.id} kind={e.kind} title={e.title} data-part="event">
                    {e.title}
                  </Tag>
                ))}
                {evs.length > 2 && <span className="text-[11px] font-semibold text-wisteria-deep">+{evs.length - 2} more</span>}
              </div>
            </motion.div>
          );
        })}
      </motion.div>
    </div>
  );
}
