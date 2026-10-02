"use client";

import { motion } from "motion/react";
import { cn } from "@/lib/cn";
import { spring } from "@/lib/motion";

/** Figma: Toggle. 52×30 pill, wisteria when on, alice-deep when off, parchment knob. */
export interface ToggleProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  className?: string;
}

export function Toggle({ checked, onChange, label, className }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-[30px] w-[52px] shrink-0 items-center rounded-pill p-[3px] transition-colors duration-200",
        checked ? "bg-wisteria lip-2 lip-wisteria" : "bg-alice-deep lip-2 lip-alice",
        className,
      )}
    >
      <motion.span
        data-part="knob"
        className="block h-[24px] w-[24px] rounded-pill bg-parchment"
        animate={{ x: checked ? 22 : 0 }}
        transition={spring}
      />
    </button>
  );
}
