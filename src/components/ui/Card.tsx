import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/**
 * Figma: Card. Parchment surface, 32px radius, 2px alice-deep border, 8px lip.
 * `radius`/`lip` let the smaller card variants (due cards, calendar cells) reuse it.
 */
export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  radius?: number;
  lip?: 3 | 4 | 5 | 6 | 8 | 10;
  tone?: "parchment" | "alice";
}

const lips = { 3: "lip-3", 4: "lip-4", 5: "lip-5", 6: "lip-6", 8: "lip-8", 10: "lip-10" } as const;

export function Card({ radius = 32, lip = 8, tone = "parchment", className, style, children, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        "border-2 border-alice-deep lip-alice",
        tone === "parchment" ? "bg-parchment" : "bg-alice",
        lips[lip],
        className,
      )}
      style={{ borderRadius: radius, ...style }}
      {...rest}
    >
      {children}
    </div>
  );
}
