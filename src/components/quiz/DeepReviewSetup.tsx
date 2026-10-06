"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { DEEP_MAX_MINUTES, DEEP_MINUTE_PRESETS } from "@/lib/deep-review";
import { BackButton } from "@/components/layout/BackButton";
import { Screen } from "@/components/layout/Screen";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { fadeUp, stagger } from "@/lib/motion";

export interface DeepReviewSetupProps {
  courseName: string;
  backHref: string;
  minutes: number;
  onMinutes: (minutes: number) => void;
  onStart: () => void;
  /** A durable job is writing the questions (after Start). */
  writing: boolean;
  /** Why the last Start failed, or null. */
  error: string | null;
}

/** Before a deep review: the student picks how long and starts; Orca then writes its questions. */
export function DeepReviewSetup({ courseName, backHref, minutes, onMinutes, onStart, writing, error }: DeepReviewSetupProps) {
  const [custom, setCustom] = useState(DEEP_MINUTE_PRESETS.some((m) => m === minutes) ? "" : String(minutes));

  const setCustomMinutes = (raw: string) => {
    setCustom(raw);
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 1 && n <= DEEP_MAX_MINUTES) onMinutes(n);
  };

  return (
    <Screen bg="ocean" className="overflow-y-auto">
      <header className="relative flex justify-center px-[100px] pt-[28px] text-center">
        <div className="absolute left-[28px] top-[28px]">
          <BackButton href={backHref} />
        </div>
        <div className="flex flex-col items-center gap-[4px]">
          <span className="eyebrow">Dive in · {courseName}</span>
          <h1 className="text-[40px] font-bold leading-none text-prussian">How long do you want to study?</h1>
        </div>
      </header>

      <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="mx-auto flex w-[760px] max-w-full flex-col items-center gap-[24px] px-[28px] py-[28px] text-center">
        <motion.div variants={fadeUp} className="flex items-center justify-center gap-[12px]">
          {DEEP_MINUTE_PRESETS.map((m) => (
            <Chip
              key={m}
              size="sm"
              selected={minutes === m && custom === ""}
              disabled={writing}
              data-part="deep-minutes"
              data-minutes={m}
              onClick={() => {
                setCustom("");
                onMinutes(m);
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
              disabled={writing}
              onChange={(e) => setCustomMinutes(e.target.value)}
              data-part="deep-custom"
              aria-label="Other length in minutes"
              className="h-[40px] w-[84px] rounded-[12px] border-2 border-periwinkle-deep bg-parchment px-[12px] text-[15px] font-bold text-prussian focus:outline-none"
            />
            min
          </label>
        </motion.div>

        <motion.div variants={fadeUp} className="flex flex-col items-center gap-[12px]">
          <Button onClick={onStart} disabled={writing} data-part="deep-start">
            {writing ? "Preparing your dive in…" : "Dive in"}
          </Button>
          {writing && (
            <p className="text-[15px] font-medium text-prussian" role="status" data-part="deep-writing">
              Orca is writing harder questions from your course material. This can take a minute or two; you can safely leave or reload this page.
            </p>
          )}
          {error && (
            <p className="text-[15px] font-semibold text-prussian" role="alert" data-part="deep-error">
              {error}
            </p>
          )}
        </motion.div>
      </motion.div>
    </Screen>
  );
}
