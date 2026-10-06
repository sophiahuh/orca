"use client";

import { useState } from "react";
import { motion } from "motion/react";
import type { DeepCoverage } from "@/lib/mastery/session";
import { BackButton } from "@/components/layout/BackButton";
import { Screen } from "@/components/layout/Screen";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { fadeUp, stagger } from "@/lib/motion";

export const DEEP_MINUTE_PRESETS = [10, 15, 20, 30, 45, 60] as const;
export const DEEP_MAX_MINUTES = 600;

export interface DeepReviewPlan {
  questions: number;
  plannedSeconds: number;
  coverage: DeepCoverage;
  /** Topics the session asks about, with how many questions each, in trail order. */
  topics: Array<{ name: string; questions: number }>;
}

export interface DeepReviewSetupProps {
  courseName: string;
  backHref: string;
  minutes: number;
  onMinutes: (minutes: number) => void;
  plan: DeepReviewPlan;
  onStart: () => void;
}

const minutesOf = (seconds: number) => Math.max(1, Math.ceil(seconds / 60));

/** Before a deep review: the student picks how long, and sees what that length covers. */
export function DeepReviewSetup({ courseName, backHref, minutes, onMinutes, plan, onStart }: DeepReviewSetupProps) {
  const [custom, setCustom] = useState(DEEP_MINUTE_PRESETS.some((m) => m === minutes) ? "" : String(minutes));
  const { coverage } = plan;
  const missing = coverage.objectives - coverage.covered;
  const allMinutes = minutesOf(coverage.coverAllSeconds);
  const stockShort = missing === 0 && coverage.stockSeconds < minutes * 60;

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
          <span className="eyebrow">Deep review · {courseName}</span>
          <h1 className="text-[40px] font-bold leading-none text-prussian">How long do you want to study?</h1>
        </div>
      </header>

      <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="mx-auto flex w-[760px] max-w-full flex-col items-center gap-[20px] px-[28px] py-[28px] text-center">
        <motion.div variants={fadeUp} className="flex flex-wrap items-center justify-center gap-[12px]">
          {DEEP_MINUTE_PRESETS.map((m) => (
            <Chip
              key={m}
              size="sm"
              selected={minutes === m && custom === ""}
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
          <label className="flex items-center gap-[8px] text-[15px] font-bold text-prussian">
            Other
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={DEEP_MAX_MINUTES}
              value={custom}
              onChange={(e) => setCustomMinutes(e.target.value)}
              data-part="deep-custom"
              aria-label="Minutes"
              className="h-[40px] w-[84px] rounded-[12px] border-2 border-periwinkle-deep bg-parchment px-[12px] text-[15px] font-bold text-prussian focus:outline-none"
            />
            min
          </label>
        </motion.div>

        <motion.div variants={fadeUp}>
          <Card radius={22} lip={5} className="flex flex-col items-center gap-[10px] px-[24px] py-[20px] text-prussian" data-part="deep-plan">
            <p className="text-[22px] font-bold">
              {plan.questions} question{plan.questions === 1 ? "" : "s"} · about {minutesOf(plan.plannedSeconds)} min
            </p>
            <p className="text-[16px]" data-part="deep-coverage">
              Covers {coverage.covered} of {coverage.objectives} objective{coverage.objectives === 1 ? "" : "s"}, most urgent first.
            </p>
            {missing > 0 && (
              <p className="text-[15px] text-prussian/80" data-part="deep-short">
                {missing} lower-priority objective{missing === 1 ? " doesn't" : "s don't"} fit.{" "}
                <button type="button" className="font-bold text-wisteria-deep hover:underline" data-part="deep-cover-all" onClick={() => setCustomMinutes(String(allMinutes))}>
                  About {allMinutes} min covers all of them
                </button>
                .
              </p>
            )}
            {stockShort && (
              <p className="text-[15px] text-prussian/80" data-part="deep-stock">
                That&apos;s every question Orca has for this course right now. More are written after each session.
              </p>
            )}
            {plan.topics.length > 0 && (
              <ul className="flex flex-wrap justify-center gap-[8px] pt-[4px]">
                {plan.topics.map((t) => (
                  <li key={t.name} className="rounded-pill bg-alice px-[12px] py-[6px] text-[14px] font-semibold text-prussian">
                    {t.name} · {t.questions}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </motion.div>

        <motion.div variants={fadeUp}>
          <Button onClick={onStart} data-part="deep-start">
            Start deep review
          </Button>
        </motion.div>
      </motion.div>
    </Screen>
  );
}
