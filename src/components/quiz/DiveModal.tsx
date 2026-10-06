"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { DEEP_MAX_MINUTES, DEEP_MINUTE_PRESETS } from "@/lib/deep-review";
import { IconClose } from "@/components/icons";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { RoundButton } from "@/components/ui/RoundButton";
import { overlayFade, popIn } from "@/lib/motion";

/**
 * "Dive into [topic]": a deep review of one topic. The student picks how long; Start opens the
 * session, which writes harder questions for that topic's objectives (POST /api/deep-review).
 */
export function DiveModal({ topic, initialMinutes, onStart, onClose }: { topic: { id: string; name: string } | null; initialMinutes: number; onStart: (topicId: string, minutes: number) => void; onClose: () => void }) {
  const [minutes, setMinutes] = useState(initialMinutes);
  const [custom, setCustom] = useState(DEEP_MINUTE_PRESETS.some((m) => m === initialMinutes) ? "" : String(initialMinutes));

  useEffect(() => {
    if (!topic) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [topic, onClose]);

  const setCustomMinutes = (raw: string) => {
    setCustom(raw);
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 1 && n <= DEEP_MAX_MINUTES) setMinutes(n);
  };

  return (
    <AnimatePresence>
      {topic && (
        <motion.div key="overlay" className="fixed inset-0 z-50 flex items-center justify-center bg-prussian/70 p-6" variants={overlayFade} initial="hidden" animate="show" exit="exit" onClick={onClose}>
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="dive-title"
            variants={popIn}
            initial="hidden"
            animate="show"
            exit="exit"
            onClick={(e) => e.stopPropagation()}
            className="relative flex w-[560px] max-w-full flex-col items-center gap-[20px] rounded-[32px] bg-parchment px-[36px] pb-[32px] pt-[40px] text-center lip-8 lip-alice"
            data-part="dive-modal"
          >
            <RoundButton size={44} label="Close" onClick={onClose} className="absolute right-[24px] top-[24px]">
              <IconClose size={20} />
            </RoundButton>
            <div className="flex flex-col gap-[6px] px-[40px]">
              <h2 id="dive-title" className="text-[28px] font-bold leading-tight text-prussian">
                Dive into {topic.name}
              </h2>
              <p className="text-[15px] font-medium text-wisteria-deep">Harder questions on this topic, written for you when you start. How long do you want to study?</p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-[10px]">
              {DEEP_MINUTE_PRESETS.map((m) => (
                <Chip
                  key={m}
                  size="sm"
                  selected={minutes === m && custom === ""}
                  data-part="dive-minutes"
                  data-minutes={m}
                  onClick={() => {
                    setCustom("");
                    setMinutes(m);
                  }}
                >
                  {m} min
                </Chip>
              ))}
              <label className="flex shrink-0 items-center gap-[8px] whitespace-nowrap text-[15px] font-bold text-prussian">
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={DEEP_MAX_MINUTES}
                  value={custom}
                  onChange={(e) => setCustomMinutes(e.target.value)}
                  aria-label="Other length in minutes"
                  className="h-[40px] w-[84px] rounded-[12px] border-2 border-periwinkle-deep bg-parchment px-[12px] text-[15px] font-bold text-prussian focus:outline-none"
                />
                min
              </label>
            </div>
            <Button onClick={() => onStart(topic.id, minutes)} data-part="dive-start">
              Start dive
            </Button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
