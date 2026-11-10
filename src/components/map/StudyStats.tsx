"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { OrcaLogo } from "@/components/brand/OrcaLogo";
import { IconDown } from "@/components/icons";
import { DailyUsage } from "@/components/map/DailyUsage";
import { YourMetrics, duration, useUserMetrics } from "@/components/settings/YourMetrics";
import { popIn } from "@/lib/motion";
import { useMasteryByCourse, useStreak } from "@/lib/store";

/**
 * The home page's stats strip (owner, 2026-11-10: metrics moved off Settings): the streak, weak spots
 * mastered across every course (the same count as each course's header), and the past week's study
 * time. Clicking it opens the full breakdown and today's reading allowance; with `usage`, the
 * allowance also shows above the strip when it matters (DailyUsage's floating placement).
 */
export function StudyStats({ usage }: { usage: boolean }) {
  const streak = useStreak();
  const mastery = useMasteryByCourse();
  const { metrics, problem } = useUserMetrics();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const fixed = Object.values(mastery).reduce((sum, m) => sum + [...m.topics.values()].reduce((s, t) => s + t.mastered, 0), 0);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div ref={box} className="absolute bottom-[28px] left-[28px] flex flex-col items-start gap-[10px]">
      <AnimatePresence>
        {open && (
          <motion.div
            variants={popIn}
            initial="hidden"
            animate="show"
            exit="exit"
            style={{ transformOrigin: "bottom left" }}
            role="dialog"
            aria-label="Your progress"
            className="flex max-h-[560px] w-[360px] flex-col gap-[14px] overflow-auto rounded-[24px] border-2 border-alice-deep bg-parchment px-[22px] pb-[20px] pt-[18px] lip-5 lip-alice"
            data-part="stats-popover"
          >
            <div className="flex flex-col gap-[2px]">
              <h2 className="text-[20px] font-bold text-prussian">Your progress</h2>
              <p className="text-[13px] font-medium text-wisteria-deep">From finished study sessions and answered questions.</p>
            </div>
            <YourMetrics metrics={metrics} problem={problem} />
            {usage && (
              <div className="border-t border-alice-deep pt-[12px]">
                <DailyUsage placement="inline" />
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      {!open && usage && <DailyUsage placement="floating" />}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Your progress"
        data-part="study-stats"
        className="pressable inline-flex items-center gap-[10px] rounded-pill border-2 border-alice-deep bg-parchment py-[8px] pl-[12px] pr-[16px] text-[15px] font-bold text-prussian lip-3 lip-alice"
      >
        <OrcaLogo width={38} shadow={false} />
        <span>{streak} day streak</span>
        <Dot />
        <span data-part="stats-fixed">{fixed} {fixed === 1 ? "weak spot" : "weak spots"} mastered</span>
        {metrics && (
          <>
            <Dot />
            <span data-part="stats-week">{duration(metrics.weekSeconds)} past week</span>
          </>
        )}
        <IconDown size={16} className={open ? "rotate-180 text-wisteria-deep transition-transform" : "text-wisteria-deep transition-transform"} />
      </button>
    </div>
  );
}

function Dot() {
  return <span aria-hidden className="text-wisteria-deep">·</span>;
}
