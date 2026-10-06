"use client";

import { motion } from "motion/react";
import { IconCheck, IconClose } from "@/components/icons";
import { cn } from "@/lib/cn";
import { fadeUp, spring } from "@/lib/motion";

/**
 * Figma: Quiz answer row (Style Guide: Answer Option; 04a/04b Quiz — Feedback). Letter badge +
 * text; idle, selected, and after checking: correct (green tint) or wrong (coral tint), each with
 * an option tag on the right ("Your answer ✕", "Correct answer ✓"). Rows not involved dim.
 */
export type AnswerState = "idle" | "selected" | "correct" | "wrong" | "dimmed";

export interface AnswerOptionProps {
  letter: string;
  children: React.ReactNode;
  state?: AnswerState;
  disabled?: boolean;
  onClick?: () => void;
  /** The option tag shown once checked (Figma: Option tag). */
  tag?: string;
}

const rowLook: Record<AnswerState, string> = {
  idle: "bg-parchment border-periwinkle-deep lip-periwinkle text-prussian",
  selected: "bg-alice border-wisteria-deep lip-wisteria text-prussian",
  correct: "bg-good-tint border-good lip-good text-prussian",
  wrong: "bg-bad-tint border-bad lip-bad text-prussian",
  dimmed: "bg-parchment border-alice-deep lip-alice text-prussian opacity-60",
};

const badgeLook: Record<AnswerState, string> = {
  idle: "bg-alice text-wisteria-deep",
  selected: "bg-wisteria text-parchment",
  correct: "bg-good text-white",
  wrong: "bg-bad text-white",
  dimmed: "bg-alice text-wisteria-deep",
};

export function AnswerOption({ letter, children, state = "idle", disabled, onClick, tag }: AnswerOptionProps) {
  const verdict = state === "correct" || state === "wrong";
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
      <span className={cn("flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] text-[14px] font-bold", badgeLook[state])}>{letter}</span>
      <span className="flex-1 leading-snug">{children}</span>
      {verdict && tag && (
        <span data-part="option-tag" className={cn("flex shrink-0 items-center gap-[8px] text-[13px] font-semibold", state === "correct" ? "text-good-text" : "text-bad-text")}>
          {tag}
          <span className={cn("flex h-[28px] w-[28px] items-center justify-center rounded-pill text-white", state === "correct" ? "bg-good" : "bg-bad")}>
            {state === "correct" ? <IconCheck size={14} strokeWidth={3.5} /> : <IconClose size={12} strokeWidth={3} />}
          </span>
        </span>
      )}
    </motion.button>
  );
}
