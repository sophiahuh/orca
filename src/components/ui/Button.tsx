"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Figma: Button/Primary, Button/Secondary, Button/Dark, Button/Ghost.
 * 20px radius, 17px bold label, 5px lip shadow, sinks on press.
 */
export type ButtonVariant = "primary" | "secondary" | "dark" | "ghost";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  icon?: ReactNode;
  full?: boolean;
  size?: "md" | "sm";
}

const styles: Record<ButtonVariant, string> = {
  primary: "bg-wisteria text-parchment lip-wisteria",
  secondary: "bg-parchment text-wisteria-deep border-[2.5px] border-periwinkle-deep lip-periwinkle",
  dark: "bg-prussian text-parchment lip-ink",
  ghost: "bg-alice text-prussian lip-alice",
};

export function Button({ variant = "primary", icon, full, size = "md", className, children, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "pressable inline-flex items-center justify-center gap-2 rounded-[20px] font-bold leading-none lip-5 select-none",
        size === "md" ? "px-8 py-4 text-[17px]" : "px-5 py-3 text-[15px]",
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
