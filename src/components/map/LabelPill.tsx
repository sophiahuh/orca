"use client";

import type { ButtonHTMLAttributes } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/cn";
import { popIn } from "@/lib/motion";

/** The name pill under an island. Optional due-count badge. */
export interface LabelPillProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  count?: number;
  interactive?: boolean;
}

export function LabelPill({ count = 0, interactive = true, className, children, type = "button", ...rest }: LabelPillProps) {
  return (
    <motion.span variants={popIn} className="inline-block">
      <button
        type={type}
        disabled={!interactive}
        className={cn(
          "inline-flex items-center gap-[8px] whitespace-nowrap rounded-pill border-2 border-alice-deep bg-parchment py-[8px] pl-[16px] text-[14px] font-bold text-prussian lip-3 lip-alice",
          count > 0 ? "pr-[8px]" : "pr-[16px]",
          interactive ? "pressable" : "cursor-default",
          className,
        )}
        {...rest}
      >
        {children}
        {count > 0 && (
          <span
            data-part="badge"
            aria-label={`${count} due`}
            className="flex h-[22px] min-w-[22px] items-center justify-center rounded-pill bg-wisteria px-[6px] text-[12px] font-bold text-parchment"
          >
            {count}
          </span>
        )}
      </button>
    </motion.span>
  );
}
