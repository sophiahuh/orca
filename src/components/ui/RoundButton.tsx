"use client";

import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/**
 * Square-ish icon buttons: Round/back, Round/close, Round/next, Nav/*,
 * Round/up, Round/send. 56px (or 52 / 48 / 44) with ~18px radius and 4px lip.
 */
export interface RoundButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: 56 | 52 | 48 | 44;
  tone?: "parchment" | "alice" | "wisteria";
  label: string;
}

export function RoundButton({ size = 56, tone = "parchment", label, className, children, type = "button", ...rest }: RoundButtonProps) {
  const look =
    tone === "parchment"
      ? "bg-parchment text-prussian border-2 border-alice-deep lip-alice"
      : tone === "alice"
        ? "bg-alice text-prussian lip-alice"
        : "bg-wisteria text-parchment lip-wisteria";
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn("pressable inline-flex shrink-0 items-center justify-center lip-4 select-none", look, className)}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.385) }}
      {...rest}
    >
      {children}
    </button>
  );
}
