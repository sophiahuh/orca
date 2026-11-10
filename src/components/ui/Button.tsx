"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Figma: Button/Primary, Button/Secondary, Button/Dark, Button/Ghost.
 * 20px radius, 17px bold label, 5px lip shadow, sinks on press. `xs` is the small pill (13px label,
 * 2px lip) used beside other pills and inside popovers.
 */
export type ButtonVariant = "primary" | "secondary" | "dark" | "ghost" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  icon?: ReactNode;
  full?: boolean;
  size?: "md" | "sm" | "xs";
}

const sizes = {
  md: "rounded-[20px] lip-5 px-8 py-4 text-[17px]",
  sm: "rounded-[20px] lip-5 px-5 py-3 text-[15px]",
  xs: "rounded-pill lip-2 px-[12px] py-[7px] text-[13px]",
} as const;

const styles: Record<ButtonVariant, string> = {
  primary: "bg-wisteria text-parchment lip-wisteria",
  secondary: "bg-parchment text-wisteria-deep border-[2.5px] border-periwinkle-deep lip-periwinkle",
  dark: "bg-prussian text-parchment lip-ink",
  ghost: "bg-alice text-prussian lip-alice",
  /** Rejecting or removing something. */
  danger: "bg-parchment text-bad-text border-[2.5px] border-bad lip-bad",
};

export function Button({ variant = "primary", icon, full, size = "md", className, children, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "pressable inline-flex items-center justify-center gap-2 font-bold leading-none select-none",
        sizes[size],
        styles[variant],
        full && "w-full",
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
