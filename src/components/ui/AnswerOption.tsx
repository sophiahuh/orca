"use client";

import { motion } from "motion/react";
import { IconCheck, IconClose } from "@/components/icons";
import { cn } from "@/lib/cn";
import { fadeUp, spring } from "@/lib/motion";

/**
 * Figma: Quiz answer row. Letter badge + text; four states.
 */
export type AnswerState = "idle" | "selected" | "correct" | "wrong";

export interface AnswerOptionProps {
  letter: string;
  children: React.ReactNode;
  state?: AnswerState;
  disabled?: boolean;
  onClick?: () => void;
}

const rowLook: Record<AnswerState, string> = {
  idle: "bg-parchment border-periwinkle-deep lip-periwinkle text-prussian",
  selected: "bg-alice border-wisteria-deep lip-wisteria text-prussian",
  correct: "bg-wisteria border-wisteria-deep lip-wisteria text-parchment",
  wrong: "bg-parchment border-prussian lip-ink text-prussian",
};

const badgeLook: Record<AnswerState, string> = {
  idle: "bg-alice text-wisteria-deep",
  selected: "bg-wisteria text-parchment",
  correct: "bg-parchment text-wisteria-deep",
  wrong: "bg-prussian text-parchment",
};

export function AnswerOption({ letter, children, state = "idle", disabled, onClick }: AnswerOptionProps) {
  return (
    <motion.button
      type="button"
      variants={fadeUp}
      layout
      transition={spring}
      disabled={disabled}
      onClick={onClick}
      aria-pressed={state === "selected"}
      data-state={state}
      className={cn(
        "pressable flex w-full items-center gap-4 rounded-[16px] border-[2.5px] px-4 py-[12px] text-left text-[17px] font-bold lip-4 disabled:opacity-100",
        rowLook[state],
      )}
    >
      <span className={cn("flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] text-[14px] font-bold", badgeLook[state])}>
        {state === "correct" ? <IconCheck size={16} strokeWidth={3.5} /> : state === "wrong" ? <IconClose size={14} /> : letter}
      </span>
      <span className="flex-1 leading-snug">{children}</span>
    </motion.button>
  );
}
