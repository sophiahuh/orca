"use client";

import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/**
 * Pill chips. Figma has two families:
 *  - "soft"   (Style Guide chips: alice / wisteria, 2px border, 3px lip)
 *  - "outline"(Add Material type chips: parchment with periwinkle-deep border, 4px lip)
 */
export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  tone?: "soft" | "outline";
  size?: "md" | "sm";
}

export function Chip({ selected = false, tone = "soft", size = "md", className, children, type = "button", ...rest }: ChipProps) {
  const base = "pressable inline-flex items-center rounded-pill font-bold leading-none select-none whitespace-nowrap";
  const pad = size === "md" ? "px-[20px] py-[12px] text-[16px]" : "px-[18px] py-[10px] text-[15px]";
  const look =
    tone === "soft"
      ? selected
        ? "bg-wisteria text-parchment border-2 border-wisteria-deep lip-3 lip-wisteria"
        : "bg-alice text-prussian border-2 border-alice-deep lip-3 lip-alice"
      : selected
        ? "bg-wisteria text-parchment border-[2.5px] border-wisteria-deep lip-4 lip-wisteria"
        : "bg-parchment text-prussian border-[2.5px] border-periwinkle-deep lip-4 lip-periwinkle";

  return (
    <button type={type} aria-pressed={selected} className={cn(base, pad, look, className)} {...rest}>
      {children}
    </button>
  );
}

/** Small context pill, e.g. the "ALD" badge top-right of Add Material. */
export function ContextPill({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-pill bg-wisteria px-5 py-[10px] text-[16px] font-bold leading-none text-parchment border-2 border-wisteria-deep lip-3 lip-wisteria",
        className,
      )}
    >
      {children}
    </span>
  );
}
