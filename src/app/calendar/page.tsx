"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { fadeSwap } from "@/lib/motion";
import type { EventKind } from "@/lib/data";
import { useOrca } from "@/lib/store";
import { useToday } from "@/hooks/useToday";
import { IconBack, IconNext } from "@/components/icons";
import { Screen } from "@/components/layout/Screen";
import { BackButton } from "@/components/layout/BackButton";
import { RoundButton } from "@/components/ui/RoundButton";
import { Tag } from "@/components/ui/Tag";
import { MonthGrid } from "@/components/calendar/MonthGrid";

const KINDS: EventKind[] = ["hw", "lab", "rev", "exam"];

/** First day of the month containing an ISO date. */
function monthOf(iso: string) {
  const [y, m] = iso.split("-").map(Number);
  return new Date(y, m - 1, 1);
}

export default function CalendarPage() {
  const { events } = useOrca();
  const today = useToday();
  // null = "follow today"; set once the student pages away.
  const [picked, setPicked] = useState<Date | null>(null);
  // Until the client clock is known, render the empty sea rather than a wrong month.
  if (!today) return <Screen bg="alice" />;
  const cursor = picked ?? monthOf(today);

  const shift = (n: number) => setPicked(new Date(cursor.getFullYear(), cursor.getMonth() + n, 1));
  const monthName = cursor.toLocaleString("en-US", { month: "long" });
  const showYear = cursor.getFullYear() !== Number(today.slice(0, 4));

  return (
    <Screen bg="alice" className="overflow-y-auto">
      <header className="flex items-center gap-[20px] px-[28px] pt-[28px]">
        <BackButton />
        <AnimatePresence mode="wait">
          <motion.h1
            key={`${cursor.getFullYear()}-${cursor.getMonth()}`}
            variants={fadeSwap}
            initial="hidden"
            animate="show"
            exit="exit"
            className="text-[46px] font-bold leading-none text-prussian"
          >
            {monthName}
            {showYear && <span className="ml-3 text-[28px] font-semibold text-wisteria-deep">{cursor.getFullYear()}</span>}
          </motion.h1>
        </AnimatePresence>
        <div className="ml-[16px] flex items-center gap-[8px]" aria-label="Legend">
          {KINDS.map((k) => (
            <Tag key={k} kind={k} size="md" />
          ))}
        </div>
        <div className="ml-auto flex items-center gap-[12px]">
          <RoundButton size={48} label="Previous month" onClick={() => shift(-1)}>
            <IconBack size={22} />
          </RoundButton>
          <RoundButton size={48} label="Next month" onClick={() => shift(1)}>
            <IconNext size={22} />
          </RoundButton>
        </div>
      </header>

      <div className="px-[40px] pb-[40px] pt-[28px]">
        <MonthGrid cursor={cursor} events={events} today={today} />
      </div>
    </Screen>
  );
}
