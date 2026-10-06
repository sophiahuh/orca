"use client";

import { motion } from "motion/react";
import { formatSeconds } from "@/lib/data";
import { IconClose } from "@/components/icons";
import { OrcaLogo } from "@/components/brand/OrcaLogo";
import { Wave } from "@/components/brand/Decor";
import { Button } from "@/components/ui/Button";
import { RoundButton } from "@/components/ui/RoundButton";
import { Stat } from "@/components/ui/Stat";
import { fadeUp, popIn, stagger } from "@/lib/motion";

export interface QuizEndProps {
  topicName: string;
  correct: number;
  total: number;
  seconds: number;
  streak: number;
  onContinue: () => void;
  onReview?: () => void;
  onClose: () => void;
  /** Start another session of the same kind (deep review). */
  again?: { label: string; onStart: () => void };
  /** A line under the buttons (e.g. new questions being written). */
  extra?: React.ReactNode;
}

/** Figma: Quiz End. Centred 640px result card on an alice sea. */
export function QuizEnd({ topicName, correct, total, seconds, streak, onContinue, onReview, onClose, again, extra }: QuizEndProps) {
  const misses = total - correct;
  const accuracy = total ? Math.round((correct / total) * 100) : 0;

  return (
    <div className="relative flex min-h-screen-below-bar flex-1 items-center justify-center overflow-y-auto bg-alice p-6">
      <Wave tone="light" x={120} y={160} width={70} seed={1} />
      <Wave tone="light" x={960} y={220} width={60} seed={2} />
      <Wave tone="light" x={180} y={650} width={80} seed={3} />
      <Wave tone="light" x={940} y={600} width={70} seed={4} />

      <motion.div
        variants={popIn}
        initial="hidden"
        animate="show"
        className="relative my-auto flex w-[640px] max-w-full flex-col items-center rounded-[36px] bg-parchment px-[40px] pb-[28px] pt-[36px] text-center lip-10 lip-alice"
      >
        <RoundButton size={44} label="Close" onClick={onClose} className="absolute left-[24px] top-[24px]">
          <IconClose size={20} />
        </RoundButton>

        <motion.div variants={stagger(0.25, 0.08)} initial="hidden" animate="show" className="flex w-full flex-col items-center">
          <motion.div variants={popIn}>
            <OrcaLogo width={150} />
          </motion.div>

          <motion.h1 variants={fadeUp} className="mt-[4px] text-[38px] font-bold leading-tight text-prussian">
            {correct === total ? "Perfect. Keep going!" : "Nice work. Keep going!"}
          </motion.h1>
          <motion.p variants={fadeUp} className="mt-[8px] text-[16px] text-prussian/80">
            You answered {correct} of {total} correctly. {topicName} is getting stronger.
          </motion.p>

          <motion.div variants={stagger(0.1, 0.06)} className="mt-[22px] flex w-full gap-[14px]">
            <Stat value={`${accuracy}%`} label="Accuracy" />
            <Stat value={formatSeconds(seconds)} label="Time" />
            <Stat value={`${streak} day${streak === 1 ? "" : "s"}`} label="Streak" />
          </motion.div>

          <motion.div variants={fadeUp} className="mt-[22px] flex w-full flex-col gap-[12px]">
            <Button full onClick={onContinue}>
              Continue
            </Button>
            {again && (
              <Button full variant="secondary" onClick={again.onStart} data-part="again">
                {again.label}
              </Button>
            )}
            {misses > 0 && onReview && (
              <Button full variant="secondary" onClick={onReview}>
                Review {misses} miss{misses === 1 ? "" : "es"}
              </Button>
            )}
          </motion.div>
          {extra}
        </motion.div>
      </motion.div>
    </div>
  );
}
