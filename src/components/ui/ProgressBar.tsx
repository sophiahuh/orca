"use client";

import { motion } from "motion/react";
import { cn } from "@/lib/cn";
import { springSoft } from "@/lib/motion";

/**
 * Figma: Progress bar. Alice track, wisteria fill with a periwinkle
 * highlight strip along the top of the fill. Width is set by the parent.
 */
export interface ProgressBarProps {
  /** 0..1 */
  value: number;
  height?: number;
  className?: string;
  label?: string;
}

export function ProgressBar({ value, height = 14, className, label = "Progress" }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      className={cn("relative w-full overflow-hidden rounded-pill bg-alice", className)}
      style={{ height }}
    >
      <motion.div
        data-part="fill"
        className="absolute inset-y-0 left-0 rounded-pill bg-wisteria"
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={springSoft}
      >
        <div
          data-part="highlight"
          className="absolute left-[6px] right-[6px] rounded-pill bg-periwinkle"
          style={{ top: Math.round(height * 0.22), height: Math.max(2, Math.round(height * 0.22)) }}
        />
      </motion.div>
    </div>
  );
}
